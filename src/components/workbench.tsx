"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useMotionPreference } from "@/lib/client/use-motion-preference";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Circle, Code2, Download, FileJson, Image as ImageIcon, Link2, LoaderCircle, Minus, RefreshCw, ScanLine, Square, Waypoints, X } from "lucide-react";
import type { Finding, Investigation, Layer, ProviderId } from "@/lib/types";
import { buildInfrastructureGraph, interpretInvestigation } from "@/lib/interpretation";
import { buildOverviewFindings, buildTakeaway } from "@/lib/insights";
import { ResultSummary } from "./result-summary";
import { createReportJson, createReportSvg } from "@/lib/export";
import { ConfidenceBadge, Dialog, layerNames } from "./primitives";
import { UrlForm } from "./landing";
import { InfrastructureMap } from "./infrastructure-map";
import { EvidenceList, HistoryEmpty, LayerDrawer, NetworkDetails } from "./evidence-panel";

const stages: { id: ProviderId; label: string }[] = [
  { id: "dns", label: "Resolving DNS" }, { id: "http", label: "Following the request" },
  { id: "tls", label: "Inspecting certificate" }, { id: "network", label: "Identifying network" },
  { id: "technology", label: "Reading the response" },
];

export function InvestigationProgress({ investigation }: { investigation: Investigation }) {
  return <div className="investigation-progress" aria-label="Investigation progress">
    <span className="progress-stage complete"><Check size={12} /><span>URL parsed</span></span>
    {stages.map(({ id, label }) => {
      const status = investigation.providers[id].status;
      return <span key={id} className={`progress-stage ${status}`} title={investigation.providers[id].message}>
        {status === "complete" ? <Check size={12} /> : status === "investigating" ? <LoaderCircle className="spin" size={12} /> : status === "unavailable" ? <Minus size={12} /> : <Circle size={10} />}
        <span>{status === "complete" ? ({ dns: "DNS resolved", http: "Response inspected", tls: "Certificate inspected", network: "Network inspected", technology: "Signals analyzed" })[id] : status === "unavailable" ? ({ dns: "DNS unavailable", http: "HTTP unavailable", tls: "TLS unavailable", network: "Network unavailable", technology: "Signals unavailable" })[id] : label}</span>
      </span>;
    })}
  </div>;
}

export function ParseSequence({ url, running, onSelect }: { url: Investigation["url"]; running: boolean; onSelect: () => void }) {
  const reduced = useMotionPreference();
  const parts = [
    { label: "PROTOCOL", value: `${url.scheme}://`, className: "part-scheme" },
    { label: "HOSTNAME", value: url.hostname, className: "part-host" },
    { label: "PATH", value: url.pathname, className: "part-path" },
  ];
  return <div className={`parse-sequence ${running ? "parsing-active" : ""}`}>
    <button className="parse-label" onClick={onSelect}><span className="parse-number">01</span><span>THE ADDRESS,<br />TAKEN APART</span><ArrowUpRight size={13} /></button>
    <div className="url-components">{parts.map((part, i) => <motion.button className={`url-part ${part.className}`} key={part.label}
      initial={reduced ? false : { opacity: 0, x: -10 * (i + 1) }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .7, delay: i * .13 }} onClick={onSelect}>
      <code>{part.value}</code><span>{part.label}</span>
    </motion.button>)}
    {(url.hasQuery || url.hasFragment) && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="query-removed"><span><X size={11} />{url.hasQuery ? "query" : "fragment"}</span><small>REMOVED FOR PRIVACY</small></motion.span>}
    </div>
    <span className="parse-check"><Check size={12} />PARSED</span>
  </div>;
}

