"use client";

import { useMemo } from "react";
import type { PipelineEvent, StageMetrics, MutationAction } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Brain,
  Filter,
  Zap,
  GitMerge,
  CheckCircle2,
  Circle,
  Loader2,
  ChevronRight,
  XCircle,
  Sparkles,
} from "lucide-react";

interface Props {
  events: PipelineEvent[];
  isRunning: boolean;
  activeStage: string | null;
}

type StageStatus = "pending" | "running" | "done" | "skipped";

interface StageState {
  name: string;
  icon: React.ReactNode;
  status: StageStatus;
  metrics?: StageMetrics;
  details: string[];
}

export function PipelineViz({ events, isRunning, activeStage }: Props) {
  const stageStates = useMemo<StageState[]>(() => {
    const isSingleShot = events.some(
      (e) => e.type === "stage_start" && e.stage.includes("Single-shot")
    );

    let stages: StageState[];

    if (isSingleShot) {
      stages = [
        {
          name: "Gemini Single-shot (All-in-One)",
          icon: <Brain className="w-4 h-4" />,
          status: "pending",
          details: [],
        },
        {
          name: "Gemini 3.8 Flash Quality Judge",
          icon: <Sparkles className="w-4 h-4 text-fuchsia-400" />,
          status: "pending",
          details: [],
        },
      ];
    } else {
      stages = [
        {
          name: "Jev Parallel Triage (Score & Delta)",
          icon: <Filter className="w-4 h-4" />,
          status: "pending",
          details: [],
        },
        {
          name: "Gemini Parallel Extraction",
          icon: <Brain className="w-4 h-4" />,
          status: "pending",
          details: [],
        },
        {
          name: "Jev Mutation Judge",
          icon: <GitMerge className="w-4 h-4" />,
          status: "pending",
          details: [],
        },
        {
          name: "Gemini 3.8 Flash Quality Judge",
          icon: <Sparkles className="w-4 h-4 text-fuchsia-400" />,
          status: "pending",
          details: [],
        },
      ];
    }

    for (const event of events) {
      if (event.type === "stage_start") {
        let s = stages.find((st) => st.name === event.stage);
        if (!s && event.stage.includes("Gemini In-Extraction")) {
          s = stages.find((st) => st.name === "Jev Mutation Judge");
          if (s) s.name = "Gemini In-Extraction Mutation";
        }
        if (s) s.status = "running";
      } else if (event.type === "stage_complete") {
        let s = stages.find((st) => st.name === event.stage);
        if (!s && event.stage.includes("Gemini In-Extraction")) {
          s = stages.find((st) => st.name === "Jev Mutation Judge" || st.name.includes("Gemini In-Extraction"));
          if (s) {
            s.name = "Gemini In-Extraction Mutation";
            s.details.push("Resolved directly during Stage 2 Gemini extraction");
          }
        }
        if (s) {
          s.status = "done";
          s.metrics = event.metrics;
        }
      } else if (event.type === "chunk_result") {
        const s = stages.find((st) => st.name.includes("Jev Parallel Triage"));
        if (s) {
          const statusIcon = event.passedGate ? "✓ Pass" : "✗ Drop";
          const label = event.knowledgeProbability !== undefined
            ? `${statusIcon} [Chunk ${event.chunkId + 1}]: Knowledge ${Math.round(event.knowledgeProbability * 100)}% · ${event.forwardedCount ?? 0}/${event.totalCandidates ?? 0} rel mems`
            : `${statusIcon} [Chunk ${event.chunkId + 1}]: Score ${event.worthinessScore}/3 · Δ ${Math.round((event.deltaProbability ?? 0) * 100)}%`;
          s.details.push(label);
        }
      } else if (event.type === "extraction_result") {
        const s = stages.find((st) => st.name === "Gemini Parallel Extraction" || st.status === "running");
        if (s) {
          s.details.push(`Chunk ${event.chunkId + 1} → ${event.memory.slice(0, 55)}...`);
        }
      } else if (event.type === "mutation_result") {
        const s = stages.find((st) => st.name === "Jev Mutation Judge" || st.status === "running");
        if (s) {
          const label = `${event.action}: ${event.newContent.slice(0, 50)}...`;
          s.details.push(label);
        }
      } else if (event.type === "evaluation_result") {
        const s = stages.find((st) => st.name === "Gemini 3.8 Flash Quality Judge");
        if (s) {
          s.status = "done";
          if (event.evaluation.jevEvaluation) {
            s.details.push(`Jev Score: ${event.evaluation.jevEvaluation.overallScore}/10 (${event.evaluation.jevEvaluation.critique.slice(0, 50)}...)`);
          }
          if (event.evaluation.singleShotEvaluation) {
            s.details.push(`Single-shot Score: ${event.evaluation.singleShotEvaluation.overallScore}/10`);
          }
        }
      }
    }

    if (activeStage) {
      for (const s of stages) {
        if (s.status === "pending" && s.name === activeStage) {
          s.status = "running";
        }
      }
    }

    return stages;
  }, [events, activeStage]);

  const passedCount = events.filter(
    (e) => e.type === "chunk_result" && e.passedGate
  ).length;
  const filteredCount = events.filter(
    (e) => e.type === "chunk_result" && !e.passedGate
  ).length;

  const appendCount = events.filter(
    (e) => e.type === "mutation_result" && e.action === "APPEND"
  ).length;
  const supersedeCount = events.filter(
    (e) => e.type === "mutation_result" && e.action === "SUPERSEDE"
  ).length;
  const linkCount = events.filter(
    (e) => e.type === "mutation_result" && e.action === "LINK"
  ).length;

  return (
    <Card className="bg-[#0f0f0f] border-white/10 h-full flex flex-col">
      <CardHeader className="pb-3 flex-none">
        <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
          <Zap className="w-4 h-4 text-fuchsia-400" />
          Pipeline Visualizer
          {isRunning && (
            <span className="ml-auto flex items-center gap-1 text-xs font-normal text-amber-400 normal-case">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running…
            </span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex-1 flex flex-col gap-3 overflow-auto">
        {/* Summary pills */}
        {(passedCount > 0 || filteredCount > 0) && (
          <div className="flex gap-2 flex-wrap">
            {passedCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                <CheckCircle2 className="w-3 h-3" /> {passedCount} passed gate
              </span>
            )}
            {filteredCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <XCircle className="w-3 h-3" /> {filteredCount} dropped (0 LLM tokens)
              </span>
            )}
            {appendCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs">
                + {appendCount} append
              </span>
            )}
            {supersedeCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                ⇒ {supersedeCount} supersede
              </span>
            )}
            {linkCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs">
                ⟷ {linkCount} link
              </span>
            )}
          </div>
        )}

        {/* Stages list */}
        <div className="space-y-2">
          {stageStates.map((stage, idx) => (
            <div key={stage.name}>
              <div
                className={`rounded-none border transition-all duration-300 ${
                  stage.status === "running"
                    ? "border-amber-500/40 bg-amber-950/10"
                    : stage.status === "done"
                    ? "border-emerald-500/25 bg-emerald-950/10"
                    : "border-white/8 bg-white/2"
                }`}
              >
                {/* Stage header */}
                <div className="flex items-center gap-2 px-3 py-2">
                  <div
                    className={`flex-none ${
                      stage.status === "done"
                        ? "text-emerald-400"
                        : stage.status === "running"
                        ? "text-amber-400"
                        : "text-white/25"
                    }`}
                  >
                    {stage.status === "running" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : stage.status === "done" ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <Circle className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span
                    className={`text-xs font-medium ${
                      stage.status === "done"
                        ? "text-white/90"
                        : stage.status === "running"
                        ? "text-amber-200"
                        : "text-white/40"
                    }`}
                  >
                    {stage.name}
                  </span>
                  {stage.metrics && (
                    <div className="ml-auto flex items-center gap-2 text-xs font-mono text-white/40">
                      <span>{stage.metrics.latencyMs}ms</span>
                      <span className="text-emerald-400">${stage.metrics.costUsd.toFixed(6)}</span>
                    </div>
                  )}
                </div>

                {/* Stage details */}
                {stage.details.length > 0 && (
                  <div className="px-8 pb-2 space-y-0.5">
                    {stage.details.slice(0, 8).map((detail, i) => (
                      <div key={i} className="text-xs text-white/50 truncate font-mono">
                        <ChevronRight className="w-2.5 h-2.5 inline mr-1 text-white/20" />
                        {detail}
                      </div>
                    ))}
                    {stage.details.length > 8 && (
                      <div className="text-xs text-white/30 pl-3">
                        +{stage.details.length - 8} more
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Connector line */}
              {idx < stageStates.length - 1 && (
                <div className="flex justify-center my-0.5">
                  <div className="w-px h-2.5 bg-white/10" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Empty state */}
        {events.length === 0 && !isRunning && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/20 text-xs py-8 gap-2">
            <Zap className="w-8 h-8 opacity-30" />
            <p>Select model and run pipeline to see live evaluation</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
