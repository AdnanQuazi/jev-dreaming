"use client";

import type { PipelineRunResult, EvaluationJudgeResult } from "@/types";
import { GEMINI_MODELS } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  DollarSign,
  Zap,
  Brain,
  Filter,
  TrendingDown,
  Award,
  BarChart3,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

interface Props {
  results: Partial<Record<string, PipelineRunResult>>;
  selectedModel: string;
  evaluationJudge?: EvaluationJudgeResult | null;
}

const MODE_LABELS: Record<string, string> = {
  "dreaming-pipeline": "Dreaming Pipeline",
  "gemini-pipeline": "Gemini Pipeline",
};

const MODE_COLORS: Record<string, string> = {
  "dreaming-pipeline": "text-fuchsia-300 border-fuchsia-500/30 bg-fuchsia-500/10",
  "gemini-pipeline": "text-blue-300 border-blue-500/30 bg-blue-500/10",
};

const MODE_ICON: Record<string, React.ReactNode> = {
  "dreaming-pipeline": <Zap className="w-3.5 h-3.5" />,
  "gemini-pipeline": <Brain className="w-3.5 h-3.5" />,
};

function formatMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(cost: number) {
  if (cost < 0.000001) return "<$0.000001";
  return `$${cost.toFixed(6)}`;
}

