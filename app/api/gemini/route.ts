import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

// ─── Extraction Schema (Batch Chunks) ────────────────────────────────────────

const batchExtractSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    memories: {
      type: SchemaType.ARRAY,
      description: "Meaningful persistent atomic memories extracted from the chunks.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          chunkId: { type: SchemaType.INTEGER },
          content: { type: SchemaType.STRING, description: "A clear, concise memory statement." },
          type: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["semantic", "episodic", "procedural", "fact", "preference"],
          },
          confidence: { type: SchemaType.NUMBER, description: "Confidence from 0.0 to 1.0." },
        },
        required: ["chunkId", "content", "type", "confidence"],
      },
    },
  },
  required: ["memories"],
};

// ─── Mutation Schema (Single Memory vs Existing) ─────────────────────────────

const geminiMutationSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    results: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          existingMemoryId: { type: SchemaType.STRING },
          action: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["APPEND", "EXTEND", "SUPERSEDE", "UNRELATED"],
          },
          confidence: { type: SchemaType.NUMBER },
        },
        required: ["existingMemoryId", "action", "confidence"],
      }
    }
  },
  required: ["results"]
};

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
    }

    const body = await req.json();
    const { model = "gemini-3.8-flash", mode } = body;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // ── Mode: Batch Extract ──────────────────────────────────────────────────
    if (mode === "batch-extract") {
      const { chunks = [] } = body;

      const prompt = `You are an atomic memory generator. You are provided with multiple text chunks.
Extract the single most important atomic memory (fact, preference, rule, decision) from each chunk. Return an array of these memories.

Chunks to Analyze:
${chunks.map((c: any) => `[Chunk ID ${c.id}]\n"""\n${c.text}\n"""`).join("\n\n")}
`;

      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: batchExtractSchema,
        },
      });

      const start = performance.now();
      const result = await geminiModel.generateContent(prompt);
      const latencyMs = performance.now() - start;
      const response = result.response;

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      let memories: unknown[] = [];
      try {
        const parsed = JSON.parse(response.text());
        memories = parsed.memories || [];
      } catch (e) {
        console.error(`[Gemini Batch Extract] Error parsing JSON:`, e);
      }

      return NextResponse.json({ memories, inputTokens, outputTokens, latencyMs });
    }

    // ── Mode: Gemini Mutation ────────────────────────────────────────────────
    if (mode === "gemini-mutation") {
      const { newMemory, existingMemories = [] } = body;

      const prompt = `You are a memory mutation judge. You are given a NEW memory claim and a list of EXISTING related memories.
For EACH existing memory, decide how the new memory relates to it based on the following rubric:
- UNRELATED: No meaningful semantic relationship.
- APPEND: Restates the same fact without materially new information.
- EXTEND: Adds materially new information, context, or detail. Both can be true.
- SUPERSEDE: Changes or replaces the value of the same attribute (e.g. updating a policy). The existing is outdated.

New Memory:
"""
${newMemory.content}
"""

Existing Memories:
${existingMemories.map((m: any) => `[ID: ${m.id}]\n${m.content}`).join("\n\n")}

Return an array of results for each existing memory.`;

      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: geminiMutationSchema,
        },
      });

      const start = performance.now();
      const result = await geminiModel.generateContent(prompt);
      const latencyMs = performance.now() - start;
      const response = result.response;

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      let results: unknown[] = [];
      try {
        const parsed = JSON.parse(response.text());
        results = parsed.results || [];
      } catch (e) {
        console.error(`[Gemini Mutation] Error parsing JSON:`, e);
      }

      return NextResponse.json({ results, inputTokens, outputTokens, latencyMs });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    console.error(`[Gemini API Route] Fatal error:`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
