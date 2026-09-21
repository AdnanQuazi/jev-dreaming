import type { Chunk, Memory, ExtractedMemory, MemoryType, MutationAction } from "@/types";

// ─── Gemini extraction call (via Next.js route handler) ───────────────────────

export async function extractMemoryWithGemini(
  chunk: Chunk,
  relatedMemories: Memory[],
  model: string,
  mutationStrategy: "jev" | "gemini" = "jev"
): Promise<{
  extraction: ExtractedMemory | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const start = Date.now();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunk: chunk.text,
      chunkId: chunk.id,
      relatedMemories: relatedMemories.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
      })),
      model,
      mode: "extract",
      mutationStrategy,
    }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as {
    extraction: {
      content: string;
      type: MemoryType;
      confidence: number;
      suggestedAction?: MutationAction;
      targetMemoryId?: string;
    } | null;
    inputTokens: number;
    outputTokens: number;
  };
  const extraction: ExtractedMemory | null = data.extraction
    ? {
        content: data.extraction.content,
        type: data.extraction.type,
        confidence: data.extraction.confidence,
        chunkId: chunk.id,
        suggestedAction: data.extraction.suggestedAction,
        targetMemoryId: data.extraction.targetMemoryId,
      }
    : null;
  return { extraction, inputTokens: data.inputTokens, outputTokens: data.outputTokens, latencyMs };
}

// ─── Gemini Single-shot (Monolithic all-in-one prompt) ───────────────────────

export async function runGeminiSingleShot(
  chunks: Chunk[],
  existingMemories: Memory[],
  model: string
): Promise<{
  memories: ExtractedMemory[];
  filteredChunkIds: number[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const start = Date.now();
  const res = await fetch("/api/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chunks: chunks.map((c) => ({ id: c.id, text: c.text })),
      existingMemories: existingMemories.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.type,
      })),
      model,
      mode: "singleshot",
    }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) throw new Error(`Gemini singleshot error ${res.status}`);
  const data = await res.json();
  return {
    memories: (data.memories || []).map((m: any) => ({
      content: m.content,
      type: m.type as MemoryType,
      confidence: m.confidence,
      chunkId: m.chunkId,
      suggestedAction: m.suggestedAction as MutationAction,
      targetMemoryId: m.targetMemoryId,
    })),
    filteredChunkIds: data.filteredChunkIds || [],
    inputTokens: data.inputTokens ?? 0,
    outputTokens: data.outputTokens ?? 0,
    latencyMs,
  };
}
