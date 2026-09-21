import type {
  Chunk,
  Memory,
  JevTriageResult,
  JevMutationResult,
  MutationAction,
} from "@/types";

// ─── Types for raw Jev API responses ─────────────────────────────────────────

interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}

interface NoulAnswer {
  type: "noul";
  noul: number;
}

interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

interface JevResponse {
  model: string;
  answers: Record<string, ScoreAnswer | NoulAnswer | ChoiceAnswer>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Jev API call (via our Next.js route handler) ────────────────────────────

export async function callJev(
  state: unknown,
  questions: Record<string, unknown>
): Promise<{ response: JevResponse; latencyMs: number }> {
  const start = Date.now();
  const res = await fetch("/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, questions }),
  });
  const latencyMs = Date.now() - start;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jev API error ${res.status}: ${err}`);
  }
  const response: JevResponse = await res.json();
  return { response, latencyMs };
}

// ─── Stage 1: Per-Chunk Parallel Jev Evaluation (from jev.md) ────────────────

const CONTAINS_KNOWLEDGE_QUESTION = {
  type: "noul",
  instructions: {
    question: "Does `new_chunk` state or clearly implement something a teammate would need to know later?",
    focus:
      "Look for decisions and their reasons, architectural rules, API or data contracts, configuration and conventions, responsibilities and ownership, preferences, or concrete facts about a specific person, team, or system. For code, judge the design-level knowledge the code encodes, not each line.",
  },
  criteria: {
    true: {
      what: "A specific, checkable claim about how something works, who owns it, what was decided, or what must hold",
      examples: [
        "Access tokens expire after 15 minutes",
        "Alice owns the JWT migration",
      ],
    },
    false: {
      what: "Generalities, world knowledge that reads the same for anyone, or mechanics with no design significance",
      examples: [
        "Authentication is important for security",
        "for (let i = 0; i < n; i++) total += items[i]",
      ],
    },
  },
} as const;

export async function evaluateChunkWithJev(
  chunk: Chunk,
  candidateMemories: Memory[],
  options: { gateMemories?: boolean } = { gateMemories: true }
): Promise<{
  result: JevTriageResult;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const shouldGateMemories = options.gateMemories !== false && candidateMemories.length > 0;

  // 1. Build state: omit existing_memories completely if candidateMemories is empty or not gating memories
  const state: Record<string, unknown> = {
    new_chunk: chunk.text,
  };
  if (shouldGateMemories) {
    state.existing_memories = candidateMemories.map((m) => m.content);
  }

  // 2. Build questions: contains_memorable_knowledge is always asked
  const questions: Record<string, unknown> = {
    contains_memorable_knowledge: CONTAINS_KNOWLEDGE_QUESTION,
  };

  // Only ask relation questions if candidate memories exist and memory gating is enabled
  if (shouldGateMemories) {
    candidateMemories.forEach((_, i) => {
      questions[`memory_${i}_relation`] = {
        type: "choice",
        instructions: {
          question: `How does \`new_chunk\` relate to \`existing_memories[${i}]\`?`,
          compare: ["new_chunk", `existing_memories[${i}]`],
          focus:
            "Sharing a topic is not enough to count as related. The chunk must speak to the same claim, or directly update, supersede, revise, or contradict the facts in the existing memory (including policy, limit, or version updates).",
        },
        criteria: {
          unrelated: [
            "Different subject, entity, or topic entirely.",
            "Makes a claim that has no connection to the existing memory.",
          ],
          related: [
            "Restates or confirms the exact same claim.",
            "Expands the memory by adding new, highly relevant details.",
            "Contradicts, corrects, updates, or supersedes the existing memory (including policy, rate limit, timeline, or scope revisions).",
          ],
        },
      };
    });
  }

  const { response, latencyMs } = await callJev(state, questions);

  const knowledgeAns = response.answers.contains_memorable_knowledge as NoulAnswer | undefined;
  const knowledgeProbability = Math.round((knowledgeAns?.noul ?? 0) * 100) / 100;

  // Gating rule from jev.md:
  // If contains_memorable_knowledge.noul < 0.4 -> Don't forward chunk to LLM
  const passedGate = knowledgeProbability >= 0.4;

  const memoryRelations: Record<
    string,
    { choice: "related" | "unrelated"; confidence: number; probabilities?: Record<string, number> }
  > = {};
  const forwardedMemoryIds: string[] = [];

  if (shouldGateMemories) {
    candidateMemories.forEach((mem, i) => {
      const relationAns = response.answers[`memory_${i}_relation`] as ChoiceAnswer | undefined;
      const choice = (relationAns?.choice === "related" ? "related" : "unrelated") as "related" | "unrelated";
      const confidence = relationAns?.confidence ?? 0.85;

      memoryRelations[mem.id] = {
        choice,
        confidence,
        probabilities: relationAns?.probabilities,
      };

      if (choice === "related") {
        forwardedMemoryIds.push(mem.id);
      }
    });
  } else if (!options.gateMemories && candidateMemories.length > 0) {
    // When memory gating is disabled, forward all candidate memories
    forwardedMemoryIds.push(...candidateMemories.map((m) => m.id));
  }

  let reason = "";
  if (!passedGate) {
    reason = `Filtered out: low durability knowledge (${Math.round(knowledgeProbability * 100)}% < 40%)`;
  } else if (forwardedMemoryIds.length > 0) {
    reason = `Memorable knowledge (${Math.round(knowledgeProbability * 100)}%) · ${forwardedMemoryIds.length} related existing memories identified`;
  } else if (candidateMemories.length > 0) {
    reason = `Memorable knowledge (${Math.round(knowledgeProbability * 100)}%) · ${candidateMemories.length} candidate memories judged unrelated`;
  } else {
    reason = `Memorable knowledge (${Math.round(knowledgeProbability * 100)}%) · Cold start (no existing memories)`;
  }

  const result: JevTriageResult = {
    chunkId: chunk.id,
    knowledgeProbability,
    passedGate,
    reason,
    candidateMemoryIds: candidateMemories.map((m) => m.id),
    forwardedMemoryIds,
    memoryRelations: Object.keys(memoryRelations).length > 0 ? memoryRelations : undefined,
    // Backward compatibility helpers
    worthinessScore: Math.round(knowledgeProbability * 3 * 10) / 10,
    deltaProbability: knowledgeProbability,
    hasContradiction: false,
    contradictionProbability: 0,
  };

  return {
    result,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs,
  };
}

