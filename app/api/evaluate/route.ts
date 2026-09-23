import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";
import type { Chunk, Memory, PipelineRunResult } from "@/types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const EVALUATOR_MODEL = "gemini-3.8-flash";

const scorecardSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    chunkClassificationScore: {
      type: SchemaType.INTEGER,
      description: "Score 1-10 on correctly filtering out boilerplate/noise and passing meaningful chunks.",
    },
    memoryGenerationScore: {
      type: SchemaType.INTEGER,
      description: "Score 1-10 on capturing all important durable facts accurately without omissions.",
    },
    mutationAccuracyScore: {
      type: SchemaType.INTEGER,
      description: "Score 1-10 on overall mutation accuracy across Append, Extend, Supersede, and Unrelated actions.",
    },
    overallScore: {
      type: SchemaType.NUMBER,
      description: "Overall quality rating from 1.0 to 10.0.",
    },
    critique: {
      type: SchemaType.STRING,
      description: "Concise qualitative critique (2-4 sentences) detailing strengths, specific errors, missed facts, or wrong mutations.",
    },
  },
  required: [
    "chunkClassificationScore",
    "memoryGenerationScore",
    "mutationAccuracyScore",
    "overallScore",
    "critique",
  ],
};

const evaluationJudgeSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    jevEvaluation: { ...scorecardSchema, nullable: true },
    singleShotEvaluation: { ...scorecardSchema, nullable: true },
    comparisonSummary: {
      type: SchemaType.STRING,
      description: "Comparative breakdown comparing the approaches on accuracy, detail retention, and deduplication.",
    },
    winner: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["with-jev", "without-jev", "tie"],
      description: "Overall winning approach.",
    },
  },
  required: ["comparisonSummary", "winner"],
};

function formatPipelineDiagnostics(result: PipelineRunResult): string {
  if (!result.chunkDiagnostics || result.chunkDiagnostics.length === 0) {
    return `
- Memories Generated (${result.extractedMemories.length}):
${result.extractedMemories.map((m) => `  * [From Chunk ${m.sourceChunkId}] [${m.type}] ${m.content}`).join("\n")}
- Mutations Detected (${result.mutationResults.length}):
${result.mutationResults.map((r) => `  * ${r.action} -> target: [${r.existingMemoryId || "new"}]`).join("\n")}
- Filtered Chunks: ${result.chunksFiltered} dropped.`;
  }

  return result.chunkDiagnostics
    .map((cd) => {
      const mutationFormatted = cd.resolvedMutations && cd.resolvedMutations.length > 0
        ? cd.resolvedMutations.map(m => `${m.action} -> [${m.targetMemoryId}: "${m.targetMemoryContent || ""}"]`).join(", ")
        : (cd.passedGate && cd.extractedMemory ? "APPEND (independent new entry inserted into database)" : "None (Chunk dropped by classifier)");

      return `[Chunk ${cd.chunkId}]
Text: """${cd.chunkText}"""
Classifier Gate: ${cd.passedGate ? "PASSED" : "DROPPED (Boilerplate/Noise)"}
${cd.extractedMemory ? `Extracted Memory: [${cd.extractedMemory.type}] "${cd.extractedMemory.content}"` : "Extracted Memory: None"}
Resolved Mutation: ${mutationFormatted}`;
    })
    .join("\n\n");
}

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
    }

    const {
      chunks,
      existingMemories = [],
      dreamingResult,
      geminiResult,
    }: {
      chunks: Chunk[];
      existingMemories: Memory[];
      dreamingResult?: PipelineRunResult;
      geminiResult?: PipelineRunResult;
    } = await req.json();

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({
      model: EVALUATOR_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: evaluationJudgeSchema,
      },
    });

    const prompt = `You are an expert AI Memory Evaluation Judge. Your job is to objectively score and critique the memory extraction and mutation results against the ground truth ingested text chunks and pre-existing database memories.

Ground Truth Ingested Chunks (${chunks.length} total):
${chunks.map((c) => `[Chunk ${c.id}]\n"""\n${c.text}\n"""`).join("\n\n")}

Existing Database Memories (Before Ingestion):
${existingMemories.map((m) => `- [ID: ${m.id}] [${m.type}] ${m.content}`).join("\n")}

${
  dreamingResult
    ? `
=== PIPELINE A: With Jev Results ===
Summary: ${dreamingResult.memoriesGenerated} memories generated, ${dreamingResult.chunksFiltered} chunks dropped.

Per-Chunk Execution Details & Alignments:
${formatPipelineDiagnostics(dreamingResult)}
`
    : "(Pipeline A Dreaming not provided)"
}

${
  geminiResult
    ? `
=== PIPELINE B: Without Jev Results ===
Summary: ${geminiResult.memoriesGenerated} memories generated, ${geminiResult.chunksFiltered} chunks dropped.

Per-Chunk Execution Details & Alignments:
${formatPipelineDiagnostics(geminiResult)}
`
    : "(Pipeline B Gemini not provided)"
}

Evaluation Criteria:
1. Chunk Classification (1-10): Were boilerplate and noise chunks correctly dropped, and meaningful chunks passed?
2. Memory Generation (1-10): Were all durable, important facts accurately extracted as atomic memories from the passed chunks?
3. Mutation Accuracy (1-10): Did it correctly decide between Append, Extend, Supersede, and Unrelated?
   - Append: Novel facts without overwriting.
   - Extend: Added details related to existing facts.
   - Supersede: Updated/replaced outdated facts with the correct target memory ID.
   - Unrelated: Skipped linking when there's no semantic relationship.

Evaluate the provided pipeline(s) with high rigor, ensuring you inspect whether each chunk was properly handled. Return the structured JSON scorecard.`;

    const start = performance.now();
    const result = await model.generateContent(prompt);
    const latencyMs = performance.now() - start;

    const parsed = JSON.parse(result.response.text());

    return NextResponse.json({
      ...parsed,
      evaluatorModel: EVALUATOR_MODEL,
      latencyMs,
    });
  } catch (err) {
    console.error("[Evaluation Judge Error]:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
