"use client";

import { useState } from "react";
import type { Chunk, PipelineRunResult, PipelineEvent, EvaluationJudgeResult } from "@/types";
import { GEMINI_MODELS } from "@/types";
import { runJevPipeline, runGeminiSingleShotPipeline } from "@/lib/pipeline";
import { runQualityEvaluation } from "@/lib/evaluator";
import { getActiveMemories } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Zap,
  BarChart3,
  Play,
  Loader2,
  ChevronRight,
  AlertCircle,
  Award,
  HelpCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  chunks: Chunk[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  onEvent: (event: PipelineEvent) => void;
  onResults: (results: Partial<Record<string, PipelineRunResult>>) => void;
  onEvaluation: (evalJudge: EvaluationJudgeResult | null) => void;
  onRefreshMemories: () => void;
  isRunning: boolean;
  setIsRunning: (running: boolean) => void;
  setActiveStage: (stage: string | null) => void;
}

export function BenchmarkPanel({
  chunks,
  selectedModel,
  onModelChange,
  onEvent,
  onResults,
  onEvaluation,
  onRefreshMemories,
  isRunning,
  setIsRunning,
  setActiveStage,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"jev" | "full" | null>(null);
  const [mutationStrategy, setMutationStrategy] = useState<"jev" | "gemini">("jev");
  const [gateMemories, setGateMemories] = useState<boolean>(true);

  const handleEvent = (event: PipelineEvent) => {
    onEvent(event);
    if (event.type === "stage_start") {
      setActiveStage(event.stage);
    } else if (event.type === "stage_complete") {
      setActiveStage(null);
    }
  };

  const runJevOnly = async () => {
    if (chunks.length === 0) {
      setError("Add at least one chunk.");
      return;
    }
    setError(null);
    setIsRunning(true);
    setMode("jev");
    onEvaluation(null);

    try {
      const activeMemories = await getActiveMemories();
      const pipelineOptions = { mutationStrategy, gateMemories };
      const result = await runJevPipeline(chunks, selectedModel, handleEvent, pipelineOptions);
      onResults({ "jev-pipeline": result });
      onRefreshMemories();

      // Trigger Gemini 3.8 Flash Evaluation Judge
      setActiveStage("Gemini 3.8 Flash Quality Judge");
      const evalJudge = await runQualityEvaluation(chunks, activeMemories, result, undefined);
      if (evalJudge) {
        onEvaluation(evalJudge);
        handleEvent({ type: "evaluation_result", evaluation: evalJudge });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRunning(false);
      setMode(null);
      setActiveStage(null);
    }
  };

  const runFullBenchmark = async () => {
    if (chunks.length === 0) {
      setError("Add at least one chunk.");
      return;
    }
    setError(null);
    setIsRunning(true);
    setMode("full");
    onEvaluation(null);

    const allResults: Partial<Record<string, PipelineRunResult>> = {};
    try {
      const activeMemories = await getActiveMemories();
      const pipelineOptions = { mutationStrategy, gateMemories };

      // 1. Run Jev + Gemini Pipeline
      const jevResult = await runJevPipeline(chunks, selectedModel, handleEvent, pipelineOptions);
      allResults["jev-pipeline"] = jevResult;
      onResults({ ...allResults });

      // 2. Run Gemini Single-shot Pipeline
      const singleResult = await runGeminiSingleShotPipeline(chunks, selectedModel, handleEvent);
      allResults["gemini-singleshot"] = singleResult;
      onResults({ ...allResults });

      onRefreshMemories();

      // 3. Trigger Gemini 3.8 Flash Comparative Quality Judge
      setActiveStage("Gemini 3.8 Flash Quality Judge");
      const evalJudge = await runQualityEvaluation(chunks, activeMemories, jevResult, singleResult);
      if (evalJudge) {
        onEvaluation(evalJudge);
        handleEvent({ type: "evaluation_result", evaluation: evalJudge });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setIsRunning(false);
      setMode(null);
      setActiveStage(null);
    }
  };

  return (
    <TooltipProvider delay={100}>
      <Card className="bg-[#0f0f0f] border-white/10 h-full">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-400" />
            Run Pipeline
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3.5">
          {/* Model selector */}
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/50 whitespace-nowrap">Extraction LLM</span>
              <Tooltip>
                <TooltipTrigger className="text-white/30 hover:text-white/70 inline-flex items-center">
                  <HelpCircle className="w-3 h-3" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-[11px] leading-relaxed bg-[#1a1a1a] text-white/80 border border-white/10">
                  Gemini model used in Stage 2 to extract structured memory statements from worthy chunks.
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={selectedModel}
              onValueChange={(val: string | null) => {
                if (val) onModelChange(val);
              }}
              disabled={isRunning}
            >
              <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 w-[175px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-white">
                {GEMINI_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    <div className="flex items-center gap-2">
                      <span>{m.name}</span>
                      <span className="text-white/30 text-[10px] font-mono">
                        ${m.inputCostPer1M}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Mutation Strategy Selector */}
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/50 whitespace-nowrap">Conflict & Update Resolver</span>
              <Tooltip>
                <TooltipTrigger className="text-white/30 hover:text-white/70 inline-flex items-center">
                  <HelpCircle className="w-3 h-3" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[250px] text-[11px] leading-relaxed bg-[#1a1a1a] text-white/80 border border-white/10">
                  <p className="font-semibold text-white mb-1">How memory mutations are decided:</p>
                  <p className="mb-1"><span className="text-fuchsia-400 font-medium">Jev Stage 3:</span> Pairwise comparison in Stage 3 using Jev ($0.042/1M tokens) to minimize cost.</p>
                  <p><span className="text-blue-400 font-medium">Gemini In-Extraction:</span> Gemini extracts memory AND resolves APPEND/SUPERSEDE/LINK in one single prompt (highest accuracy).</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={mutationStrategy}
              onValueChange={(val: string | null) => {
                if (val) setMutationStrategy(val as "jev" | "gemini");
              }}
              disabled={isRunning}
            >
              <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 w-[175px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-white">
                <SelectItem value="jev" className="text-xs">
                  Jev Stage 3 (Cheapest)
                </SelectItem>
                <SelectItem value="gemini" className="text-xs">
                  Gemini In-Extraction (High Acc)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Memory Gating Selector */}
          <div className="flex items-center gap-2 justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-white/50 whitespace-nowrap">Past Memory Filter</span>
              <Tooltip>
                <TooltipTrigger className="text-white/30 hover:text-white/70 inline-flex items-center">
                  <HelpCircle className="w-3 h-3" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[250px] text-[11px] leading-relaxed bg-[#1a1a1a] text-white/80 border border-white/10">
                  <p className="font-semibold text-white mb-1">How past memories are passed to Gemini:</p>
                  <p className="mb-1"><span className="text-fuchsia-400 font-medium">Jev Gated (Related Only):</span> Jev filters retrieved memories; only related/conflicting ones enter Gemini's prompt (saves LLM tokens).</p>
                  <p><span className="text-amber-400 font-medium">Pass All Candidates:</span> Bypasses memory gating; Gemini sees all top-5 candidates for maximum context comprehension.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select
              value={gateMemories ? "gated" : "all"}
              onValueChange={(val: string | null) => {
                if (val) setGateMemories(val === "gated");
              }}
              disabled={isRunning}
            >
              <SelectTrigger className="h-8 text-xs bg-white/5 border-white/10 text-white/80 w-[175px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#1a1a1a] border-white/10 text-white">
                <SelectItem value="gated" className="text-xs">
                  Jev Gated (Related Only)
                </SelectItem>
                <SelectItem value="all" className="text-xs">
                  Pass All Candidates
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator className="opacity-10" />

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5">
            <Button
              className="h-9 text-xs bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium w-full p-2 cursor-pointer"
              onClick={runJevOnly}
              disabled={isRunning}
            >
              {isRunning && mode === "jev" ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-2" />
              )}
              Run Jev Pipeline
            </Button>

            <Button
              className="h-9 text-xs bg-white hover:bg-white/80 text-black font-semibold w-full p-2 cursor-pointer"
              onClick={runFullBenchmark}
              disabled={isRunning}
            >
              {isRunning && mode === "full" ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <Zap className="w-3.5 h-3.5 mr-2" />
              )}
              Full Benchmark (Jev vs Single-shot)
            </Button>
          </div>

          {/* Pipeline descriptions */}
          <div className="space-y-1.5 text-[11px] text-white/30 pt-1">
            <div className="flex items-start gap-1.5">
              <ChevronRight className="w-3 h-3 mt-0.5 text-fuchsia-400 shrink-0" />
              <span>
                <span className="text-white/60 font-medium">Pipeline Mode:</span> {gateMemories ? "Jev Gated" : "All Candidates"} $\rightarrow$ {mutationStrategy === "jev" ? "Jev Stage 3 Mutation" : "Gemini In-Extraction Mutation"}
              </span>
            </div>
            <div className="flex items-start gap-1.5">
              <ChevronRight className="w-3 h-3 mt-0.5 text-amber-400 shrink-0" />
              <span>
                <span className="text-white/60 font-medium">Quality Judge:</span> Gemini 3.8 Flash rigorously evaluates fact completeness, noise rejection & mutation accuracy
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded-none bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-none mt-0.5" />
              <span className="break-all">{error}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
