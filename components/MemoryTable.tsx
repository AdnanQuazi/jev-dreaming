"use client";

import { useState, useEffect, useCallback } from "react";
import type { Memory, MemoryLink } from "@/types";
import { getAllMemories, getAllLinks, seedIfEmpty, clearAllData } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Database, RefreshCw, Trash2, ExternalLink, Link2 } from "lucide-react";

const TYPE_COLORS = {
  semantic: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  episodic: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/20",
  procedural: "bg-amber-500/15 text-amber-300 border-amber-500/20",
};

const STATUS_COLORS = {
  active: "bg-emerald-500/15 text-emerald-300",
  superseded: "bg-red-500/10 text-red-400/70 line-through",
};

interface Props {
  refreshTrigger?: number;
}

export function MemoryTable({ refreshTrigger }: Props) {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [links, setLinks] = useState<MemoryLink[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await seedIfEmpty();
      const [mems, lks] = await Promise.all([getAllMemories(), getAllLinks()]);
      setMemories(mems.sort((a, b) => b.createdAt - a.createdAt));
      setLinks(lks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshTrigger]);

  const handleClear = async () => {
    await clearAllData();
    setMemories([]);
    setLinks([]);
    setTimeout(refresh, 100);
  };

  const getLinksForMemory = (id: string) =>
    links.filter((l) => l.fromId === id || l.toId === id);

  const getLinkedMemory = (link: MemoryLink, currentId: string): Memory | undefined => {
    const targetId = link.fromId === currentId ? link.toId : link.fromId;
    return memories.find((m) => m.id === targetId);
  };

  const activeCount = memories.filter((m) => m.status === "active").length;
  const supersededCount = memories.filter((m) => m.status === "superseded").length;

  return (
    <Card className="bg-[#0f0f0f] border-white/10">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            Memory Store
            <span className="text-sm font-normal text-white/30 normal-case">
              IndexedDB
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/40">
              {activeCount} active · {supersededCount} superseded · {links.length} links
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-white/30 hover:text-white/70"
              onClick={refresh}
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0 text-white/30 hover:text-red-400"
              onClick={handleClear}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Tabs defaultValue="all">
          <TabsList className="w-full rounded-none border-b border-white/8 bg-transparent h-8 px-4 justify-start gap-0">
            {(["all", "active", "superseded", "links"] as const).map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="text-xs h-full rounded-none border-b-2 border-transparent data-[state=active]:border-fuchsia-400 data-[state=active]:text-white data-[state=active]:bg-transparent text-white/40 px-3"
              >
                {tab === "links" ? `Links (${links.length})` : tab === "all" ? `All (${memories.length})` : tab === "active" ? `Active (${activeCount})` : `Superseded (${supersededCount})`}
              </TabsTrigger>
            ))}
          </TabsList>

          {(["all", "active", "superseded"] as const).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-0">
              <ScrollArea className="h-[300px]">
                {loading ? (
                  <div className="flex items-center justify-center h-32 text-white/30 text-sm">
                    Loading…
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {memories
                      .filter((m) => tab === "all" || m.status === tab)
                      .map((memory) => {
                        const memLinks = getLinksForMemory(memory.id);
                        return (
                          <div
                            key={memory.id}
                            className={`px-4 py-3 transition-colors hover:bg-white/2 ${
                              memory.status === "superseded" ? "opacity-50" : ""
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`text-sm leading-relaxed ${
                                    memory.status === "superseded"
                                      ? "text-white/30 line-through"
                                      : "text-white/80"
                                  }`}
                                >
                                  {memory.content}
                                </p>

                                {/* Links */}
                                {memLinks.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {memLinks.map((link) => {
                                      const linked = getLinkedMemory(link, memory.id);
                                      return (
                                        <span
                                          key={link.id}
                                          className="inline-flex items-center gap-0.5 text-sm text-purple-400/60 bg-purple-500/5 border border-purple-500/15 rounded px-1 py-0.5"
                                        >
                                          <Link2 className="w-2 h-2" />
                                          {linked?.content.slice(0, 35)}…
                                        </span>
                                      );
                                    })}
                                  </div>
                                )}

                                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] h-4 px-1.5 border ${TYPE_COLORS[memory.type]}`}
                                  >
                                    {memory.type}
                                  </Badge>
                                  <Badge
                                    variant="outline"
                                    className={`text-[9px] h-4 px-1.5 border-0 ${STATUS_COLORS[memory.status]}`}
                                  >
                                    {memory.status}
                                  </Badge>
                                  {memory.sourceChunkId >= 0 && (
                                    <span className="text-sm text-white/25 font-mono">
                                      chunk {memory.sourceChunkId + 1}
                                    </span>
                                  )}
                                  {memory.supersededBy && (
                                    <span className="text-sm text-white/25 font-mono">
                                      → {memory.supersededBy.slice(0, 8)}
                                    </span>
                                  )}
                                  <span className="text-sm text-white/20 font-mono ml-auto">
                                    {(memory.confidence * 100).toFixed(0)}%
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}

                    {memories.filter((m) => tab === "all" || m.status === tab).length === 0 && (
                      <div className="flex items-center justify-center h-32 text-white/25 text-sm">
                        No memories
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          ))}

          <TabsContent value="links" className="mt-0">
            <ScrollArea className="h-[300px]">
              <div className="divide-y divide-white/5">
                {links.map((link) => {
                  const from = memories.find((m) => m.id === link.fromId);
                  const to = memories.find((m) => m.id === link.toId);
                  return (
                    <div key={link.id} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <Link2 className="w-3 h-3 text-purple-400 mt-0.5 flex-none" />
                        <div className="space-y-1 flex-1 min-w-0">
                          <p className="text-sm text-white/70 truncate">
                            {from?.content.slice(0, 80)}…
                          </p>
                          <div className="flex items-center gap-1">
                            <div className="h-px flex-1 bg-purple-500/20" />
                            <span className="text-sm text-purple-400/60 px-1">{link.relation}</span>
                            <div className="h-px flex-1 bg-purple-500/20" />
                          </div>
                          <p className="text-sm text-white/70 truncate">
                            {to?.content.slice(0, 80)}…
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {links.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 gap-2 text-white/25 text-sm">
                    <Link2 className="w-6 h-6 opacity-30" />
                    <p>No memory links yet</p>
                    <p className="text-sm">Run the pipeline to generate LINK mutations</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