export function MetricsCard({ results, selectedModel, evaluationJudge }: Props) {
  const modes = ["dreaming-pipeline", "gemini-pipeline"] as const;
  const availableModes = modes.filter((m) => results[m]);

  const modelConfig = GEMINI_MODELS.find((m) => m.id === selectedModel);

  if (availableModes.length === 0) {
    return (
      <Card className="bg-[#0f0f0f] border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            Benchmark Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-white/25 text-sm">
            <BarChart3 className="w-8 h-8 opacity-30" />
            <p>Run a benchmark to see results</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const minLatency = Math.min(...availableModes.map((m) => results[m]!.totalLatencyMs));
  const minCost = Math.min(...availableModes.map((m) => results[m]!.totalCostUsd));

  return (
    <div className="space-y-4">
      {/* Primary Performance Metrics Card */}
      <Card className="bg-[#0f0f0f] border-white/10">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-amber-400" />
              Benchmark Performance Metrics
            </CardTitle>
            {modelConfig && (
              <span className="text-sm text-white/40">{modelConfig.name}</span>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {/* Comparison grid: 2 columns for 2 modes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableModes.map((mode) => {
              const result = results[mode]!;
              const isBestLatency = result.totalLatencyMs === minLatency;
              const isBestCost = result.totalCostUsd === minCost;

              return (
                <div
                  key={mode}
                  className={`rounded-none border p-4 space-y-3 ${MODE_COLORS[mode]}`}
                >
                  {/* Header */}
                  <div className="flex items-center gap-1.5 justify-between">
                    <div className="flex items-center gap-1.5">
                      {MODE_ICON[mode]}
                      <span className="text-base font-semibold">{MODE_LABELS[mode]}</span>
                    </div>
                    <div className="flex gap-1.5">
                      {isBestLatency && (
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/80 font-mono flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" /> fastest
                        </span>
                      )}
                      {isBestCost && (
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/80 font-mono flex items-center gap-1">
                          <DollarSign className="w-2.5 h-2.5" /> cheapest
                        </span>
                      )}
                    </div>
                  </div>

                  <Separator className="opacity-20" />

                  {/* Key metrics */}
                  <div className="space-y-2">
                    <MetricRow
                      label="Total Latency"
                      value={formatMs(result.totalLatencyMs)}
                      icon={<Clock className="w-3.5 h-3.5" />}
                      highlight={isBestLatency}
                    />
                    <MetricRow
                      label="Total Cost"
                      value={formatCost(result.totalCostUsd)}
                      icon={<DollarSign className="w-3.5 h-3.5" />}
                      highlight={isBestCost}
                    />
                    <MetricRow
                      label="Memories Generated"
                      value={String(result.memoriesGenerated)}
                      icon={<Brain className="w-3.5 h-3.5" />}
                    />
                    <MetricRow
                      label="Chunks Filtered"
                      value={`${result.chunksFiltered}/${result.chunksFiltered + result.chunksProcessed} dropped`}
                      icon={<Filter className="w-3.5 h-3.5" />}
                    />
                  </div>

                  <Separator className="opacity-20" />

                  {/* Per-stage breakdown */}
                  <div className="space-y-1.5">
                    <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">Stage Breakdown</p>
                    {result.stages.map((stage) => (
                      <div key={stage.name} className="flex items-center justify-between gap-2">
                        <span className="text-xs text-white/60 truncate flex-1">{stage.name}</span>
                        <div className="flex items-center gap-2 flex-none font-mono text-xs">
                          <span className="text-white/50">{formatMs(stage.latencyMs)}</span>
                          <span className="text-emerald-400/80">{formatCost(stage.costUsd)}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Mutation summary */}
                  {result.memoriesGenerated > 0 && (
                    <>
                      <Separator className="opacity-20" />
                      <div className="space-y-1">
                        <p className="text-xs text-white/40 uppercase tracking-wider font-semibold">Mutations & Actions</p>
                        {(() => {
                          const supersedeCount = result.mutationResults.filter((r) => r.action === "SUPERSEDE").length;
                          const linkCount = result.mutationResults.filter((r) => r.action === "EXTEND").length;
                          const appendCount = Math.max(0, result.memoriesGenerated - supersedeCount - linkCount);
                          return (
                            <>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-white/60">NEW INSERTS (APPEND)</span>
                                <span className="font-mono text-white/80">{appendCount}</span>
                              </div>
                              {supersedeCount > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-amber-400/90 font-medium">SUPERSEDE</span>
                                  <span className="font-mono text-amber-400 font-semibold">{supersedeCount}</span>
                                </div>
                              )}
                              {linkCount > 0 && (
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-fuchsia-400/90 font-medium">EXTEND / LINK</span>
                                  <span className="font-mono text-fuchsia-400">{linkCount}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}

                  {/* Token counts */}
                  <div className="flex items-center justify-between text-xs text-white/30 font-mono border-t border-white/10 pt-2">
                    <span>Input: {result.stages.reduce((s, st) => s + st.inputTokens, 0).toLocaleString()} tokens</span>
                    <span>Output: {result.stages.reduce((s, st) => s + st.outputTokens, 0).toLocaleString()} tokens</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Efficiency advantage banner */}
          {availableModes.length >= 2 && results["dreaming-pipeline"] && results["gemini-pipeline"] && (
            <div className="mt-4 p-3.5 rounded-none bg-white/3 border border-white/8 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-white/80">Dreaming Architecture Comparison</span>
              </div>
              <div className="flex items-center gap-4 text-sm font-mono text-emerald-400 font-bold">
                {(() => {
                  const jevLat = results["dreaming-pipeline"]!.totalLatencyMs;
                  const gemLat = results["gemini-pipeline"]!.totalLatencyMs;
                  const speedFactor = gemLat / jevLat;
                  const speedText = speedFactor >= 1 
                    ? `${speedFactor.toFixed(1)}x faster` 
                    : `${(1 / speedFactor).toFixed(1)}x slower`;

                  const jevCost = results["dreaming-pipeline"]!.totalCostUsd;
                  const gemCost = results["gemini-pipeline"]!.totalCostUsd;
                  const costFactor = gemCost / jevCost;
                  const costText = costFactor >= 1 
                    ? `${costFactor.toFixed(1)}x cheaper` 
                    : `${(1 / costFactor).toFixed(1)}x more expensive`;

                  return (
                    <>
                      <span>Speed - {speedText}</span>
                      <span>Cost - {costText}</span>
                    </>
                  );
                })()}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Gemini 3.8 Flash Quality Judge Scorecard */}
      {evaluationJudge && (
        <Card className="bg-[#0d0d14] border-fuchsia-500/30">
          <CardHeader className="pb-3 border-b border-fuchsia-500/15">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold text-fuchsia-300 tracking-wide uppercase flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-fuchsia-400" />
                Gemini 3.8 Flash Quality Scorecard (Judge)
              </CardTitle>
              <div className="flex items-center gap-2">
                {evaluationJudge.winner && (
                  <Badge className="bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30 text-xs font-mono">
                    <Award className="w-3 h-3 mr-1" />
                    Winner: {MODE_LABELS[evaluationJudge.winner] || evaluationJudge.winner}
                  </Badge>
                )}
                <span className="text-xs text-white/40 font-mono">
                  evaluated in {formatMs(evaluationJudge.latencyMs)}
                </span>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-4">
            {/* Score comparison grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {evaluationJudge.jevEvaluation && (
                <div className="p-3.5 border border-fuchsia-500/20 bg-fuchsia-950/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-fuchsia-300 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5" /> Dreaming Pipeline Quality
                    </span>
                    <span className="text-xl font-bold font-mono text-fuchsia-400">
                      {evaluationJudge.jevEvaluation.overallScore.toFixed(1)}/10
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <QualityScoreRow label="Chunk Classification" score={evaluationJudge.jevEvaluation.chunkClassificationScore} />
                    <QualityScoreRow label="Memory Generation" score={evaluationJudge.jevEvaluation.memoryGenerationScore} />
                    <QualityScoreRow label="Mutation Accuracy" score={evaluationJudge.jevEvaluation.mutationAccuracyScore} />
                  </div>
                  <p className="text-xs text-white/60 italic border-t border-white/8 pt-2">
                    "{evaluationJudge.jevEvaluation.critique}"
                  </p>
                </div>
              )}

              {evaluationJudge.singleShotEvaluation && (
                <div className="p-3.5 border border-blue-500/20 bg-blue-950/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-300 flex items-center gap-1.5">
                      <Brain className="w-3.5 h-3.5" /> Gemini Pipeline Quality
                    </span>
                    <span className="text-xl font-bold font-mono text-blue-400">
                      {evaluationJudge.singleShotEvaluation.overallScore.toFixed(1)}/10
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <QualityScoreRow label="Chunk Classification" score={evaluationJudge.singleShotEvaluation.chunkClassificationScore} />
                    <QualityScoreRow label="Memory Generation" score={evaluationJudge.singleShotEvaluation.memoryGenerationScore} />
                    <QualityScoreRow label="Mutation Accuracy" score={evaluationJudge.singleShotEvaluation.mutationAccuracyScore} />
                  </div>
                  <p className="text-xs text-white/60 italic border-t border-white/8 pt-2">
                    "{evaluationJudge.singleShotEvaluation.critique}"
                  </p>
                </div>
              )}
            </div>

            {/* Comparison summary */}
            {evaluationJudge.comparisonSummary && (
              <div className="p-3 bg-white/2 border border-white/8 text-xs text-white/70 space-y-1">
                <span className="text-white/40 uppercase tracking-wider font-semibold block text-[10px]">
                  Judge Analysis & Verdict
                </span>
                <p>{evaluationJudge.comparisonSummary}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QualityScoreRow({ label, score }: { label: string; score?: number }) {
  if (score === undefined) return null;
  const pct = Math.min(100, Math.max(0, (score / 10) * 100));
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-white/60">
        <span>{label}</span>
        <span className="font-mono font-semibold text-white/90">{score}/10</span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-none overflow-hidden">
        <div
          className={`h-full ${
            score >= 8 ? "bg-emerald-400" : score >= 6 ? "bg-amber-400" : "bg-red-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-xs text-white/50">
        {icon}
        {label}
      </div>
      <span
        className={`text-xs font-mono font-semibold ${
          highlight ? "text-emerald-300" : "text-white/80"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
