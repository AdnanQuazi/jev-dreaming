import type { Chunk, Memory, ExtractedMemory, MemoryType, MutationAction, JevMutationResult } from "@/types";

// ─── Stage 2: Batch Memory Extraction ────────────────────────────────────────

export async function extractMemoriesFromChunks(
  chunks: Chunk[],
  model: string
): Promise<{
  memories: ExtractedMemory[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  if (chunks.length === 0) {
    return { memories: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }

  const start = performance.now();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunks: chunks.map(c => ({ id: c.id, text: c.text })),
      model,
      mode: "batch-extract"
    }),
  });
  const latencyMs = performance.now() - start;

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini batch-extract error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const memories: ExtractedMemory[] = (data.memories || []).map((m: any) => ({
    content: m.content,
    type: m.type as MemoryType,
    confidence: m.confidence,
    chunkId: m.chunkId
  }));

  return {
    memories,
    inputTokens: data.inputTokens ?? 0,
    outputTokens: data.outputTokens ?? 0,
    latencyMs
  };
}

// ─── Stage 3: Gemini Mutation Judge (for Compare mode) ───────────────────────

export async function runGeminiMutationJudge(
  newMem: { id: string; content: string },
  existingMemories: Memory[],
  model: string
): Promise<{
  results: JevMutationResult[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  if (existingMemories.length === 0) {
    return { results: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }

  const start = performance.now();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      newMemory: newMem,
      existingMemories: existingMemories.map(m => ({ id: m.id, content: m.content })),
      model,
      mode: "gemini-mutation"
    }),
  });
  const latencyMs = performance.now() - start;

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini mutation error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const results: JevMutationResult[] = (data.results || []).map((r: any) => ({
    newMemoryId: newMem.id,
    existingMemoryId: r.existingMemoryId,
    action: r.action as MutationAction,
    confidence: r.confidence ?? 0.85
  }));

  return {
    results,
    inputTokens: data.inputTokens ?? 0,
    outputTokens: data.outputTokens ?? 0,
    latencyMs
  };
}
