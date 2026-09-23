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
  const start = performance.now();
  const res = await fetch("/api/jev", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, questions }),
  });
  const latencyMs = performance.now() - start;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jev API error ${res.status}: ${err}`);
  }
  const response: JevResponse = await res.json();
  return { response, latencyMs };
}

// ─── Stage 1: Batch Chunk Classifier ─────────────────────────────────────────

export async function runBatchJevClassifier(chunks: Chunk[]): Promise<{
  results: JevTriageResult[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  if (chunks.length === 0) {
    return { results: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }

  const state: Record<string, unknown> = {
    chunks: chunks.map(c => c.text),
    rubrics: {
      question: "Does this chunk contains a standalone fact, decision, preference, or state change worth remembering as a long-term memory or if it contains information a neighboring chunk needs to be correctly interpreted",
      focus: "Defines a term, names an entity, resolves a pronoun or reference used nearby.",
      true: "The chunk contains useful information to remember or contains relevant inforamtion that the neighbouring chunks will need",
      false: "The chunk is boilerplate, navigation/headers, empty, purely structural, or generic filler with no standalone or referential value."
    }
  };

  const questions: Record<string, unknown> = {};
  chunks.forEach((chunk, i) => {
    questions[`chunk_${i}`] = {
      type: "noul",
      instructions: {
        question: "`rubrics.question`",
        focus: "`rubrics.focus`",
        chunk: `\`chunks[${i}]\``
      },
      criteria: {
        true: "`rubrics.true`",
        false: "`rubrics.false`"
      }
    };
  });

  const { response, latencyMs } = await callJev(state, questions);

  const results: JevTriageResult[] = chunks.map((chunk, i) => {
    const ans = response.answers[`chunk_${i}`] as NoulAnswer | undefined;
    const probability = Math.round((ans?.noul ?? 0) * 100) / 100;
    const passedGate = probability >= 0.4;
    return {
      chunkId: chunk.id,
      knowledgeProbability: probability,
      passedGate,
      reason: passedGate ? "Memorable knowledge" : "Filtered out: boilerplate"
    };
  });

  return {
    results,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs
  };
}

// ─── Stage 3: Jev Mutation Judge ─────────────────────────────────────────────

const MUTATION_RUBRIC = {
  instructions: {
    focus: "Judge only the relationship between these two specific statements. Do not use outside knowledge assumptions about what one fact usually implies about another — decide based only on what is explicitly stated in both."
  },
  Unrelated: {
    what: "The new claim and the existing memory concern different subjects, entities, or facts, with no meaningful semantic relationship.",
    not_for: "Cases where the claims share a subject or entity and the new claim adds, changes, or describes the state of something already represented by the existing memory. Those cases belong to Append, Extend, or Supersede."
  },
  Append: {
    what: "The new claim restates the same fact already represented by the existing memory — same subject, same attribute, same value, and same relevant time or state — without adding any materially new information.",
    not_for: "A claim that adds new detail, context, scope, or a related state (use Extend), or a claim that changes the value of the same attribute in the same relevant temporal context (use Supersede)."
  },
  Extend: {
    what: "The new claim adds materially new information related to the existing memory. It may add detail, context, scope, or describe a related past, present, or future state of the same subject or attribute. The existing memory remains valid and both claims can be true at the same time.",
    not_for: "A claim that merely restates the existing fact (use Append), or a claim that asserts the existing state has actually been replaced or changed in the same relevant temporal context (use Supersede)."
  },
  Supersede: {
    what: "The new claim changes or replaces the value of the same attribute or state represented by the existing memory, within the same relevant temporal context, such that the old and new states cannot both represent the current truth.",
    not_for: "A claim describing a future plan, intention, possibility, or temporary/future state that has not yet replaced the existing state. Such claims should use Extend."
  }
};

export async function runJevMutationJudge(
  newMem: { id: string; content: string },
  existingMemories: Memory[]
): Promise<{
  results: JevMutationResult[];
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  if (existingMemories.length === 0) {
    return { results: [], inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  }

  const state: Record<string, unknown> = {
    new_claim: newMem.content,
    existing_memories: existingMemories.map(m => m.content),
    rubrics: MUTATION_RUBRIC
  };

  const questions: Record<string, unknown> = {};
  existingMemories.forEach((mem, i) => {
    questions[`existing_memories[${i}]`] = {
      type: "choice",
      instructions: {
        question: `How does the \`new_claim\` relate to this \`existing_memory[${i}]\`?`,
        focus: "`rubrics.instructions.focus`"
      },
      criteria: {
        Unrelated: { what: "`rubrics.Unrelated.what`", not_for: "`rubrics.Unrelated.not_for`" },
        Append: { what: "`rubrics.Append.what`", not_for: "`rubrics.Append.not_for`" },
        Extend: { what: "`rubrics.Extend.what`", not_for: "`rubrics.Extend.not_for`" },
        Supersede: { what: "`rubrics.Supersede.what`", not_for: "`rubrics.Supersede.not_for`" }
      }
    };
  });

  const { response, latencyMs } = await callJev(state, questions);

  const results: JevMutationResult[] = existingMemories.map((mem, i) => {
    const ans = response.answers[`existing_memories[${i}]`] as ChoiceAnswer | undefined;
    const choice = (ans?.choice ?? "Unrelated");
    // Ensure the mapped choice conforms to MutationAction enum
    const action = choice.toUpperCase() as MutationAction;
    return {
      newMemoryId: newMem.id,
      existingMemoryId: mem.id,
      action: action,
      confidence: ans?.confidence ?? 0.85
    };
  });

  return {
    results,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    latencyMs
  };
}
