"use client";

import { useState } from "react";
import type { Chunk, PipelineRunResult, PipelineEvent, EvaluationJudgeResult } from "@/types";
import { GEMINI_MODELS } from "@/types";
import { runDreamingPipeline, runGeminiComparisonPipeline } from "@/lib/pipeline";
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
  const [mode, setMode] = useState<"dreaming" | "full" | null>(null);

  const handleEvent = (event: PipelineEvent) => {
    onEvent(event);
    if (event.type === "stage_start") {
      setActiveStage(event.stage);
    } else if (event.type === "stage_complete") {
      setActiveStage(null);
    }
  };

  const runDreamingOnly = async () => {
    if (chunks.length === 0) {
      setError("Add at least one chunk.");
      return;
    }
    setError(null);
    setIsRunning(true);
    setMode("dreaming");
    onEvaluation(null);

    try {
      const activeMemories = await getActiveMemories();
      const result = await runDreamingPipeline(chunks, selectedModel, handleEvent, true);
      onResults({ "with-jev": result });
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

      // 1. Run Pipeline (With Jev)
      const dreamingResult = await runDreamingPipeline(chunks, selectedModel, handleEvent, false);
      allResults["with-jev"] = dreamingResult;
      onResults({ ...allResults });

      // 2. Run Pipeline (Without Jev)
      const geminiResult = await runGeminiComparisonPipeline(chunks, selectedModel, handleEvent, false);
      allResults["without-jev"] = geminiResult;
      onResults({ ...allResults });

      onRefreshMemories();

      // 3. Trigger Gemini 3.8 Flash Comparative Quality Judge
      setActiveStage("Gemini 3.8 Flash Quality Judge");
      const evalJudge = await runQualityEvaluation(chunks, activeMemories, dreamingResult, geminiResult);
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

          <Separator className="opacity-10" />

          {/* Action buttons */}
          <div className="flex flex-col gap-2.5">
            <Button
              className="h-9 text-xs bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium w-full p-2 cursor-pointer"
              onClick={runDreamingOnly}
              disabled={isRunning}
            >
              {isRunning && mode === "dreaming" ? (
                <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 mr-2" />
              )}
              Dream with Jev
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
              Full Benchmark (Jev vs Gemini)
            </Button>
          </div>

          {/* Pipeline descriptions */}
          <div className="space-y-1.5 text-[11px] text-white/30 pt-1">
            <div className="flex items-start gap-1.5">
              <ChevronRight className="w-3 h-3 mt-0.5 text-fuchsia-400 shrink-0" />
              <span>
                <span className="text-white/60 font-medium">Pipeline Mode:</span> With Jev uses Jev for Stage 1 (Triage) and Stage 3 (Mutation). Without Jev uses Gemini exclusively.
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
