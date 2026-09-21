import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI, Schema, SchemaType } from "@google/generative-ai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

interface RelatedMemory {
  id: string;
  content: string;
  type: string;
}

// ─── Extraction Schema (Single Chunk - Jev Mutation) ─────────────────────────

const extractionSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    memory: {
      type: SchemaType.STRING,
      description:
        "A clear, concise statement of the fact, preference, event, or rule (max 200 chars). Set to empty string if chunk has no durable knowledge.",
    },
    memoryType: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["semantic", "episodic", "procedural"],
      description: "Classification of memory.",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence from 0.0 to 1.0.",
    },
  },
  required: ["memory", "memoryType", "confidence"],
};

// ─── Extraction Schema (Single Chunk - Gemini Mutation) ──────────────────────

const extractionWithMutationSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    memory: {
      type: SchemaType.STRING,
      description:
        "A clear, concise statement of the fact, preference, event, or rule (max 200 chars). Set to empty string if chunk has no durable knowledge.",
    },
    memoryType: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["semantic", "episodic", "procedural"],
      description: "Classification of memory.",
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: "Confidence from 0.0 to 1.0.",
    },
    action: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["APPEND", "SUPERSEDE", "LINK"],
      description:
        "Action relative to existing memories: APPEND for novel fact; SUPERSEDE if updating/correcting existing memory; LINK if related non-conflicting facet.",
    },
    targetMemoryId: {
      type: SchemaType.STRING,
      description:
        "ID of existing memory to SUPERSEDE or LINK, or empty string if APPEND.",
    },
  },
  required: ["memory", "memoryType", "confidence", "action"],
};

// ─── Single-Shot Monolithic Schema (All 10 Chunks) ──────────────────────────

const singleShotSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    extractedMemories: {
      type: SchemaType.ARRAY,
      description: "Meaningful persistent memories extracted across the chunks.",
      items: {
        type: SchemaType.OBJECT,
        properties: {
          chunkId: {
            type: SchemaType.INTEGER,
            description: "ID of the source chunk.",
          },
          memory: {
            type: SchemaType.STRING,
            description: "Clear concise memory statement.",
          },
          memoryType: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["semantic", "episodic", "procedural"],
          },
          action: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["APPEND", "SUPERSEDE", "LINK"],
            description: "Action relative to existing knowledge base.",
          },
          targetMemoryId: {
            type: SchemaType.STRING,
            description:
              "ID of existing memory to supersede or link, or empty string if APPEND.",
          },
          confidence: {
            type: SchemaType.NUMBER,
            description: "Confidence from 0.0 to 1.0.",
          },
        },
        required: ["chunkId", "memory", "memoryType", "action", "confidence"],
      },
    },
    filteredChunkIds: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.INTEGER },
      description: "List of chunk IDs filtered out as trivial chatter, greetings, or filler.",
    },
  },
  required: ["extractedMemories", "filteredChunkIds"],
};

