"use client";

import { useId } from "react";
import { ArrowUpRight, Check, CircleHelp, LoaderCircle } from "lucide-react";
import type { Layer } from "@/lib/types";
import type { Takeaway } from "@/lib/insights";

const links: Record<Layer, string> = {
  url: "URL details", dns: "DNS", http: "Redirects & HTTP", tls: "Certificate",
  network: "IP & network", technology: "Technologies", infrastructure: "Edge & hosting", history: "Observation details",
};

export function ResultSummary({ takeaway, onSelect }: { takeaway: Takeaway; onSelect: (layer: Layer) => void }) {
  const heading = useId();
  const Icon = takeaway.tone === "pending" ? LoaderCircle : takeaway.tone === "positive" ? Check : CircleHelp;
  return <section className={`result-summary summary-${takeaway.tone}`} aria-labelledby={heading}>
    <div className="result-summary-main">
      <Icon size={22} strokeWidth={1.6} aria-hidden="true" className={takeaway.tone === "pending" ? "spin" : ""} />
      <div>
        <span className="eyebrow">WHAT HAPPENED</span>
        <h2 id={heading}>{takeaway.title}</h2>
        <p className="result-summary-description">{takeaway.description}</p>
        {takeaway.notes.map((note) => <p className="result-summary-note" key={note}>{note}</p>)}
      </div>
      {!takeaway.nextChecks.some((check) => check.layer === takeaway.layer) && <button className="text-button summary-evidence" onClick={() => onSelect(takeaway.layer)}>Open {links[takeaway.layer]}<ArrowUpRight size={14} aria-hidden="true" /></button>}
    </div>
    {takeaway.nextChecks.length > 0 && <div className="next-checks" aria-label="Suggested next checks">
      <span className="eyebrow">WHAT TO CHECK NEXT</span>
      {takeaway.nextChecks.map((check) => <div className="next-check" key={check.id}>
        <div><h3>{check.title}</h3><p>{check.description}</p></div>
        <button className="text-button" onClick={() => onSelect(check.layer)}>Open {links[check.layer]}<ArrowUpRight size={14} aria-hidden="true" /></button>
      </div>)}
    </div>}
  </section>;
}
