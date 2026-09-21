import type { Chunk, Memory, PipelineRunResult, EvaluationJudgeResult } from "@/types";

export async function runQualityEvaluation(
  chunks: Chunk[],
  existingMemories: Memory[],
  jevResult?: PipelineRunResult,
  singleShotResult?: PipelineRunResult
): Promise<EvaluationJudgeResult | null> {
  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chunks,
        existingMemories,
        jevResult,
        singleShotResult,
      }),
    });

    if (!res.ok) {
      console.warn(`Evaluation API failed with status ${res.status}`);
      return null;
    }

    const data: EvaluationJudgeResult = await res.json();
    return data;
  } catch (err) {
    console.error("Failed to run quality evaluation:", err);
    return null;
  }
}
