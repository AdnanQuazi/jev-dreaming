import { v4 as uuidv4 } from "uuid";
import type {
  Chunk,
  Memory,
  MutationAction,
  PipelineRunResult,
  PipelineEvent,
  StageMetrics,
  JevTriageResult,
  JevMutationResult,
  ExtractedMemory,
} from "@/types";

import { calcJevCost, calcGeminiCost } from "@/types";
import { runParallelJevTriage, runJevMutationJudge } from "@/lib/jev";
import { extractMemoryWithGemini, runGeminiSingleShot } from "@/lib/gemini";
import { retrieveRelatedMemories } from "@/lib/retrieval";
import {
  getActiveMemories,
  appendMemory,
  supersede,
  createLink,
} from "@/lib/db";

type PipelineCallback = (event: PipelineEvent) => void;

import { DEFAULT_PIPELINE_OPTIONS } from "@/types";
import type { PipelineOptions, ChunkDiagnosticContext } from "@/types";

// ─── JEV + GEMINI PIPELINE ───────────────────────────────────────────────────

export async function runJevPipeline(
  chunks: Chunk[],
  geminiModel: string,
  onEvent: PipelineCallback,
  options: PipelineOptions = DEFAULT_PIPELINE_OPTIONS
): Promise<PipelineRunResult> {
  const stages: StageMetrics[] = [];
  const triageResults: JevTriageResult[] = [];
  const extractedMemories: Memory[] = [];
  const mutationResults: JevMutationResult[] = [];
  const chunkDiagnostics: ChunkDiagnosticContext[] = [];
  const runStart = Date.now();

  try {
    // ── Stage 1: Jev Parallel Triage (Knowledge & Relations) ─────────────────
    onEvent({ type: "stage_start", stage: "Jev Parallel Triage (Score & Delta)" });

    const allMemories = await getActiveMemories();
    const relatedMemoriesMap = retrieveRelatedMemories(chunks, allMemories, 5);

    const triage = await runParallelJevTriage(chunks, relatedMemoriesMap, {
      gateMemories: options.gateMemories,
    });
    triageResults.push(...triage.results);

    // Emit per-chunk evaluation events
    for (const r of triage.results) {
      const candidates = relatedMemoriesMap[r.chunkId] || [];
      onEvent({
        type: "chunk_result",
        chunkId: r.chunkId,
        knowledgeProbability: r.knowledgeProbability,
        passedGate: r.passedGate,
        forwardedCount: r.forwardedMemoryIds.length,
        totalCandidates: candidates.length,
        worthinessScore: r.worthinessScore ?? Math.round(r.knowledgeProbability * 3 * 10) / 10,
        deltaProbability: r.deltaProbability ?? r.knowledgeProbability,
        hasContradiction: false,
        contradictionProbability: 0,
      });
    }

    const stage1Metrics: StageMetrics = {
      name: "Jev Parallel Triage (Score & Delta)",
      latencyMs: triage.parallelLatencyMs,
      inputTokens: triage.totalInputTokens,
      outputTokens: triage.totalOutputTokens,
      costUsd: calcJevCost(triage.totalInputTokens),
    };
    stages.push(stage1Metrics);
    onEvent({ type: "stage_complete", stage: stage1Metrics.name, metrics: stage1Metrics });

    // Filter to chunks that passed the gate (contains_memorable_knowledge >= 0.4)
    const passedResults = triage.results.filter((r) => r.passedGate);
    const passedChunks = chunks.filter((c) => passedResults.some((r) => r.chunkId === c.id));

    if (passedChunks.length === 0) {
      const emptyResult = buildResult(
        "jev-pipeline",
        stages,
        triageResults,
        [],
        [],
        runStart,
        options,
        []
      );
      onEvent({ type: "complete", result: emptyResult });
      return emptyResult;
    }

    // ── Stage 2: Gemini Parallel Extraction ─────────────────────────────────
    onEvent({ type: "stage_start", stage: "Gemini Parallel Extraction" });

    // For each passed chunk, get candidate memories to forward (gated vs all)
    const memoriesToSendPerChunk: Record<number, Memory[]> = {};
    for (const chunk of passedChunks) {
      const candidates = relatedMemoriesMap[chunk.id] || [];
      const tr = triage.results.find((r) => r.chunkId === chunk.id);
      if (options.gateMemories && tr) {
        memoriesToSendPerChunk[chunk.id] = candidates.filter((m) =>
          tr.forwardedMemoryIds.includes(m.id)
        );
      } else {
        memoriesToSendPerChunk[chunk.id] = candidates;
      }
    }

    const extractionResults = await Promise.all(
      passedChunks.map(async (chunk) => {
        const candidateMems = memoriesToSendPerChunk[chunk.id] || [];
        return extractMemoryWithGemini(
          chunk,
          candidateMems,
          geminiModel,
          options.mutationStrategy
        );
      })
    );

    let geminiInputTokens = 0;
    let geminiOutputTokens = 0;
    let geminiMaxLatency = 0;
    const validExtractions: Array<{ chunkId: number; mem: ExtractedMemory }> = [];

    for (let i = 0; i < passedChunks.length; i++) {
      const { extraction, inputTokens, outputTokens, latencyMs } = extractionResults[i];
      geminiInputTokens += inputTokens;
      geminiOutputTokens += outputTokens;
      geminiMaxLatency = Math.max(geminiMaxLatency, latencyMs);

      if (extraction) {
        validExtractions.push({ chunkId: passedChunks[i].id, mem: extraction });
        onEvent({
          type: "extraction_result",
          chunkId: extraction.chunkId,
          memory: extraction.content,
          memType: extraction.type,
        });
      }
    }

    const stage2Metrics: StageMetrics = {
      name: "Gemini Parallel Extraction",
      latencyMs: geminiMaxLatency,
      inputTokens: geminiInputTokens,
      outputTokens: geminiOutputTokens,
      costUsd: calcGeminiCost(geminiModel, geminiInputTokens, geminiOutputTokens),
    };
    stages.push(stage2Metrics);
    onEvent({ type: "stage_complete", stage: stage2Metrics.name, metrics: stage2Metrics });

    // ── Stage 3: Mutation Handling (Jev Judge vs Gemini In-Extraction) ───────
    const newMemoryObjects = validExtractions.map(({ mem }) => ({
      id: uuidv4(),
      content: mem.content,
      type: mem.type,
    }));

    const existingMemoriesPerNew: Record<string, Memory[]> = {};
    for (let i = 0; i < validExtractions.length; i++) {
      const { chunkId } = validExtractions[i];
      existingMemoriesPerNew[newMemoryObjects[i].id] = memoriesToSendPerChunk[chunkId] || [];
    }

    if (options.mutationStrategy === "jev") {
      onEvent({ type: "stage_start", stage: "Jev Mutation Judge" });

      const mutationJudge = await runJevMutationJudge(newMemoryObjects, existingMemoriesPerNew);
      mutationResults.push(...mutationJudge.results);

      const stage3Metrics: StageMetrics = {
        name: "Jev Mutation Judge",
        latencyMs: mutationJudge.latencyMs,
        inputTokens: mutationJudge.inputTokens,
        outputTokens: mutationJudge.outputTokens,
        costUsd: calcJevCost(mutationJudge.inputTokens),
      };
      stages.push(stage3Metrics);
      onEvent({ type: "stage_complete", stage: stage3Metrics.name, metrics: stage3Metrics });
    } else {
      // Gemini In-Extraction mutation: mutations already returned by Gemini in Stage 2!
      for (let i = 0; i < validExtractions.length; i++) {
        const { mem } = validExtractions[i];
        const newMemId = newMemoryObjects[i].id;
        const action = mem.suggestedAction || "APPEND";
        const targetMemoryId = mem.targetMemoryId || "";

        mutationResults.push({
          newMemoryId: newMemId,
          existingMemoryId: targetMemoryId,
          action,
          confidence: mem.confidence,
        });
      }

      const stage3Metrics: StageMetrics = {
        name: "Gemini In-Extraction Mutation (Combined in Stage 2)",
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      };
      stages.push(stage3Metrics);
      onEvent({ type: "stage_complete", stage: stage3Metrics.name, metrics: stage3Metrics });
    }

    // ── Apply mutations to IndexedDB ─────────────────────────────────────────
    for (let i = 0; i < newMemoryObjects.length; i++) {
      const nm = newMemoryObjects[i];
      const ext = validExtractions[i];
      const existingMems = existingMemoriesPerNew[nm.id] || [];

      const newMemory: Memory = {
        id: nm.id,
        content: nm.content,
        type: nm.type,
        status: "active",
        sourceChunkId: ext.chunkId,
        confidence: ext.mem.confidence,
        createdAt: Date.now(),
      };

      const pairsForThisNew = mutationResults.filter((r) => r.newMemoryId === nm.id);

      let primaryAction: MutationAction = "APPEND";
      let supersededId: string | undefined;

      for (const pair of pairsForThisNew) {
        const existingMem = existingMems.find((m) => m.id === pair.existingMemoryId);
        if (pair.action === "SUPERSEDE") {
          primaryAction = "SUPERSEDE";
          supersededId = pair.existingMemoryId;
          onEvent({
            type: "mutation_result",
            action: "SUPERSEDE",
            newContent: nm.content,
            existingContent: existingMem?.content,
          });
        } else if (pair.action === "LINK" && primaryAction === "APPEND") {
          primaryAction = "LINK";
          onEvent({
            type: "mutation_result",
            action: "LINK",
            newContent: nm.content,
            existingContent: existingMem?.content,
          });
        }
      }

      const resolvedMutTarget = supersededId
        ? allMemories.find((m) => m.id === supersededId) || existingMems.find((m) => m.id === supersededId)
        : undefined;

      if (primaryAction === "APPEND") {
        onEvent({ type: "mutation_result", action: "APPEND", newContent: nm.content });
        await appendMemory(newMemory);
        if (!mutationResults.some((r) => r.newMemoryId === nm.id)) {
          mutationResults.push({
            newMemoryId: nm.id,
            existingMemoryId: "",
            action: "APPEND",
            confidence: ext.mem.confidence,
          });
        }
      } else if (primaryAction === "SUPERSEDE" && supersededId) {
        await supersede(supersededId, newMemory);
      } else {
        await appendMemory(newMemory);
        for (const pair of pairsForThisNew) {
          if (pair.action === "LINK" && pair.existingMemoryId) {
            await createLink({
              id: uuidv4(),
              fromId: nm.id,
              toId: pair.existingMemoryId,
              relation: "related",
              createdAt: Date.now(),
            });
          }
        }
      }

      extractedMemories.push(newMemory);
    }

    // ── Build diagnostic alignment context for Evaluation Judge ──────────────
    for (const chunk of chunks) {
      const tr = triageResults.find((r) => r.chunkId === chunk.id);
      const ext = validExtractions.find((e) => e.chunkId === chunk.id);
      const nmIndex = validExtractions.findIndex((e) => e.chunkId === chunk.id);
      const nm = nmIndex >= 0 ? newMemoryObjects[nmIndex] : undefined;
      const mutation = nm ? mutationResults.find((r) => r.newMemoryId === nm.id && r.action !== "APPEND") || mutationResults.find((r) => r.newMemoryId === nm.id) : undefined;
      const targetMem = mutation?.existingMemoryId
        ? allMemories.find((m) => m.id === mutation.existingMemoryId)
        : undefined;

      const candidates = (relatedMemoriesMap[chunk.id] || []).map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
      }));

      const relationChoices: Record<string, "related" | "unrelated"> = {};
      if (tr?.memoryRelations) {
        for (const [memId, rel] of Object.entries(tr.memoryRelations)) {
          relationChoices[memId] = rel.choice;
        }
      }

      // If chunk passed and memory was extracted, it was durably saved to IndexedDB (as APPEND, SUPERSEDE, or LINK)
      let resolvedMutation: ChunkDiagnosticContext["resolvedMutation"] = undefined;
      if (ext) {
        resolvedMutation = {
          action: mutation?.action || "APPEND",
          targetMemoryId: mutation?.existingMemoryId || undefined,
          targetMemoryContent: targetMem?.content,
        };
      }

      chunkDiagnostics.push({
        chunkId: chunk.id,
        chunkText: chunk.text,
        candidateMemories: candidates,
        forwardedMemoryIds: tr?.forwardedMemoryIds || [],
        relationChoices: Object.keys(relationChoices).length > 0 ? relationChoices : undefined,
        passedGate: tr?.passedGate ?? false,
        extractedMemory: ext ? { content: ext.mem.content, type: ext.mem.type, confidence: ext.mem.confidence } : undefined,
        resolvedMutation,
      });
    }

    const result = buildResult(
      "jev-pipeline",
      stages,
      triageResults,
      extractedMemories,
      mutationResults,
      runStart,
      options,
      chunkDiagnostics
    );
    onEvent({ type: "complete", result });
    return result;
  } catch (err) {
    onEvent({ type: "error", message: String(err) });
    throw err;
  }
}