function Story({ findings, overview, onSelect, running, detailed }: { findings: Finding[]; overview: Finding[]; onSelect: (layer: Layer) => void; running: boolean; detailed: boolean }) {
  const reduced = useMotionPreference();
  const [expanded, setExpanded] = useState(false);
  const storyId = useId();
  const showAll = detailed || expanded;
  const shown = showAll ? findings : overview;
  return <aside className="story-panel" aria-label="The story behind this URL">
    <div className="story-header"><span className="eyebrow">{showAll ? "THE FULL STORY" : "AT A GLANCE"}</span><Waypoints size={16} strokeWidth={1.2} /></div>
    <h2>A little less invisible.</h2><p className="story-intro">{showAll ? "Every finding, with its supporting evidence." : "Five layers, with the detail a click away."}</p>
    <div className="story-findings" id={storyId}><AnimatePresence initial={false}>{shown.map((finding, index) => <motion.article key={finding.id} initial={reduced ? false : { opacity: 0, y: 9 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }} className={`story-finding finding-${finding.confidence}`}>
      <span className="story-step-number">{String(index + 1).padStart(2, "0")}</span><div><ConfidenceBadge confidence={finding.confidence} compact /><h3>{finding.title}</h3><p>{finding.description}</p><button onClick={() => onSelect(finding.layer)} className="story-inspect">{finding.confidence === "unknown" ? "Open details" : "Show the evidence"}<ArrowUpRight size={12} /></button></div>
    </motion.article>)}</AnimatePresence></div>
    {!detailed && <button className="story-toggle" aria-expanded={expanded} aria-controls={storyId} onClick={(event) => {
      setExpanded((value) => !value);
      if (expanded) event.currentTarget.closest(".story-panel")?.scrollIntoView({ block: "start", behavior: "instant" });
    }}>{expanded ? "Show fewer findings" : `Show all findings (${findings.length})`}<ArrowUpRight size={14} aria-hidden="true" /></button>}
    {running && <div className="story-listening"><span className="listening-dot" />Listening for the next layer.</div>}
    <div className="story-bottom"><span className="evidence-mark">∴</span><p>Open any finding to explore its evidence.</p></div>
  </aside>;
}

async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function downloadPng(svg: string, filename: string) {
  const image = new window.Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth * 2;
    canvas.height = image.naturalHeight * 2;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser couldn't create the image. SVG and JSON exports are still available.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG export wasn't available.")), "image/png"));
    await downloadBlob(blob, filename);
  } finally { URL.revokeObjectURL(url); }
}

