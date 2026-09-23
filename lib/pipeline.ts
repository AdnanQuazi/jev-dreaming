import { v4 as uuidv4 } from "uuid";
import type {
  Chunk,
  Memory,
  MemoryLink,
  MutationAction,
  PipelineRunResult,
  PipelineEvent,
  StageMetrics,
  JevTriageResult,
  JevMutationResult,
  ChunkDiagnosticContext,
} from "@/types";

import { calcJevCost, calcGeminiCost } from "@/types";
import { runBatchJevClassifier, runJevMutationJudge } from "@/lib/jev";
import { extractMemoriesFromChunks, runGeminiMutationJudge } from "@/lib/gemini";
import { retrieveRelatedMemories } from "@/lib/retrieval";
import {
  getActiveMemories,
  appendMemory,
  supersede,
  createLink,
} from "@/lib/db";

type PipelineCallback = (event: PipelineEvent) => void;

// ─── DREAMING PIPELINE (Jev Classifier -> Gemini Gen -> Jev Mutation) ────────

export async function runDreamingPipeline(
  chunks: Chunk[],
  geminiModel: string,
  onEvent: PipelineCallback,
  commitToDb: boolean = false
): Promise<PipelineRunResult> {
  const stages: StageMetrics[] = [];
  const extractedMemories: Memory[] = [];
  const generatedLinks: MemoryLink[] = [];
  const mutationResults: JevMutationResult[] = [];
  const chunkDiagnostics: ChunkDiagnosticContext[] = [];
  const runStart = performance.now();

  try {
    // ── Stage 1: Jev Batch Classifier ────────────────────────────────────────
    onEvent({ type: "stage_start", stage: "Stage 1: Jev Classifier" });
    const triage = await runBatchJevClassifier(chunks);
    const triageResults = triage.results;
    
    // Emit chunk results
    for (const r of triageResults) {
      onEvent({
        type: "chunk_result",
        chunkId: r.chunkId,
        knowledgeProbability: r.knowledgeProbability,
        passedGate: r.passedGate,
        forwardedCount: r.passedGate ? 1 : 0, // Mock for UI
        totalCandidates: 0,
      });
    }

    const stage1Metrics: StageMetrics = {
      name: "Stage 1: Jev Classifier",
      latencyMs: triage.latencyMs,
      inputTokens: triage.inputTokens,
      outputTokens: triage.outputTokens,
      costUsd: calcJevCost(triage.inputTokens),
    };
    stages.push(stage1Metrics);
    onEvent({ type: "stage_complete", stage: stage1Metrics.name, metrics: stage1Metrics });

    const passedChunks = chunks.filter((c) => triageResults.find(r => r.chunkId === c.id)?.passedGate);

    if (passedChunks.length === 0) {
      const emptyResult = buildResult("dreaming-pipeline", stages, triageResults, [], [], [], runStart, []);
      onEvent({ type: "complete", result: emptyResult });
      return emptyResult;
    }

    // ── Stage 2: Gemini Memory Generation ────────────────────────────────────
    onEvent({ type: "stage_start", stage: "Stage 2: Gemini Generation" });
    const extraction = await extractMemoriesFromChunks(passedChunks, geminiModel);
    
    for (const mem of extraction.memories) {
      onEvent({
        type: "extraction_result",
        chunkId: mem.chunkId,
        memory: mem.content,
        memType: mem.type,
      });
    }

    const stage2Metrics: StageMetrics = {
      name: "Stage 2: Gemini Generation",
      latencyMs: extraction.latencyMs,
      inputTokens: extraction.inputTokens,
      outputTokens: extraction.outputTokens,
      costUsd: calcGeminiCost(geminiModel, extraction.inputTokens, extraction.outputTokens),
    };
    stages.push(stage2Metrics);
    onEvent({ type: "stage_complete", stage: stage2Metrics.name, metrics: stage2Metrics });

    // ── Stage 3: Jev Mutation Judge ──────────────────────────────────────────
    onEvent({ type: "stage_start", stage: "Stage 3: Jev Mutation Judge" });
    
    const allMemories = await getActiveMemories();
    const newMemoryObjects = extraction.memories.map(mem => ({
      id: uuidv4(),
      content: mem.content,
      type: mem.type,
      chunkId: mem.chunkId,
      confidence: mem.confidence
    }));

    let mutationInputTokens = 0;
    let mutationOutputTokens = 0;
    let mutationMaxLatency = 0;

    const mutationTasks = newMemoryObjects.map(async (nm) => {
      // Create mock chunk for retrieval
      const mockChunk = { id: nm.chunkId, text: nm.content };
      const relatedMems = retrieveRelatedMemories([mockChunk], allMemories, 5)[nm.chunkId] || [];
      const mutRes = await runJevMutationJudge({ id: nm.id, content: nm.content }, relatedMems);
      return { nm, mutRes, relatedMems };
    });

    const mutationTaskResults = await Promise.all(mutationTasks);

    for (const task of mutationTaskResults) {
      mutationInputTokens += task.mutRes.inputTokens;
      mutationOutputTokens += task.mutRes.outputTokens;
      mutationMaxLatency = Math.max(mutationMaxLatency, task.mutRes.latencyMs);
      mutationResults.push(...task.mutRes.results);
    }

    const stage3Metrics: StageMetrics = {
      name: "Stage 3: Jev Mutation Judge",
      latencyMs: mutationMaxLatency,
      inputTokens: mutationInputTokens,
      outputTokens: mutationOutputTokens,
      costUsd: calcJevCost(mutationInputTokens),
    };
    stages.push(stage3Metrics);
    onEvent({ type: "stage_complete", stage: stage3Metrics.name, metrics: stage3Metrics });

    // ── Apply mutations to IndexedDB ─────────────────────────────────────────
    for (const task of mutationTaskResults) {
      const nm = task.nm;
      const muts = task.mutRes.results;
      
      const newMemory: Memory = {
        id: nm.id,
        content: nm.content,
        type: nm.type,
        status: "active",
        sourceChunkId: nm.chunkId,
        confidence: nm.confidence,
        createdAt: Date.now(),
      };

      let actionTaken = false;

      // Handle Supersede first (highest priority)
      const supersedeMut = muts.find(m => m.action === "SUPERSEDE");
      if (supersedeMut) {
        onEvent({ type: "mutation_result", action: "SUPERSEDE", newContent: nm.content });
        if (commitToDb) await supersede(supersedeMut.existingMemoryId, newMemory);
        actionTaken = true;
      } else {
        // Handle Extend
        const extendMuts = muts.filter(m => m.action === "EXTEND");
        if (extendMuts.length > 0) {
          onEvent({ type: "mutation_result", action: "EXTEND", newContent: nm.content });
          if (commitToDb) await appendMemory(newMemory);
          for (const ext of extendMuts) {
            const link: MemoryLink = {
              id: uuidv4(),
              fromId: nm.id,
              toId: ext.existingMemoryId,
              relation: "related",
              createdAt: Date.now(),
            };
            if (commitToDb) await createLink(link);
            generatedLinks.push(link);
          }
          actionTaken = true;
        } else {
          // Handle Append
          const appendMut = muts.find(m => m.action === "APPEND");
          if (appendMut || muts.length === 0 || muts.every(m => m.action === "UNRELATED")) {
            onEvent({ type: "mutation_result", action: "APPEND", newContent: nm.content });
            if (commitToDb) await appendMemory(newMemory);
            actionTaken = true;
          }
        }
      }

      if (actionTaken) {
        extractedMemories.push(newMemory);
      }
    }

    // ── Build diagnostic alignment context for Evaluation Judge ──────────────
    for (const chunk of chunks) {
      const tr = triageResults.find((r) => r.chunkId === chunk.id);
      const memsForChunk = extractedMemories.filter(m => m.sourceChunkId === chunk.id);
      const mutsForChunk = mutationResults.filter(r => memsForChunk.some(m => m.id === r.newMemoryId));

      chunkDiagnostics.push({
        chunkId: chunk.id,
        chunkText: chunk.text,
        passedGate: tr?.passedGate ?? false,
        extractedMemory: memsForChunk.length > 0 ? { content: memsForChunk[0].content, type: memsForChunk[0].type, confidence: memsForChunk[0].confidence } : undefined,
        resolvedMutations: mutsForChunk.map(m => {
          const targetMem = allMemories.find(x => x.id === m.existingMemoryId);
          return {
            action: m.action,
            targetMemoryId: m.existingMemoryId,
            targetMemoryContent: targetMem?.content
          };
        }),
      });
    }

    const result = buildResult("dreaming-pipeline", stages, triageResults, extractedMemories, generatedLinks, mutationResults, runStart, chunkDiagnostics);
    onEvent({ type: "complete", result });
    return result;
  } catch (err) {
    onEvent({ type: "error", message: String(err) });
    throw err;
  }
}

