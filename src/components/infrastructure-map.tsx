"use client";

import { useEffect, useId, useRef, useState, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Globe2, GitBranch, Network, Fingerprint, ArrowLeftRight, Code2, Cloud, CircleDot, Plus, Minus, Maximize2, Crosshair, ArrowUpRight } from "lucide-react";
import type { GraphNode, InfrastructureGraph, Layer } from "@/lib/types";
import { ConfidenceBadge } from "./primitives";

const icons: Record<string, typeof Globe2> = { url: Globe2, dns: GitBranch, ip: CircleDot, network: Network, tls: Fingerprint, http: ArrowLeftRight, infrastructure: Cloud, technology: Code2 };
const desktopPositions: Record<string, { x: number; y: number }> = {
  url: { x: 50, y: 185 }, dns: { x: 365, y: 60 }, ip: { x: 680, y: 60 },
  network: { x: 680, y: 265 }, http: { x: 365, y: 265 },
  tls: { x: 50, y: 465 }, infrastructure: { x: 365, y: 465 }, technology: { x: 680, y: 465 },
};
const order = ["url", "dns", "ip", "network", "http", "tls", "infrastructure", "technology"];

export function InfrastructureMap({ graph, running, onSelect, selectedLayer, detail = false, focusVersion = 0 }: {
  graph: InfrastructureGraph; running: boolean; onSelect: (node: GraphNode) => void; selectedLayer?: Layer | null; detail?: boolean; focusVersion?: number;
}) {
  const id = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const viewport = useRef<HTMLDivElement>(null);
  const [mobile, setMobile] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const reset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); setFocusedNode(null); }, []);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setMobile(entry.contentRect.width < 620));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { reset(); }, [mobile, reset, focusVersion]);
  useEffect(() => {
    if (focusVersion > 0) viewport.current?.focus({ preventScroll: true });
  }, [focusVersion]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (mobile) return;
      event.preventDefault();
      setZoom((current) => Math.min(1.75, Math.max(.65, current - event.deltaY * .001)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [mobile]);
  const nodes = [...graph.nodes].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const W = mobile ? 420 : 960;
  const H = mobile ? Math.max(570, nodes.length * 135 + 45) : 600;
  const nodeW = mobile ? 304 : 225;
  const nodeH = mobile ? 90 : 94;
  const positions = Object.fromEntries(nodes.map((node, i) => [node.id, mobile ? { x: 57, y: 25 + i * 135 } : (desktopPositions[node.id] ?? { x: 365, y: 265 })]));
  const related = new Set(focusedNode ? graph.edges.filter((e) => e.from === focusedNode || e.to === focusedNode).flatMap((e) => [e.from, e.to]) : []);
  const pathFor = (from: string, to: string) => {
    const a = positions[from], b = positions[to];
    if (!a || !b) return null;
    if (mobile) {
      const startY = a.y + nodeH, endY = b.y;
      if (Math.abs(b.y - a.y) <= 140) return `M${W / 2} ${startY}V${endY}`;
      return `M${a.x} ${a.y + nodeH / 2}H25V${b.y + nodeH / 2}H${b.x}`;
    }
    if (a.x === b.x) return `M${a.x + nodeW / 2} ${a.y + nodeH}V${b.y}`;
    const forward = b.x > a.x;
    const startX = forward ? a.x + nodeW : a.x;
    const endX = forward ? b.x : b.x + nodeW;
    const startY = a.y + nodeH / 2, endY = b.y + nodeH / 2;
    const mid = (startX + endX) / 2;
    return `M${startX} ${startY}C${mid} ${startY} ${mid} ${endY} ${endX} ${endY}`;
  };
  const focusNode = (node: GraphNode) => {
    setFocusedNode((current) => current === node.id ? null : node.id);
    if (!mobile && viewport.current) {
      const pos = positions[node.id];
      const scale = viewport.current.clientWidth / W;
      setZoom(1.25);
      setPan({ x: (W / 2 - pos.x - nodeW / 2) * scale * .6, y: (H / 2 - pos.y - nodeH / 2) * scale * .6 });
    }
  };
  return <section className="map-section" aria-label="Live infrastructure map">
    <div className="map-topline"><div><span className="crosshair">+</span><span>INFRASTRUCTURE MAP</span></div><span className={`map-live ${running ? "is-running" : ""}`}><i />{running ? "ASSEMBLING" : "OBSERVATION COMPLETE"}</span></div>
    <div className={`map-viewport ${mobile ? "map-mobile" : ""}`} ref={viewport} tabIndex={0} aria-label="Infrastructure graph. Select a node to inspect its evidence."
      onKeyDown={(e) => { if (e.key === "Escape") reset(); if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(1.75, z + .1)); if (e.key === "-") setZoom((z) => Math.max(.65, z - .1)); }}
      onPointerDown={(e) => {
        if (mobile || (e.target as HTMLElement).closest("button")) return;
        drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => { if (drag.current) setPan({ x: Math.max(-350, Math.min(350, drag.current.px + e.clientX - drag.current.x)), y: Math.max(-250, Math.min(250, drag.current.py + e.clientY - drag.current.y)) }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="map-grid" />
      {running && !reduced && <div className="scan-beam" />}
      <div className="map-canvas" style={{ aspectRatio: `${W} / ${H}`, transform: mobile ? undefined : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg viewBox={`0 0 ${W} ${H}`} className="graph-edges" aria-hidden="true">
          <defs><marker id={`${id}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M1 1L5 3L1 5" fill="none" stroke="var(--edge)" strokeWidth=".8" /></marker></defs>
          {graph.edges.map((edge, i) => {
            const d = pathFor(edge.from, edge.to);
            if (!d) return null;
            const a = positions[edge.from], b = positions[edge.to];
            const muted = !!focusedNode && edge.from !== focusedNode && edge.to !== focusedNode;
            const directional = edge.kind === "resolution" || edge.kind === "request";
            const labelX = a.x === b.x ? a.x + nodeW / 2 + 9 : (a.x + b.x + nodeW) / 2;
            const labelY = a.x === b.x ? (a.y + b.y + nodeH) / 2 : (a.y + b.y) / 2 + nodeH / 2 - 12;
            return <motion.g key={edge.id} initial={{ opacity: 0 }} animate={{ opacity: muted ? .17 : 1 }} transition={{ duration: .5 }}>
              <motion.path d={d} fill="none" stroke={edge.kind === "inference" ? "var(--edge-inferred)" : "var(--edge)"} strokeWidth="1.15"
                strokeDasharray={edge.kind === "inference" ? "3 5" : edge.kind === "relationship" ? "1 4" : undefined}
                markerEnd={directional ? `url(#${id}-arrow)` : undefined} initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: .7 }} />
              {directional && !reduced && <circle r="2.1" fill="var(--accent)" opacity=".75"><animateMotion dur={`${3.8 + (i % 3)}s`} begin={`${i * .25}s`} repeatCount="indefinite" path={d} /></circle>}
              {!mobile && detail && <text x={labelX} y={labelY} textAnchor={a.x === b.x ? "start" : "middle"} className="edge-label">{edge.label.length > 24 ? edge.label.slice(0, 23) + "…" : edge.label}</text>}
            </motion.g>;
          })}
        </svg>
        {nodes.map((node, i) => {
          const pos = positions[node.id];
          const Icon = icons[node.id] ?? CircleDot;
          const investigating = node.status === "investigating" || node.status === "pending";
          const muted = !!focusedNode && !related.has(node.id) && node.id !== focusedNode;
          return <motion.div key={node.id} className={`graph-node-wrapper ${node.id === "url" ? "root-node" : ""} ${selectedLayer === node.layer ? "node-selected" : ""} ${muted ? "node-muted" : ""}`}
            style={{ left: `${pos.x / W * 100}%`, top: `${pos.y / H * 100}%`, width: `${nodeW / W * 100}%`, height: `${nodeH / H * 100}%` }}
            initial={reduced ? false : { opacity: 0, y: 12, scale: .97 }} animate={{ opacity: muted ? .28 : 1, y: 0, scale: 1 }} transition={{ duration: .45, delay: Math.min(i * .035, .18) }}>
            <button className={`graph-node ${investigating ? "node-investigating" : ""} ${node.confidence === "unknown" ? "node-unknown" : ""}`}
              aria-label={`Inspect ${node.eyebrow}: ${node.label}`} onClick={() => onSelect(node)} onDoubleClick={() => focusNode(node)}
              onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(node.id)} onBlur={() => setHovered(null)}>
              <div className="node-top"><span><Icon size={13} strokeWidth={1.35} />{node.eyebrow}</span><span className={`node-state ${node.confidence}`} /></div>
              <strong title={node.label}>{node.label}</strong>
              <span className="node-detail">{node.detail || (investigating ? "Waiting for evidence" : "Select to inspect")}</span>
              <ArrowUpRight className="node-open" size={13} />
            </button>
            {hovered === node.id && !mobile && <div className={`node-tooltip ${pos.y > 380 ? "tooltip-above" : ""}`} role="tooltip"><ConfidenceBadge confidence={node.confidence} compact /><span>{node.detail}</span><small>Click to inspect · Double-click to focus</small></div>}
          </motion.div>;
        })}
        {!nodes.length && <div className="map-empty"><Crosshair size={30} strokeWidth={1} /><span>The first evidence will appear here.</span></div>}
      </div>
    </div>
    <div className="map-bottomline"><div className="graph-legend"><span><i className="solid-key" />Resolution / request</span><span><i className="dotted-key" />Relationship</span><span><i className="inferred-key" />Inference</span></div>
      <div className="map-controls"><button className="icon-button" onClick={() => setZoom((z) => Math.max(.65, z - .15))} aria-label="Zoom out" disabled={mobile || zoom <= .65}><Minus size={15} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button" onClick={() => setZoom((z) => Math.min(1.75, z + .15))} aria-label="Zoom in" disabled={mobile || zoom >= 1.75}><Plus size={15} /></button><button className="icon-button" onClick={reset} aria-label="Fit graph"><Maximize2 size={14} /></button></div>
    </div>
    <p className="map-scope">A map of observed relationships, not a traceroute or a physical route to a server.</p>
  </section>;
}
