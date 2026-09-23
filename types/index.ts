// ─────────────────────────────────────────────
// Memory types
// ─────────────────────────────────────────────

export type MemoryType = "semantic" | "episodic" | "procedural" | "fact" | "preference";
export type MemoryStatus = "active" | "superseded";
export type MutationAction = "APPEND" | "EXTEND" | "SUPERSEDE" | "UNRELATED";

export interface Memory {
  id: string;
  content: string;
  type: MemoryType;
  status: MemoryStatus;
  sourceChunkId: number;
  confidence: number;
  createdAt: number;
  supersededBy?: string; // id of the memory that replaced this
  tags?: string[];
}

export interface MemoryLink {
  id: string;
  fromId: string;
  toId: string;
  relation: "related" | "supports" | "contrasts";
  createdAt: number;
}

// ─────────────────────────────────────────────
// Chunk types
// ─────────────────────────────────────────────

export interface Chunk {
  id: number;
  text: string;
  label?: string;
}

export interface ChunkWithMemories {
  chunk: Chunk;
  relatedMemories: Memory[];
}

// ─────────────────────────────────────────────
// Jev stage types
// ─────────────────────────────────────────────

export interface MemoryRelationResult {
  choice: "related" | "unrelated";
  confidence: number;
  probabilities?: Record<string, number>;
}

export interface JevTriageResult {
  chunkId: number;
  knowledgeProbability: number; // 0.0 to 1.0 from contains_memorable_knowledge.noul
  passedGate: boolean; // knowledgeProbability >= 0.4
  reason: string;
}

export interface JevMutationResult {
  newMemoryId: string;
  existingMemoryId: string;
  action: MutationAction;
  confidence: number;
}

// ─────────────────────────────────────────────
// Per-Chunk Diagnostic & Evaluation Alignment Context
// ─────────────────────────────────────────────

export interface ChunkDiagnosticContext {
  chunkId: number;
  chunkText: string;
  passedGate: boolean;
  extractedMemory?: { content: string; type: MemoryType; confidence: number };
  resolvedMutations?: Array<{
    action: MutationAction;
    targetMemoryId?: string;
    targetMemoryContent?: string;
  }>;
}

// ─────────────────────────────────────────────
// LLM Extraction types
// ─────────────────────────────────────────────

export interface ExtractedMemory {
  content: string;
  type: MemoryType;
  confidence: number;
  chunkId: number;
  suggestedAction?: MutationAction;
  targetMemoryId?: string;
}

// ─────────────────────────────────────────────
// Quality Evaluation types (Gemini 3.8 Flash Judge)
// ─────────────────────────────────────────────

export interface QualityScorecard {
  chunkClassificationScore: number; // 1-10: correct chunks dropped
  memoryGenerationScore: number; // 1-10: extracted memories factual and correct
  mutationAccuracyScore: number; // 1-10: correct mutation operations
  overallScore: number; // 1-10
  critique: string;
}

export interface EvaluationJudgeResult {
  jevEvaluation?: QualityScorecard;
  singleShotEvaluation?: QualityScorecard;
  comparisonSummary?: string;
  winner?: "dreaming-pipeline" | "gemini-pipeline" | "tie";
  evaluatorModel: string;
  latencyMs: number;
}

// ─────────────────────────────────────────────
// Pipeline events (for live callbacks)
// ─────────────────────────────────────────────

export type PipelineEvent =
  | { type: "stage_start"; stage: string }
  | { type: "stage_complete"; stage: string; metrics: StageMetrics }
  | {
      type: "chunk_result";
      chunkId: number;
      knowledgeProbability: number;
      passedGate: boolean;
      forwardedCount: number;
      totalCandidates: number;
      worthinessScore?: number;
      deltaProbability?: number;
      hasContradiction?: boolean;
      contradictionProbability?: number;
    }
  | { type: "extraction_result"; chunkId: number; memory: string; memType: MemoryType }
  | { type: "mutation_result"; action: MutationAction; newContent: string; existingContent?: string }
  | { type: "evaluation_result"; evaluation: EvaluationJudgeResult }
  | { type: "complete"; result: PipelineRunResult }
  | { type: "error"; message: string };

// ─────────────────────────────────────────────
// Pipeline run types
// ─────────────────────────────────────────────

export type PipelineMode = "dreaming-pipeline" | "gemini-pipeline";

export interface StageMetrics {
  name: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface PipelineRunResult {
  mode: PipelineMode;
  stages: StageMetrics[];
  totalLatencyMs: number;
  totalCostUsd: number;
  memoriesGenerated: number;
  chunksFiltered: number;
  chunksProcessed: number;
  triageResults: JevTriageResult[];
  extractedMemories: Memory[];
  generatedLinks: MemoryLink[];
  mutationResults: JevMutationResult[];
  chunkDiagnostics?: ChunkDiagnosticContext[];
  evaluation?: QualityScorecard;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Benchmark comparison
// ─────────────────────────────────────────────

export interface BenchmarkRun {
  id: string;
  runs: Partial<Record<PipelineMode, PipelineRunResult>>;
  geminiModel: string;
  evaluationJudge?: EvaluationJudgeResult;
  timestamp: number;
}

// ─────────────────────────────────────────────
// Gemini model config
// ─────────────────────────────────────────────

export interface GeminiModelConfig {
  id: string;
  name: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  contextWindow: string;
}

export const GEMINI_MODELS: GeminiModelConfig[] = [
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    inputCostPer1M: 0.30,
    outputCostPer1M: 2.50,
    contextWindow: "1M tokens",
  },
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    inputCostPer1M: 0.75,
    outputCostPer1M: 3.75,
    contextWindow: "1M tokens",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    inputCostPer1M: 1.50,
    outputCostPer1M: 9.00,
    contextWindow: "1M tokens",
  },
  {
    id: "gemini-3.1-pro",
    name: "Gemini 3.1 Pro",
    inputCostPer1M: 2.00,
    outputCostPer1M: 12.00,
    contextWindow: "2M tokens",
  },
];

// Jev pricing (from TypeSafe docs, jev-latest as of 2026-09)
export const JEV_PRICING = {
  inputCostPer1M: 0.042,
  outputCostPer1M: 0.00, // output is free
};

export function calcJevCost(inputTokens: number): number {
  return (inputTokens / 1_000_000) * JEV_PRICING.inputCostPer1M;
}

export function calcGeminiCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const model = GEMINI_MODELS.find((m) => m.id === modelId);
  if (!model) return 0;
  return (
    (inputTokens / 1_000_000) * model.inputCostPer1M +
    (outputTokens / 1_000_000) * model.outputCostPer1M
  );
}