// ─── GEMINI COMPARISON PIPELINE ──────────────────────────────────────────────

export async function runGeminiComparisonPipeline(
  chunks: Chunk[],
  geminiModel: string,
  onEvent: PipelineCallback,
  commitToDb: boolean = false
): Promise<PipelineRunResult> {
  const stages: StageMetrics[] = [];
  const extractedMemories: Memory[] = [];
  const generatedLinks: MemoryLink[] = [];
  const mutationResults: JevMutationResult[] = [];
  const chunkDiagnostics: ChunkDiagnosticContext[] = [];
  const runStart = performance.now();

  try {
    // ── Stage 1+2: Gemini Memory Generation (All Chunks) ─────────────────────
    onEvent({ type: "stage_start", stage: "Stage 1+2: Gemini Generation" });
    const extraction = await extractMemoriesFromChunks(chunks, geminiModel);
    
    for (const mem of extraction.memories) {
      onEvent({
        type: "extraction_result",
        chunkId: mem.chunkId,
        memory: mem.content,
        memType: mem.type,
      });
    }

    const stage12Metrics: StageMetrics = {
      name: "Stage 1+2: Gemini Generation",
      latencyMs: extraction.latencyMs,
      inputTokens: extraction.inputTokens,
      outputTokens: extraction.outputTokens,
      costUsd: calcGeminiCost(geminiModel, extraction.inputTokens, extraction.outputTokens),
    };
    stages.push(stage12Metrics);
    onEvent({ type: "stage_complete", stage: stage12Metrics.name, metrics: stage12Metrics });

    // ── Stage 3: Gemini Mutation Judge ───────────────────────────────────────
    onEvent({ type: "stage_start", stage: "Stage 3: Gemini Mutation Judge" });
    
    const allMemories = await getActiveMemories();
    const newMemoryObjects = extraction.memories.map(mem => ({
      id: uuidv4(),
      content: mem.content,
      type: mem.type,
      chunkId: mem.chunkId,
      confidence: mem.confidence
    }));

    let mutationInputTokens = 0;
    let mutationOutputTokens = 0;
    let mutationMaxLatency = 0;

    const mutationTasks = newMemoryObjects.map(async (nm) => {
      const mockChunk = { id: nm.chunkId, text: nm.content };
      const relatedMems = retrieveRelatedMemories([mockChunk], allMemories, 5)[nm.chunkId] || [];
      const mutRes = await runGeminiMutationJudge({ id: nm.id, content: nm.content }, relatedMems, geminiModel);
      return { nm, mutRes, relatedMems };
    });

    const mutationTaskResults = await Promise.all(mutationTasks);

    for (const task of mutationTaskResults) {
      mutationInputTokens += task.mutRes.inputTokens;
      mutationOutputTokens += task.mutRes.outputTokens;
      mutationMaxLatency = Math.max(mutationMaxLatency, task.mutRes.latencyMs);
      mutationResults.push(...task.mutRes.results);
    }

    const stage3Metrics: StageMetrics = {
      name: "Stage 3: Gemini Mutation Judge",
      latencyMs: mutationMaxLatency,
      inputTokens: mutationInputTokens,
      outputTokens: mutationOutputTokens,
      costUsd: calcGeminiCost(geminiModel, mutationInputTokens, mutationOutputTokens),
    };
    stages.push(stage3Metrics);
    onEvent({ type: "stage_complete", stage: stage3Metrics.name, metrics: stage3Metrics });

    // ── DB Updates ───────────────────────────────────────────────────────────
    for (const task of mutationTaskResults) {
      const nm = task.nm;
      const muts = task.mutRes.results;
      
      const newMemory: Memory = {
        id: nm.id,
        content: nm.content,
        type: nm.type,
        status: "active",
        sourceChunkId: nm.chunkId,
        confidence: nm.confidence,
        createdAt: Date.now(),
      };

      const supersedeMut = muts.find(m => m.action === "SUPERSEDE");
      if (supersedeMut) {
        onEvent({ type: "mutation_result", action: "SUPERSEDE", newContent: nm.content });
        if (commitToDb) await supersede(supersedeMut.existingMemoryId, newMemory);
        extractedMemories.push(newMemory);
      } else {
        const extendMuts = muts.filter(m => m.action === "EXTEND");
        if (extendMuts.length > 0) {
          onEvent({ type: "mutation_result", action: "EXTEND", newContent: nm.content });
          if (commitToDb) await appendMemory(newMemory);
          for (const ext of extendMuts) {
            const link: MemoryLink = {
              id: uuidv4(),
              fromId: nm.id,
              toId: ext.existingMemoryId,
              relation: "related",
              createdAt: Date.now(),
            };
            if (commitToDb) await createLink(link);
            generatedLinks.push(link);
          }
          extractedMemories.push(newMemory);
        } else {
          const appendMut = muts.find(m => m.action === "APPEND");
          if (appendMut || muts.length === 0 || muts.every(m => m.action === "UNRELATED")) {
            onEvent({ type: "mutation_result", action: "APPEND", newContent: nm.content });
            if (commitToDb) await appendMemory(newMemory);
            extractedMemories.push(newMemory);
          }
        }
      }
    }

    // Map dummy triage results for UI display since we didn't filter
    const triageResults: JevTriageResult[] = chunks.map((c) => ({
      chunkId: c.id,
      knowledgeProbability: 1.0,
      passedGate: true,
      reason: "All passed (Gemini baseline)",
    }));

    for (const chunk of chunks) {
      const memsForChunk = extractedMemories.filter(m => m.sourceChunkId === chunk.id);
      const mutsForChunk = mutationResults.filter(r => memsForChunk.some(m => m.id === r.newMemoryId));

      chunkDiagnostics.push({
        chunkId: chunk.id,
        chunkText: chunk.text,
        passedGate: true,
        extractedMemory: memsForChunk.length > 0 ? { content: memsForChunk[0].content, type: memsForChunk[0].type, confidence: memsForChunk[0].confidence } : undefined,
        resolvedMutations: mutsForChunk.map(m => {
          const targetMem = allMemories.find(x => x.id === m.existingMemoryId);
          return {
            action: m.action,
            targetMemoryId: m.existingMemoryId,
            targetMemoryContent: targetMem?.content
          };
        }),
      });
    }

    const result = buildResult("gemini-pipeline", stages, triageResults, extractedMemories, generatedLinks, mutationResults, runStart, chunkDiagnostics);
    onEvent({ type: "complete", result });
    return result;
  } catch (err) {
    onEvent({ type: "error", message: String(err) });
    throw err;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildResult(
  mode: PipelineRunResult["mode"],
  stages: StageMetrics[],
  triageResults: JevTriageResult[],
  extractedMemories: Memory[],
  generatedLinks: MemoryLink[],
  mutationResults: JevMutationResult[],
  runStart: number,
  chunkDiagnostics: ChunkDiagnosticContext[]
): PipelineRunResult {
  const chunksFiltered = triageResults.filter((r) => !r.passedGate).length;
  const chunksProcessed = triageResults.filter((r) => r.passedGate).length;
  return {
    mode,
    stages,
    totalLatencyMs: performance.now() - runStart,
    totalCostUsd: stages.reduce((s, st) => s + st.costUsd, 0),
    memoriesGenerated: extractedMemories.length,
    chunksFiltered,
    chunksProcessed,
    triageResults,
    extractedMemories,
    generatedLinks,
    mutationResults,
    chunkDiagnostics,
    timestamp: Date.now(),
  };
}
