"use client";

import { useMemo, useCallback, useRef, useState, useEffect } from "react";
import type { Memory, MemoryLink } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Database, Zap, Brain, Expand, Filter } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "./ui/button";

// Dynamically import react-force-graph-2d to avoid SSR issues with window object
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const TYPE_COLORS: Record<string, string> = {
  semantic: "#3b82f6", // blue-500
  episodic: "#d946ef", // fuchsia-500
  procedural: "#f59e0b", // amber-500
};

interface Props {
  memories: Memory[];
  links: MemoryLink[];
  title?: string;
  icon?: React.ReactNode;
}

export function MemoryGraph({ memories, links, title = "Knowledge Graph", icon = <Database className="w-4 h-4 text-blue-400" /> }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 400 });
  const [showSuperseded, setShowSuperseded] = useState(false);

  const graphRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Measure after a short delay so the container has painted
    const measure = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0) {
          setDimensions({ width, height: height || 400 });
        }
      }
    };

    // Initial measure with a small delay to let layout settle
    const timer = setTimeout(measure, 50);

    // Use ResizeObserver so graph updates when the container itself resizes
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);

    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const graphData = useMemo(() => {
    const visibleMemories = showSuperseded 
      ? memories 
      : memories.filter(m => m.status === "active");

    const visibleNodeIds = new Set(visibleMemories.map(m => m.id));

    const visibleLinks = links.filter(l => visibleNodeIds.has(l.fromId) && visibleNodeIds.has(l.toId));

    const nodes = visibleMemories.map(m => ({
      id: m.id,
      name: m.content,
      val: m.status === "active" ? 2 : 1, // Size
      color: m.status === "superseded" ? "#555555" : (TYPE_COLORS[m.type] || "#888888"),
      type: m.type,
      status: m.status
    }));

    const graphLinks: any[] = visibleLinks.map(l => ({
      source: l.fromId,
      target: l.toId,
      name: l.relation === "related" ? "extends" : l.relation,
      color: l.relation === "related" ? "rgba(167, 139, 250, 0.4)" : "rgba(255,255,255,0.15)",
      lineDash: []
    }));

    visibleMemories.forEach(m => {
      if (m.status === "superseded" && m.supersededBy && visibleNodeIds.has(m.supersededBy)) {
        graphLinks.push({
          source: m.id,
          target: m.supersededBy,
          name: "superseded_by",
          color: "rgba(239, 68, 68, 0.5)",
          lineDash: [3, 3]
        });
      }
    });

    return { nodes, links: graphLinks };
  }, [memories, links, showSuperseded]);

  return (
    <Card className="bg-[#0f0f0f] border-white/10 h-full flex flex-col overflow-hidden">
      <CardHeader className="pb-3 flex-none shrink-0 border-b border-white/5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white/80 tracking-wide uppercase flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/40 font-mono">
              {graphData.nodes.length} nodes · {graphData.links.length} edges
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSuperseded(!showSuperseded)}
              className={`h-7 px-2 text-[10px] uppercase font-bold tracking-wider ${showSuperseded ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
            >
              <Filter className="w-3 h-3 mr-1" />
              {showSuperseded ? "Hide Superseded" : "Show Superseded"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 relative min-h-[400px]" ref={containerRef}>
        {graphData.nodes.length > 0 ? (
          <div className="absolute inset-0">
            <ForceGraph2D
              ref={graphRef}
              key={graphData.nodes.length}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              nodeLabel="name"
              nodeColor="color"
              nodeRelSize={4}
              linkColor={(link: any) => link.color || "rgba(255,255,255,0.15)"}
              linkLineDash={(link: any) => link.lineDash}
              linkDirectionalArrowLength={3.5}
              linkDirectionalArrowRelPos={1}
              enableNodeDrag={true}
              enableZoomInteraction={true}
              enablePanInteraction={true}
              onEngineStop={() => {
                // After the simulation settles, zoom to fit so all nodes are
                // within the canvas viewport — this also aligns the hit-test
                // coordinate system with the visual positions, fixing hover/click.
                if (graphRef.current) {
                  graphRef.current.zoomToFit(400, 30);
                }
              }}
              onNodeClick={(node: any) => {
                console.log(node);
              }}
              backgroundColor="#0f0f0f"
            />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/20 text-sm">
            No memories to display
          </div>
        )}
      </CardContent>
    </Card>
  );
}
