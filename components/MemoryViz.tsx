"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Memory, MemoryLink, PipelineRunResult } from "@/types";
import { getAllMemories, getAllLinks, seedIfEmpty, clearAllData } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { RefreshCw, Trash2, Brain, Zap } from "lucide-react";
import { MemoryGraph } from "./MemoryGraph";

interface Props {
  refreshTrigger?: number;
  results?: Partial<Record<string, PipelineRunResult>>;
}

export function MemoryViz({ refreshTrigger, results = {} }: Props) {
  const [baseMemories, setBaseMemories] = useState<Memory[]>([]);
  const [baseLinks, setBaseLinks] = useState<MemoryLink[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);

    // Safety timeout — never stay stuck in loading longer than 6s
    const timeout = setTimeout(() => setLoading(false), 6000);

    try {
      await seedIfEmpty();
      const [mems, lks] = await Promise.all([getAllMemories(), getAllLinks()]);
      setBaseMemories(mems);
      setBaseLinks(lks);
    } catch (err) {
      console.error("MemoryViz refresh error:", err);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  const handleClear = async () => {
    await clearAllData();
    setBaseMemories([]);
    setBaseLinks([]);
    setTimeout(refresh, 100);
  };

  // Helper to merge base state with pipeline results
  const computeMergedState = (result: PipelineRunResult) => {
    const memoryMap = new Map<string, Memory>();

    // Add base memories first, updating status if superseded
    baseMemories.forEach(m => {
      const isSuperseded = result.mutationResults.find(mut => mut.action === "SUPERSEDE" && mut.existingMemoryId === m.id);
      if (isSuperseded) {
        memoryMap.set(m.id, { ...m, status: "superseded" as const, supersededBy: isSuperseded.newMemoryId });
      } else {
        memoryMap.set(m.id, m);
      }
    });

    // Add extracted memories (will prevent duplicates if they were already written to IndexedDB)
    result.extractedMemories.forEach(m => {
      memoryMap.set(m.id, m);
    });

    const linkMap = new Map<string, MemoryLink>();
    baseLinks.forEach(l => linkMap.set(l.id, l));
    result.generatedLinks.forEach(l => linkMap.set(l.id, l));

    return { memories: Array.from(memoryMap.values()), links: Array.from(linkMap.values()) };
  };

  const hasResults = Object.keys(results).length > 0;
  const isFullBenchmark = results["with-jev"] && results["without-jev"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2 px-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-white/40 hover:text-white/80 text-xs"
          onClick={refresh}
        >
          <RefreshCw className="w-3 h-3 mr-2" />
          Refresh Baseline
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-white/40 hover:text-red-400 text-xs"
          onClick={handleClear}
        >
          <Trash2 className="w-3 h-3 mr-2" />
          Clear Database
        </Button>
      </div>

      {loading ? (
        <div className="h-[400px] border border-white/10 bg-[#0f0f0f] flex items-center justify-center text-white/30 text-sm">
          Loading graph...
        </div>
      ) : isFullBenchmark ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MemoryGraph 
            {...computeMergedState(results["with-jev"]!)} 
            title="With Jev Output"
            icon={<Zap className="w-4 h-4 text-fuchsia-400" />}
          />
          <MemoryGraph 
            {...computeMergedState(results["without-jev"]!)} 
            title="Without Jev Output"
            icon={<Brain className="w-4 h-4 text-blue-400" />}
          />
        </div>
      ) : results["with-jev"] ? (
        <MemoryGraph 
          {...computeMergedState(results["with-jev"]!)} 
          title="With Jev Output"
          icon={<Zap className="w-4 h-4 text-fuchsia-400" />}
        />
      ) : (
        <MemoryGraph 
          memories={baseMemories} 
          links={baseLinks} 
          title="Baseline Memory Store (IndexedDB)" 
        />
      )}
    </div>
  );
}
