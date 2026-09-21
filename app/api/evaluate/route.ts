import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";
import type { Chunk, Memory, PipelineRunResult } from "@/types";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const EVALUATOR_MODEL = "gemini-3.8-flash";

const scorecardSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    completenessScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on capturing all important durable facts from worthy chunks without omissions.",
    },
    noiseFiltrationScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on correctly rejecting conversational noise, filler, greetings, and trivial comments.",
    },
    mutationAccuracyScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on overall mutation accuracy across append, supersede, and link actions.",
    },
    appendAccuracyScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on accurately appending genuinely new facts without creating redundant duplicates or false overwrites.",
    },
    supersedeAccuracyScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on correctly identifying outdated or superseded facts (e.g. auth migration, launch updates, policy changes) and targeting the exact right existing memory.",
    },
    linkAccuracyScore: {
      type: SchemaType.INTEGER,
      description:
        "Score 1-10 on appropriately linking related non-conflicting facts covering the same entity/topic instead of overwriting.",
    },
    overallScore: {
      type: SchemaType.NUMBER,
      description: "Overall quality rating from 1.0 to 10.0.",
    },
    critique: {
      type: SchemaType.STRING,
      description:
        "Concise qualitative critique (2-4 sentences) detailing strengths, specific errors, missed facts, or wrong mutations.",
    },
  },
  required: [
    "completenessScore",
    "noiseFiltrationScore",
    "mutationAccuracyScore",
    "appendAccuracyScore",
    "supersedeAccuracyScore",
    "linkAccuracyScore",
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
      description:
        "Comparative breakdown comparing the approaches on accuracy, detail retention, and deduplication.",
    },
    winner: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["jev-pipeline", "gemini-singleshot", "tie"],
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
      const candidatesFormatted =
        cd.candidateMemories.length > 0
          ? cd.candidateMemories
              .map(
                (m) =>
                  `    - [${m.id}] [${m.type}] "${m.content}" -> Jev Gating Decision: ${
                    cd.relationChoices?.[m.id] ? cd.relationChoices[m.id].toUpperCase() : "FORWARDED"
                  }`
              )
              .join("\n")
          : "    (None / Cold start)";

      const mutationFormatted = cd.resolvedMutation
        ? `${cd.resolvedMutation.action}${
            cd.resolvedMutation.targetMemoryId
              ? ` targeting [${cd.resolvedMutation.targetMemoryId}: "${cd.resolvedMutation.targetMemoryContent || ""}"]`
              : " (independent new entry inserted into database)"
          }`
        : cd.passedGate && cd.extractedMemory
        ? "APPEND (independent new entry inserted into database)"
        : "None (Chunk dropped by triage gate)";

      return `[Chunk ${cd.chunkId}]
Text: """${cd.chunkText}"""
Candidate Existing Memories Evaluated:
${candidatesFormatted}
Triage Gate: ${cd.passedGate ? "PASSED" : "DROPPED (Noise/Filler)"}
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
      jevResult,
      singleShotResult,
    }: {
      chunks: Chunk[];
      existingMemories: Memory[];
      jevResult?: PipelineRunResult;
      singleShotResult?: PipelineRunResult;
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
  jevResult
    ? `
=== PIPELINE A: Jev + Gemini Pipeline Results ===
Configuration: Mutation Strategy = ${jevResult.pipelineOptions?.mutationStrategy || "jev"}, Memory Gating = ${
        jevResult.pipelineOptions?.gateMemories ? "Jev Gated" : "All Candidates"
      }
Summary: ${jevResult.memoriesGenerated} memories generated, ${jevResult.chunksFiltered} chunks dropped.

Per-Chunk Execution Details & Alignments:
${formatPipelineDiagnostics(jevResult)}
`
    : "(Pipeline A Jev not provided)"
}

${
  singleShotResult
    ? `
=== PIPELINE B: Gemini Single-shot Results ===
Summary: ${singleShotResult.memoriesGenerated} memories generated, ${singleShotResult.chunksFiltered} chunks dropped.

Per-Chunk Execution Details & Alignments:
${formatPipelineDiagnostics(singleShotResult)}
`
    : "(Pipeline B Single-shot not provided)"
}

Evaluation Criteria:
1. Completeness (1-10): Were all durable, important facts extracted from worthy chunks without omissions?
2. Noise Filtration (1-10): Did the system correctly filter out trivial filler (greetings, weather, small talk) without polluting the knowledge base?
3. Mutation Accuracy (1-10):
   - Correct APPEND (1-10): Did it cleanly add novel facts without overwriting other records or creating duplicates?
   - Correct SUPERSEDE (1-10): Did it accurately supersede outdated or contradicted facts (e.g. auth migration from session cookies to JWT RS256, Project Nexus planning to launch, rate limiting policy update from 500 to 1000 rpm) by referencing the correct target memory ID?
   - Correct LINK (1-10): Did it link complementary non-conflicting memories about the same entity/topic instead of overwriting?

Evaluate the provided pipeline(s) with high rigor, ensuring you inspect whether each chunk's candidate memories were properly handled. Return the structured JSON scorecard.`;

    console.log(`[Evaluation Judge] Running Gemini 3.8 Flash evaluation with full chunk diagnostics...`);
    const start = Date.now();
    const result = await model.generateContent(prompt);
    const latencyMs = Date.now() - start;
    console.log(`[Evaluation Judge] Completed evaluation in ${latencyMs}ms`);

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
