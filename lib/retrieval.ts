import type { Memory, Chunk } from "@/types";

/**
 * Simple keyword-based retrieval from IndexedDB memories.
 * Extracts meaningful tokens from a chunk's text and scores each memory
 * by how many tokens it shares. Returns top-K by score.
 */

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by",
  "from","is","are","was","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","may","might","shall","can",
  "it","its","this","that","these","those","i","we","you","he","she","they",
  "all","also","as","if","so","not","no","very","just","more","than","then",
  "when","where","who","which","what","how","there","their","they","them",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t))
  );
}

export function scoreMemory(chunk: Chunk, memory: Memory): number {
  const chunkTokens = tokenize(chunk.text);
  const memTokens = tokenize(memory.content);
  let matches = 0;
  for (const token of chunkTokens) {
    if (memTokens.has(token)) matches++;
  }
  // Jaccard similarity
  const union = new Set([...chunkTokens, ...memTokens]).size;
  return union === 0 ? 0 : matches / union;
}

/**
 * For each chunk, retrieve the top-K most relevant active memories.
 * Returns a map of chunkId → Memory[].
 */
export function retrieveRelatedMemories(
  chunks: Chunk[],
  allMemories: Memory[],
  topK = 5
): Record<number, Memory[]> {
  const activeMemories = allMemories.filter((m) => m.status === "active");
  const result: Record<number, Memory[]> = {};

  for (const chunk of chunks) {
    const scored = activeMemories
      .map((mem) => ({ mem, score: scoreMemory(chunk, mem) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    result[chunk.id] = scored.map(({ mem }) => mem);
  }

  return result;
}
