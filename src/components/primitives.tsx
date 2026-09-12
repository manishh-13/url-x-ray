"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight } from "lucide-react";
import type { Confidence, Layer } from "@/lib/types";

export const layerNames: Record<Layer, string> = {
  url: "The URL", dns: "DNS resolution", http: "The response", tls: "TLS certificate",
  network: "IP & network", technology: "Technologies", infrastructure: "Edge & hosting", history: "History",
};

export function XRayMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M5 5L27 27M27 5L5 27" stroke="currentColor" strokeWidth="1.25" />
    <path d="M10 3L29 22M3 10L22 29M22 3L3 22M29 10L10 29" stroke="currentColor" strokeWidth="1.25" opacity=".4" />
    <circle cx="16" cy="16" r="4" fill="var(--bg, #101211)" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="16" cy="16" r="1.3" fill="currentColor" />
  </svg>;
}

export function ConfidenceBadge({ confidence, compact = false }: { confidence: Confidence; compact?: boolean }) {
  const labels = { observed: "Observed", inferred: "Inferred", unknown: "Unknown" };
  return <span className={`confidence confidence-${confidence} ${compact ? "compact" : ""}`} title={
    confidence === "observed" ? "Directly obtained in this investigation" :
      confidence === "inferred" ? "Suggested by evidence, not independently verified" : "Could not be determined"
  }><span className="confidence-dot" />{labels[confidence]}</span>;
}

export function Dialog({ open, onClose, title, eyebrow, children, wide = false }: {
  open: boolean; onClose: () => void; title: string; eyebrow?: string; children: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  return <dialog ref={ref} className={`instrument-dialog ${wide ? "dialog-wide" : ""}`} onCancel={onClose} onClose={onClose}
    aria-label={title} onClick={(event) => {
      if (event.target !== ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className="dialog-header">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>
      <button className="icon-button" aria-label="Close panel" onClick={onClose}><X size={19} /></button>
    </div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}

export function SourceLink({ url, children }: { url: string; children?: ReactNode }) {
  let safe = false;
  try { safe = new URL(url).protocol === "https:"; } catch { /* Invalid source is not a link. */ }
  if (!safe) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="source-link">{children ?? "Source"}<ArrowUpRight size={12} /></a>;
}