// ─── GEMINI SINGLE-SHOT PIPELINE ─────────────────────────────────────────────

export async function runGeminiSingleShotPipeline(
  chunks: Chunk[],
  geminiModel: string,
  onEvent: PipelineCallback
): Promise<PipelineRunResult> {
  const stages: StageMetrics[] = [];
  const runStart = Date.now();

  onEvent({ type: "stage_start", stage: "Gemini Single-shot (All-in-One)" });
  const allMemories = await getActiveMemories();
  const { memories, filteredChunkIds, inputTokens, outputTokens, latencyMs } =
    await runGeminiSingleShot(chunks, allMemories, geminiModel);

  const stageMetrics: StageMetrics = {
    name: "Gemini Single-shot (All-in-One)",
    latencyMs,
    inputTokens,
    outputTokens,
    costUsd: calcGeminiCost(geminiModel, inputTokens, outputTokens),
  };
  stages.push(stageMetrics);
  onEvent({ type: "stage_complete", stage: stageMetrics.name, metrics: stageMetrics });

  const extractedMemories: Memory[] = memories.map((m) => ({
    id: uuidv4(),
    content: m.content,
    type: m.type,
    status: "active" as const,
    sourceChunkId: m.chunkId,
    confidence: m.confidence,
    createdAt: Date.now(),
  }));

  // Map dummy triage results for UI display
  const triageResults: JevTriageResult[] = chunks.map((c) => {
    const isFiltered = filteredChunkIds.includes(c.id);
    return {
      chunkId: c.id,
      knowledgeProbability: isFiltered ? 0.1 : 0.9,
      worthinessScore: isFiltered ? 0 : 3,
      hasMemoryDelta: !isFiltered,
      deltaProbability: isFiltered ? 0.1 : 0.9,
      hasContradiction: false,
      contradictionProbability: 0.0,
      passedGate: !isFiltered,
      reason: isFiltered ? "Discarded by single-shot Gemini prompt" : "Extracted by single-shot Gemini prompt",
      candidateMemoryIds: [],
      forwardedMemoryIds: [],
    };
  });

  const mutationResults: JevMutationResult[] = memories
    .filter((m) => m.suggestedAction && m.targetMemoryId)
    .map((m) => ({
      newMemoryId: uuidv4(),
      existingMemoryId: m.targetMemoryId!,
      action: m.suggestedAction!,
      confidence: m.confidence,
    }));

  const chunkDiagnostics: ChunkDiagnosticContext[] = chunks.map((c) => {
    const isFiltered = filteredChunkIds.includes(c.id);
    const mem = memories.find((m) => m.chunkId === c.id);
    const mut = mutationResults.find((mr) => mr.existingMemoryId && mem?.targetMemoryId === mr.existingMemoryId);
    const targetMem = mut ? allMemories.find((m) => m.id === mut.existingMemoryId) : undefined;
    return {
      chunkId: c.id,
      chunkText: c.text,
      candidateMemories: allMemories.map((m) => ({ id: m.id, content: m.content, type: m.type })),
      forwardedMemoryIds: allMemories.map((m) => m.id),
      passedGate: !isFiltered,
      extractedMemory: mem ? { content: mem.content, type: mem.type, confidence: mem.confidence } : undefined,
      resolvedMutation: mut
        ? {
            action: mut.action,
            targetMemoryId: mut.existingMemoryId,
            targetMemoryContent: targetMem?.content,
          }
        : undefined,
    };
  });

  const result = buildResult(
    "gemini-singleshot",
    stages,
    triageResults,
    extractedMemories,
    mutationResults,
    runStart,
    undefined,
    chunkDiagnostics
  );
  onEvent({ type: "complete", result });
  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildResult(
  mode: PipelineRunResult["mode"],
  stages: StageMetrics[],
  triageResults: JevTriageResult[],
  extractedMemories: Memory[],
  mutationResults: JevMutationResult[],
  runStart: number,
  pipelineOptions?: PipelineOptions,
  chunkDiagnostics?: ChunkDiagnosticContext[]
): PipelineRunResult {
  const chunksFiltered = triageResults.filter((r) => !r.passedGate).length;
  const chunksProcessed = triageResults.filter((r) => r.passedGate).length;
  return {
    mode,
    stages,
    totalLatencyMs: Date.now() - runStart,
    totalCostUsd: stages.reduce((s, st) => s + st.costUsd, 0),
    memoriesGenerated: extractedMemories.length,
    chunksFiltered,
    chunksProcessed,
    triageResults,
    extractedMemories,
    mutationResults,
    pipelineOptions,
    chunkDiagnostics,
    timestamp: Date.now(),
  };
}
