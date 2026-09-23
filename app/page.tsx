"use client";

import { useState, useCallback } from "react";
import { PRESET_CHUNKS } from "@/lib/chunks";
import type { Chunk, PipelineEvent, PipelineRunResult, EvaluationJudgeResult } from "@/types";
import { GEMINI_MODELS } from "@/types";
import { ChunkInput } from "@/components/ChunkInput";
import { PipelineViz } from "@/components/PipelineViz";
import { MemoryViz } from "@/components/MemoryViz";
import { MetricsCard } from "@/components/MetricsCard";
import { BenchmarkPanel } from "@/components/BenchmarkPanel";
import { Brain, Cpu, Sparkles } from "lucide-react";

export default function Home() {
  const [chunks, setChunks] = useState<Chunk[]>(PRESET_CHUNKS.map((c) => ({ ...c })));
  const [selectedModel, setSelectedModel] = useState("gemini-3.8-flash");
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [results, setResults] = useState<Partial<Record<string, PipelineRunResult>>>({});
  const [evaluationJudge, setEvaluationJudge] = useState<EvaluationJudgeResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [activeStage, setActiveStage] = useState<string | null>(null);
  const [memoryRefresh, setMemoryRefresh] = useState(0);

  const handleEvent = useCallback((event: PipelineEvent) => {
    if (event.type === "stage_start") {
      // Clear events when a new pipeline run starts (only on first stage)
      setEvents((prev) => {
        const hasComplete = prev.some((e) => e.type === "complete");
        return hasComplete ? [event] : [...prev, event];
      });
    } else {
      setEvents((prev) => [...prev, event]);
    }
  }, []);

  const handleResults = useCallback((r: Partial<Record<string, PipelineRunResult>>) => {
    setResults(r);
  }, []);

  const handleRefreshMemories = useCallback(() => {
    setMemoryRefresh((n) => n + 1);
  }, []);

  // Build triage results map for ChunkInput display
  const triageMap: Record<
    number,
    {
      knowledgeProbability?: number;
      forwardedCount?: number;
      totalCandidates?: number;
      worthinessScore?: number;
      deltaProbability?: number;
      hasContradiction?: boolean;
      contradictionProbability?: number;
      passedGate: boolean;
    }
  > = {};
  for (const event of events) {
    if (event.type === "chunk_result") {
      triageMap[event.chunkId] = {
        knowledgeProbability: event.knowledgeProbability,
        forwardedCount: event.forwardedCount,
        totalCandidates: event.totalCandidates,
        worthinessScore: event.worthinessScore,
        deltaProbability: event.deltaProbability,
        hasContradiction: event.hasContradiction,
        contradictionProbability: event.contradictionProbability,
        passedGate: event.passedGate,
      };
    }
  }

  const passedCount = Object.values(triageMap).filter((r) => r.passedGate).length;
  const droppedCount = Object.values(triageMap).filter((r) => !r.passedGate).length;

  return (
    <div className="min-h-screen bg-[#080808] text-white">
      {/* Header */}
      <header className="border-b border-white/8 bg-[#0a0a0a]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 sm:py-0 h-auto sm:h-14 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-none bg-fuchsia-500/20 border border-fuchsia-500/30 flex items-center justify-center">
              <Brain className="w-4 h-4 text-fuchsia-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-white">
                Jev Dreaming Benchmark
              </h1>
              <p className="text-xs text-white/35 leading-none mt-0.5">
                Intelligent Memory Formation · Knowledge Graph Construction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4 text-xs text-white/30 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-none bg-fuchsia-400"></span>
              TypeSafe SDK (jev-latest)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-none bg-blue-400"></span>
              {GEMINI_MODELS.find((m) => m.id === selectedModel)?.name ?? selectedModel}
            </span>
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              Judge: gemini-3.8-flash
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3" />
              IndexedDB
            </span>
          </div>
        </div>
      </header>

      {/* Main layout */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        {/* Hero Section */}
        <div className="flex flex-col gap-4 pb-6 border-b border-white/10">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-mono text-fuchsia-400/80 tracking-widest uppercase">
              Dreaming Architecture
            </p>
            <h2 className="text-3xl sm:text-7xl font-bold tracking-tight text-white line-height-[-5px]">
              Intelligent Memory Formation & Knowledge Graph Construction
            </h2>
          </div>
          <p className="text-white/55 max-w-full text-xs sm:text-sm">
            <span className="text-white/80 font-medium">Dreaming</span> is a three-stage pipeline that mimics how biological memory works — filter, encode, consolidate.
            Incoming text chunks are first triaged by Jev, a probabilistic classifier that assigns a knowledge score to each chunk and <span className="text-white/80">drops irrelevant noise</span>.
            Only fact-dense chunks advance to Gemini for memory extraction. Extracted memories are then judged by Jev again — each one is decided to
            {" "}<span className="text-emerald-400/90 font-medium">Append</span> (new fact),
            {" "}<span className="text-blue-400/90 font-medium">Extend</span> (link into the knowledge graph), or
            {" "}<span className="text-amber-400/90 font-medium">Supersede</span> (replace a stale belief).
            This benchmark measures how that hybrid Jev + Gemini pipeline compares to raw Gemini on speed, token cost, and memory quality.
          </p>
          <div className="flex flex-wrap gap-4 text-xs text-white/35">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-none inline-block" />
              Stage 1 · Jev Triage Gate — filters low-signal chunks
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-blue-400 rounded-none inline-block" />
              Stage 2 · Gemini Extraction — generates structured memories
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-none inline-block" />
              Stage 3 · Jev Mutation Judge — evolves the knowledge graph
            </span>
          </div>
        </div>

        {/* Top row: Chunks + Pipeline Viz + Controls */}
        <div className="flex flex-col lg:grid lg:grid-cols-[360px_1fr_300px] xl:grid-cols-[480px_1fr_320px] gap-4 lg:h-[580px]">
          {/* Left: Chunk input */}
          <ChunkInput
            chunks={chunks}
            onChange={setChunks}
            triageResults={triageMap}
          />

          {/* Center: Pipeline visualizer */}
          <PipelineViz
            events={events}
            isRunning={isRunning}
            activeStage={activeStage}
          />

          {/* Right: Controls */}
          <div className="flex flex-col gap-3">
            <BenchmarkPanel
              chunks={chunks}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              onEvent={handleEvent}
              onResults={handleResults}
              onEvaluation={setEvaluationJudge}
              onRefreshMemories={handleRefreshMemories}
              isRunning={isRunning}
              setIsRunning={setIsRunning}
              setActiveStage={setActiveStage}
            />

            {/* Quick stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Total Chunks", value: chunks.length, color: "text-white/70" },
                {
                  label: "Passed Gate",
                  value: passedCount,
                  color: "text-emerald-400",
                },
                {
                  label: "Dropped (0 Tokens)",
                  value: droppedCount,
                  color: "text-red-400",
                },
                {
                  label: "Memories Active",
                  value: results["with-jev"]?.memoriesGenerated ?? "—",
                  color: "text-fuchsia-400",
                },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="rounded-none border border-white/8 bg-white/2 p-2.5 text-center"
                >
                  <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
                  <div className="text-xs text-white/40 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Metrics comparison & Quality Scorecard */}
        {(Object.keys(results).length > 0 || evaluationJudge) && (
          <MetricsCard
            results={results}
            selectedModel={selectedModel}
            evaluationJudge={evaluationJudge}
          />
        )}

        {/* Memory store */}
        <MemoryViz refreshTrigger={memoryRefresh} results={results} />
      </main>
    </div>
  );
}