export function Workbench({ investigation: i, running, error, onRun, onCancel, onHome, onMethodology }: {
  investigation: Investigation; running: boolean; error: string | null; onRun: (url: string) => void; onCancel: () => void; onHome: () => void; onMethodology: () => void;
}) {
  const [depth, setDepth] = useState(1);
  const [layer, setLayer] = useState<Layer | null>(null);
  const [focusVersion, setFocusVersion] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [editUrl, setEditUrl] = useState(false);
  const graph = useMemo(() => buildInfrastructureGraph(i), [i]);
  const findings = useMemo(() => interpretInvestigation(i), [i]);
  const overview = useMemo(() => buildOverviewFindings(i, running), [i, running]);
  const takeaway = useMemo(() => buildTakeaway(i, running), [i, running]);
  const missing = Object.values(i.providers).filter((provider) => provider.status === "unavailable").length;
  const observed = i.evidence.filter((item) => item.confidence === "observed").length;
  const inferred = findings.filter((item) => item.confidence === "inferred").length;
  const rerun = useCallback(() => onRun(i.url.href), [onRun, i.url.href]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]") || event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]")) return;
      if (event.key.toLowerCase() === "e") { event.preventDefault(); setDepth((current) => current === 3 ? 1 : 3); }
      if (event.key.toLowerCase() === "g") { event.preventDefault(); setDepth(1); setFocusVersion((current) => current + 1); document.getElementById("investigation-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
      if (event.key.toLowerCase() === "r" && !running) { event.preventDefault(); rerun(); }
      if (event.key === "Escape") { setLayer(null); setDepth(1); setFocusVersion((current) => current + 1); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [rerun, running]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function exportReport(format: "SVG" | "PNG" | "JSON") {
    setExporting(format);
    try {
      const filename = `url-x-ray-${i.url.hostname.replace(/[^a-z0-9.-]/gi, "_")}-${i.startedAt.slice(0, 10)}`;
      if (format === "JSON") await downloadBlob(new Blob([createReportJson(i)], { type: "application/json" }), `${filename}.json`);
      else if (format === "SVG") await downloadBlob(new Blob([createReportSvg(i)], { type: "image/svg+xml" }), `${filename}.svg`);
      else await downloadPng(createReportSvg(i), `${filename}.png`);
      setExportOpen(false);
      setNotice(`${format} report exported. Your observation stays with you.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "The report couldn't be exported. Please try JSON."); }
    finally { setExporting(null); }
  }
  const share = () => {
    setShareUrl(`${window.location.origin}/xray/${encodeURIComponent(i.url.hostname)}`);
    setShareOpen(true);
    setCopied(false);
  };

  return <main id="main-content" className="workbench">
    <div className="workbench-breadcrumb"><button onClick={onHome}><ArrowLeft size={14} />New investigation</button><span>/</span><span>{i.url.hostname}</span></div>
    <div className="result-title-row"><div><div className="result-eyebrow"><span className={`status-light ${running ? "active" : ""}`} /><span>{running ? "LIVE INVESTIGATION" : i.finishedAt ? missing ? "PARTIAL OBSERVATION" : "X-RAY COMPLETE" : "INVESTIGATION STOPPED"}</span><span className="result-date">{new Date(i.startedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC</span></div>
      <h1>{i.url.hostname}<button className="icon-button edit-url-button" onClick={() => setEditUrl((current) => !current)} aria-label="Change URL"><ScanLine size={18} /></button></h1>
      <p className="relationship-count">{graph.edges.length ? <>We found <strong>{graph.edges.length} infrastructure {graph.edges.length === 1 ? "relationship" : "relationships"}</strong>. {running ? "The picture is still developing." : "Here’s what they tell us."}</> : running ? "Putting the address under the X-ray." : "Here’s what we could observe from this address."}</p>
    </div><div className="result-actions">{running ? <button className="secondary-button" onClick={onCancel}><Square size={13} />Stop</button> : <button className="icon-button rerun-button" aria-label="Re-run analysis" onClick={rerun} title="Re-run analysis (R)"><RefreshCw size={16} /></button>}<button className="secondary-button" onClick={share}><Link2 size={15} /><span>Share</span></button><button className="secondary-button" onClick={() => setExportOpen(true)}><Download size={15} /><span>Export</span></button></div></div>
    {editUrl && <div className="edit-url-form"><UrlForm key={i.id} initialValue={i.url.href} compact onSubmit={(url) => { setEditUrl(false); onRun(url); }} /></div>}
    {error && <p role="alert" className="result-notice">{error}</p>}
    <ResultSummary takeaway={takeaway} onSelect={setLayer} />
    <InvestigationProgress investigation={i} />
    <ParseSequence url={i.url} running={running} onSelect={() => setLayer("url")} />
    <div className="depth-toolbar" id="investigation-workspace"><div className="depth-selector" role="group" aria-label="X-ray depth"><span>X-RAY DEPTH</span>{["Overview", "Infrastructure", "Evidence", "Network"].map((name, index) => <button key={name} aria-pressed={depth === index + 1} onClick={() => setDepth(index + 1)}><span>0{index + 1}</span>{name}{name === "Evidence" && <small>{i.evidence.length}</small>}</button>)}</div><button className="methodology-link" onClick={onMethodology}>How to read this <ArrowUpRight size={12} /></button></div>
    <div className="depth-content">
      {depth <= 2 && <div className="investigation-layout"><div className="map-column"><InfrastructureMap graph={graph} running={running} onSelect={(node) => setLayer(node.layer)} selectedLayer={layer} detail={depth === 2} focusVersion={focusVersion} />
        <div className="layer-rail"><span>GO DEEPER</span>{(["dns", "http", "tls", "network", "technology"] as Layer[]).map((key) => <button key={key} onClick={() => setLayer(key)}>{key === "http" ? "Redirects & HTTP" : key === "tls" ? "Certificate" : layerNames[key]}<ArrowUpRight size={12} /></button>)}</div>
        {depth === 2 && <div className="infrastructure-note"><span className="eyebrow">FOLLOW THE LINES</span><p>Solid lines show resolution and requests. Dotted lines connect related observations. Dashed lines are inferences: select the edge or technology node to see why.</p><button className="text-button" onClick={() => setLayer("infrastructure")}>Inspect edge & hosting clues<ArrowRight size={14} /></button></div>}
      </div><Story findings={findings} overview={overview} onSelect={setLayer} running={running} detailed={depth === 2} /></div>}
      {depth === 3 && <section className="evidence-workspace"><div className="evidence-workspace-intro"><div><span className="eyebrow">NOTHING BEHIND THE CURTAIN</span><h2>Show your work.</h2><p>Direct observations, with their sources. This is the evidence the map and story are built from.</p></div><div className="evidence-totals"><strong>{observed}<span>observed evidence</span></strong><strong>{inferred}<span>inferred findings</span></strong></div></div><EvidenceList evidence={i.evidence} searchable /></section>}
      {depth === 4 && <section className="network-workspace"><div><span className="eyebrow">BEYOND THE HOSTNAME</span><h2>The network underneath.</h2><NetworkDetails investigation={i} /></div><HistoryEmpty /></section>}
    </div>
    <div className="result-bottom"><div className="confidence-legend"><ConfidenceBadge confidence="observed" /><ConfidenceBadge confidence="inferred" /><ConfidenceBadge confidence="unknown" /></div><div className="keyboard-hints"><span><kbd>E</kbd> evidence</span><span><kbd>G</kbd> graph</span><span><kbd>R</kbd> re-run</span><span><kbd>esc</kbd> back</span></div></div>
    <div className="observation-scope"><span>ABOUT THIS OBSERVATION</span><p>A snapshot from this server at the time shown. Results can vary by location and time; open a finding to see its source.</p></div>
    <LayerDrawer investigation={i} layer={layer} onClose={() => setLayer(null)} onLayerChange={setLayer} />
    <Dialog open={exportOpen} onClose={() => setExportOpen(false)} title="Keep the observation." eyebrow="EXPORT YOUR X-RAY"><p className="detail-intro">A self-contained record of what we observed, with evidence labels and limitations. Nothing is uploaded.</p><div className="export-options">{[{ format: "PNG" as const, icon: ImageIcon, desc: "A high-resolution technical poster" }, { format: "SVG" as const, icon: Code2, desc: "A crisp, editable vector map" }, { format: "JSON" as const, icon: FileJson, desc: "Structured observations and evidence" }].map(({ format, icon: Icon, desc }) => <button key={format} disabled={!!exporting} onClick={() => void exportReport(format)}><Icon size={22} strokeWidth={1.2} /><div><strong>{format}</strong><span>{desc}</span></div>{exporting === format ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}</button>)}</div><p className="scope-note">Exports contain the inspected path and public observations. Review them before sharing.</p></Dialog>
    <Dialog open={shareOpen} onClose={() => setShareOpen(false)} title="Share the starting point." eyebrow="A LINK, NOT A SNAPSHOT"><p className="detail-intro">This link opens a fresh, user-initiated investigation of <strong>{i.url.hostname}</strong> over HTTPS. It does not preserve this observation, path, or query.</p><label htmlFor="share-url" className="eyebrow">HOSTNAME LINK</label><div className="share-field"><input id="share-url" value={shareUrl} readOnly onFocus={(e) => e.target.select()} /><button className="primary-button" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); } catch { setNotice("Clipboard access isn't available. Select the link and copy it manually."); } }}>{copied ? <Check size={15} /> : <Link2 size={15} />}{copied ? "Copied" : "Copy"}</button></div><p className="scope-note">This is a local, private build. A localhost link works only on this machine. Use an export to share the actual findings.</p></Dialog>
    {notice && <div className="toast" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice(null)}><X size={14} /></button></div>}
    <div className="sr-only" role="status" aria-live="polite">{running ? `${Object.values(i.providers).filter((state) => state.status === "complete").length} of 5 investigation providers complete.` : i.finishedAt ? `Investigation complete. ${graph.edges.length} relationships found. ${missing} layers unavailable.` : "Investigation stopped. Collected evidence is still available."}</div>
  </main>;
}