/**
 * Runs parallel evaluation across all chunks simultaneously using Promise.all.
 */
export async function runParallelJevTriage(
  chunks: Chunk[],
  relatedMemoriesMap: Record<number, Memory[]>,
  options: { gateMemories?: boolean } = { gateMemories: true }
): Promise<{
  results: JevTriageResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  parallelLatencyMs: number;
}> {
  const start = Date.now();
  const evaluations = await Promise.all(
    chunks.map((chunk) =>
      evaluateChunkWithJev(chunk, relatedMemoriesMap[chunk.id] || [], options)
    )
  );
  const parallelLatencyMs = Date.now() - start;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const results: JevTriageResult[] = [];

  for (const evalItem of evaluations) {
    results.push(evalItem.result);
    totalInputTokens += evalItem.inputTokens;
    totalOutputTokens += evalItem.outputTokens;
  }

  return {
    results,
    totalInputTokens,
    totalOutputTokens,
    parallelLatencyMs,
  };
}

// ─── Stage 3: Jev Mutation Judge ─────────────────────────────────────────────

const MUTATION_CRITERIA = {
  APPEND:
    "The new memory is genuinely novel and does not update or contradict the existing memory. Both should coexist independently.",
  SUPERSEDE:
    "The new memory directly updates, corrects, changes limits/policies, or replaces the existing memory with more current information. The existing memory is now outdated or obsolete.",
  LINK:
    "Both memories are valid and non-conflicting but cover related aspects of the same topic or entity. They should be linked in the knowledge graph.",
} as const;

export async function runJevMutationJudge(
  newMemories: Array<{ id: string; content: string }>,
  existingMemoriesPerNew: Record<string, Memory[]>
): Promise<{
  results: JevMutationResult[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const pairTasks: Array<{
    newMemId: string;
    existingMemId: string;
    state: unknown;
    questions: Record<string, unknown>;
  }> = [];

  for (const nm of newMemories) {
    const existingMems = existingMemoriesPerNew[nm.id] || [];
    for (const em of existingMems) {
      pairTasks.push({
        newMemId: nm.id,
        existingMemId: em.id,
        state: {
          new_memory: nm.content,
          existing_memory: em.content,
        },
        questions: {
          mutation_action: {
            type: "choice",
            instructions:
              "Given new_memory and existing_memory, what action should be taken regarding existing_memory? (Choose SUPERSEDE if new_memory updates or revises existing limits, policies, rules, dates, or preferences).",
            criteria: MUTATION_CRITERIA,
          },
        },
      });
    }
  }

  if (pairTasks.length === 0) {
    return { results: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }

  const start = Date.now();
  const pairResults = await Promise.all(
    pairTasks.map(async (task) => {
      const { response } = await callJev(task.state, task.questions);
      const choiceAns = response.answers.mutation_action as ChoiceAnswer;
      return {
        newMemoryId: task.newMemId,
        existingMemoryId: task.existingMemId,
        action: (choiceAns?.choice ?? "APPEND") as MutationAction,
        confidence: choiceAns?.confidence ?? 0.9,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      };
    })
  );
  const latencyMs = Date.now() - start;

  let inputTokens = 0;
  let outputTokens = 0;
  const results: JevMutationResult[] = [];

  for (const pr of pairResults) {
    results.push({
      newMemoryId: pr.newMemoryId,
      existingMemoryId: pr.existingMemoryId,
      action: pr.action,
      confidence: pr.confidence,
    });
    inputTokens += pr.inputTokens;
    outputTokens += pr.outputTokens;
  }

  return {
    results,
    inputTokens,
    outputTokens,
    latencyMs,
  };
}