export async function POST(req: NextRequest) {
  try {
    if (!GEMINI_API_KEY) {
      return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });
    }

    const body = await req.json();
    const { model = "gemini-3.8-flash", mode, mutationStrategy = "jev" } = body;

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // ── Mode: Extract (1 passed chunk) ───────────────────────────────────────
    if (mode === "extract") {
      const { chunk, relatedMemories = [], chunkId = 0 } = body;

      const memContext =
        relatedMemories.length > 0
          ? `\nRelevant existing memories for context:\n${relatedMemories
              .map((m: RelatedMemory, i: number) => `${i + 1}. [${m.type}] (ID: ${m.id}) ${m.content}`)
              .join("\n")}`
          : "\n(No existing memories)";

      const isGeminiMutation = mutationStrategy === "gemini";

      const prompt = isGeminiMutation
        ? `You are a memory extraction and mutation engine. Analyze the following text chunk and extract the single most important durable memory.
Then, determine how this new memory should be integrated relative to the existing memories:
- APPEND: Genuinely novel and independent fact. Both should coexist.
- SUPERSEDE: Directly updates, replaces, or corrects an existing memory (specify targetMemoryId).
- LINK: Related facet of the same topic (specify targetMemoryId).

Text Chunk:
"""
${chunk}
"""
${memContext}

Extract the persistent memory statement, classification, and the appropriate mutation action. If the chunk contains no durable memory, set memory to an empty string and action to APPEND.`
        : `You are a memory extraction engine. Analyze the following text chunk and extract the single most important durable memory.

Text Chunk:
"""
${chunk}
"""
${memContext}

Extract the persistent memory. If the chunk contains no durable memory, set memory to an empty string.`;

      const activeSchema = isGeminiMutation ? extractionWithMutationSchema : extractionSchema;

      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: activeSchema,
        },
      });

      console.log(
        `[Gemini Extract] Generating content for chunkId ${chunkId} with model ${model} (mutation: ${mutationStrategy})...`
      );
      const start = Date.now();
      const result = await geminiModel.generateContent(prompt);
      const latencyMs = Date.now() - start;
      const response = result.response;
      console.log(`[Gemini Extract] Completed chunkId ${chunkId} in ${latencyMs}ms`);

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      let extraction = null;
      try {
        const parsed = JSON.parse(response.text());
        if (parsed.memory && parsed.memory.trim().length > 0) {
          extraction = {
            content: parsed.memory,
            type: parsed.memoryType,
            confidence: parsed.confidence ?? 0.85,
            chunkId,
            suggestedAction: isGeminiMutation ? parsed.action || "APPEND" : undefined,
            targetMemoryId: isGeminiMutation && parsed.targetMemoryId ? parsed.targetMemoryId : undefined,
          };
        }
      } catch (e) {
        console.error(`[Gemini Extract] Error parsing structured JSON:`, e);
      }

      return NextResponse.json({ extraction, inputTokens, outputTokens, latencyMs });
    }

    // ── Mode: Single-shot (Monolithic all-in-one prompt) ─────────────────────
    if (mode === "singleshot") {
      const { chunks, existingMemories = [] } = body;

      const memContext =
        existingMemories.length > 0
          ? `\nExisting Memories in Knowledge Base:\n${existingMemories
              .map((m: RelatedMemory) => `- [ID: ${m.id}] [${m.type}] ${m.content}`)
              .join("\n")}`
          : "\n(No existing memories in database)";

      const prompt = `You are an all-in-one memory engine. You are provided with 10 ingested text chunks and current knowledge base memories.

Your tasks:
1. Filter out chunks that are casual chit-chat, greetings, or transient noise (add their IDs to filteredChunkIds).
2. For worthy chunks, extract the concise factual memory, user preference, event, or rule.
3. Determine the mutation action for each extracted memory relative to Existing Memories:
   - APPEND: Genuinely novel and independent.
   - SUPERSEDE: Directly updates, corrects, or replaces an existing memory (specify targetMemoryId).
   - LINK: Related aspect of the same topic (specify targetMemoryId).

Chunks to Analyze:
${chunks.map((c: { id: number; text: string }) => `[Chunk ID ${c.id}]\n"""\n${c.text}\n"""`).join("\n\n")}
${memContext}
`;

      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: singleShotSchema,
        },
      });

      console.log(`[Gemini Single-shot] Running monolithic prompt for ${chunks.length} chunks with model ${model}...`);
      const start = Date.now();
      const result = await geminiModel.generateContent(prompt);
      const latencyMs = Date.now() - start;
      const response = result.response;
      console.log(`[Gemini Single-shot] Completed in ${latencyMs}ms`);

      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

      let memories: unknown[] = [];
      let filteredChunkIds: number[] = [];

      try {
        const parsed = JSON.parse(response.text());
        memories = (parsed.extractedMemories || []).map((m: any) => ({
          content: m.memory,
          type: m.memoryType,
          confidence: m.confidence ?? 0.85,
          chunkId: m.chunkId,
          suggestedAction: m.action,
          targetMemoryId: m.targetMemoryId || undefined,
        }));
        filteredChunkIds = parsed.filteredChunkIds || [];
      } catch (e) {
        console.error(`[Gemini Single-shot] Error parsing structured JSON:`, e);
      }

      return NextResponse.json({
        memories,
        filteredChunkIds,
        inputTokens,
        outputTokens,
        latencyMs,
      });
    }

    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    console.error(`[Gemini API Route] Fatal error:`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
