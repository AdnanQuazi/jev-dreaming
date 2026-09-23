"use client";

import { useState, useCallback } from "react";
import { PRESET_CHUNKS } from "@/lib/chunks";
import type { Chunk } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, FileText, X } from "lucide-react";


interface Props {
  chunks: Chunk[];
  onChange: (chunks: Chunk[]) => void;
  triageResults?: Record<
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
  >;
}

export function ChunkInput({ chunks, onChange, triageResults = {} }: Props) {
  const loadPreset = useCallback(() => {
    onChange(PRESET_CHUNKS.map((c) => ({ ...c })));
  }, [onChange]);

  const addChunk = useCallback(() => {
    if (chunks.length >= 10) return;
    const newId = chunks.length > 0 ? Math.max(...chunks.map((c) => c.id)) + 1 : 0;
    onChange([...chunks, { id: newId, text: "", label: `Chunk ${newId + 1}` }]);
  }, [chunks, onChange]);

  const removeChunk = useCallback(
    (id: number) => {
      onChange(chunks.filter((c) => c.id !== id));
    },
    [chunks, onChange]
  );

  const updateChunk = useCallback(
    (id: number, text: string) => {
      onChange(chunks.map((c) => (c.id === id ? { ...c, text } : c)));
    },
    [chunks, onChange]
  );

  const clearAll = useCallback(() => onChange([]), [onChange]);

  return (
    <Card className="bg-[#0f0f0f] border-white/10 flex flex-col h-[450px] lg:h-full">
      <CardHeader className="pb-3 flex-none">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase">
            Chunks
            <span className="ml-2 text-sm text-white/40 font-normal normal-case">
              {chunks.length}/10
            </span>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs border-white/10 bg-white/5 hover:bg-white/10 text-white/70"
              onClick={loadPreset}
            >
              <FileText className="w-3 h-3 mr-1" />
              Load Demo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-white/40 hover:text-white/70"
              onClick={clearAll}
            >
              <X className="w-3 h-3 mr-1" />
              Clear
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 p-0">
        <ScrollArea className="h-full px-4">
          <div className="space-y-2 pb-4">
            {chunks.length === 0 && (
              <div className="py-10 text-center text-white/30 text-sm">
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>No chunks loaded</p>
                <p className="text-sm mt-1">Load the demo dataset or add chunks manually</p>
              </div>
            )}

            {chunks.map((chunk, idx) => {
              const result = triageResults[chunk.id];
              const charCount = chunk.text.length;
              return (
                <div
                  key={chunk.id}
                  className={`group relative rounded-none border transition-all duration-300 ${
                    result
                      ? result.passedGate
                        ? "border-emerald-500/40 bg-emerald-950/20"
                        : "border-red-500/20 bg-red-950/10"
                      : "border-white/8 bg-white/3"
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 pt-2 pb-1">
                    <span className="text-sm font-mono text-white/30 w-4 text-center">
                      {idx + 1}
                    </span>
                    <span className="text-sm text-white/50 flex-1 truncate">
                      {chunk.label || `Chunk ${chunk.id + 1}`}
                    </span>
                    <span className={`text-sm font-mono ${charCount >= 600 ? "text-emerald-400/60" : "text-amber-400/60"}`}>
                      {charCount}c
                    </span>
                    {result && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`h-4 text-[9px] px-1 border-0 ${
                            result.passedGate
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {result.passedGate ? "✓ Pass" : "✗ Drop"}
                        </Badge>
                        {result.knowledgeProbability !== undefined ? (
                          <span className="text-xs text-white/40 font-mono">
                            Knowledge: {Math.round(result.knowledgeProbability * 100)}%
                            {result.totalCandidates !== undefined && result.totalCandidates > 0 && (
                              ` · ${result.forwardedCount ?? 0}/${result.totalCandidates} rel`
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-white/40 font-mono">
                            Score {result.worthinessScore}/3 · Δ {Math.round((result.deltaProbability ?? 0) * 100)}%
                          </span>
                        )}
                      </div>
                    )}
                    <button
                      onClick={() => removeChunk(chunk.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-white/30 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  {/* Textarea */}
                  <div className="px-3 pb-2">
                    <textarea
                      value={chunk.text}
                      onChange={(e) => updateChunk(chunk.id, e.target.value)}
                      placeholder="Paste your text chunk here (600+ chars recommended)..."
                      className="w-full bg-transparent text-sm text-white/70 placeholder-white/20 resize-none outline-none leading-relaxed min-h-[60px] max-h-[120px]"
                      rows={3}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>

      {/* Footer */}
      <div className="flex-none px-4 pb-4 pt-2 border-t border-white/8">
        <Button
          size="sm"
          variant="ghost"
          className="w-full h-8 text-xs border border-dashed border-white/15 text-white/40 hover:text-white/70 hover:border-white/25 hover:bg-white/5"
          onClick={addChunk}
          disabled={chunks.length >= 10}
        >
          <Plus className="w-3 h-3 mr-1.5" />
          Add Chunk ({chunks.length}/10)
        </Button>
      </div>
    </Card>
  );
}
