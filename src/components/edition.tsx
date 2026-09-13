"use client";

import { useState } from "react";
import { ArrowUpRight, Check, Download, Laptop, MonitorDown, Radio, ShieldCheck, Terminal } from "lucide-react";
import { DOWNLOAD_URL, IS_BROWSER_EDITION, LOCAL_ONLY_MESSAGES, REPOSITORY_URL } from "@/lib/edition";
import { Dialog } from "./primitives";

export type LocalOnlyLayer = "http" | "tls" | "technology" | "infrastructure";

const localOnlyHeadings: Record<LocalOnlyLayer, string> = {
  http: "Redirects and headers need the local app.",
  tls: "Certificate inspection needs the local app.",
  technology: "Response technologies need the local app.",
  infrastructure: "Response based platform clues need the local app.",
};

const browserLimits: Record<LocalOnlyLayer, string> = {
  http: "A page in your browser cannot reliably read another site’s response headers or walk its redirect chain, because that depends on the site opting in. This edition does not try, so there is nothing dependable for this layer to observe here.",
  tls: "A browser never hands another site’s certificate to a page, so there is no handshake to inspect here.",
  technology: "Reading another site’s response body from a page works only when that site opts in, so header and HTML signatures cannot be collected reliably here. This edition does not attempt it.",
  infrastructure: "Edge and hosting inference reads response headers and HTML. In this edition only live DNS and network affiliation hints are available, and each one still carries its evidence.",
};

function localOnlyMessage(layer: LocalOnlyLayer) {
  return layer === "infrastructure" ? "Run the project locally to add header and HTML based platform inference." : LOCAL_ONLY_MESSAGES[layer];
}

export function EditionBadge() {
  return <span className="edition-badge" title={IS_BROWSER_EDITION
    ? "Runs entirely in this browser. DNS and network checks are live; certificate, redirect, header and technology checks need the local app."
    : "Running from the project on this machine, with every check available."}>
    <span />{IS_BROWSER_EDITION ? "BROWSER EDITION" : "LOCAL EDITION"}
  </span>;
}

function CommandBlock() {
  const [copied, setCopied] = useState(false);
  const commands = "npm ci\nnpm run dev";
  return <div className="setup-commands">
    <pre><code>{commands}</code></pre>
    <button className="secondary-button" onClick={async () => {
      try { await navigator.clipboard.writeText(commands); setCopied(true); } catch { setCopied(false); }
    }} aria-label="Copy the npm ci and npm run dev commands">{copied ? <Check size={15} /> : <Terminal size={15} />}{copied ? "Copied" : "Copy"}</button>
  </div>;
}

export function LocalSetupSteps({ compact = false }: { compact?: boolean }) {
  return <div className={`local-setup ${compact ? "setup-compact" : ""}`}>
    <div className="setup-links">
      <a className="primary-button" href={DOWNLOAD_URL}><Download size={16} />Download project ZIP</a>
      <a className="secondary-button" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">GitHub source<ArrowUpRight size={15} /></a>
    </div>
    <ol className="setup-steps">
      <li><span>01</span><div><strong>Install Node.js 22 or newer</strong><p>The project needs Node 22 or newer and npm, which ships with it.</p></div></li>
      <li><span>02</span><div><strong>Extract the ZIP and open a terminal in the project folder</strong><p>Every command below runs from the folder that holds package.json.</p></div></li>
      <li><span>03</span><div><strong>Install and start</strong><p>Two commands, no configuration.</p><CommandBlock /></div></li>
      <li><span>04</span><div><strong>Open localhost port 3099</strong><p>The app serves at <code>http://127.0.0.1:3099</code>, on your machine only.</p></div></li>
    </ol>
    <p className="setup-assurance"><ShieldCheck size={16} aria-hidden="true" />No API keys, no account, no card. Every check runs from your own machine.</p>
  </div>;
}

export function RunLocallyAction({ compact = false, label = "Run locally" }: { compact?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!IS_BROWSER_EDITION) return null;
  return <>
    <button className={compact ? "secondary-button run-locally-compact" : "primary-button run-locally-button"} aria-label={label} onClick={() => setOpen(true)}>
      {compact ? <MonitorDown size={15} /> : <Laptop size={17} />}<span>{label}</span>
    </button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Run every check on your machine." eyebrow="RUN URL X-RAY LOCALLY" wide>
      <p className="detail-intro">This page keeps the live checks a browser can make. The project itself adds the certificate handshake, the redirect chain, response headers and response technologies, because those need a process that can connect to the target directly.</p>
      <LocalSetupSteps />
    </Dialog>
  </>;
}

export function EditionCapabilities({ variant = "landing" }: { variant?: "landing" | "compact" }) {
  if (!IS_BROWSER_EDITION) return null;
  if (variant === "compact") return <div className="edition-banner">
    <div><span className="eyebrow">BROWSER EDITION</span><p>DNS and network are live here. Certificate, redirects, headers and technologies come from the local app.</p></div>
    <RunLocallyAction compact />
  </div>;
  return <section className="edition-capabilities" aria-label="What runs where in this edition">
    <div className="capabilities-intro"><span className="eyebrow">WHAT RUNS WHERE</span><h2>Live here.<br />Complete on your machine.</h2><p>This hosted page is a static site with no backend. It makes only the lookups a browser is allowed to make, and it never requests the site you are inspecting.</p><RunLocallyAction /></div>
    <div className="capabilities-columns">
      <div className="capability-column">
        <div className="capability-heading"><Radio size={17} strokeWidth={1.4} aria-hidden="true" /><h3>Live in this browser</h3></div>
        <ul>
          <li><strong>DNS records</strong><span>A, AAAA, CNAME, NS, MX, TXT, CAA and more, over DNS over HTTPS.</span></li>
          <li><strong>IP and network</strong><span>ASN and announcing organization for each observed address.</span></li>
          <li><strong>Reverse DNS</strong><span>PTR names for the addresses DNS returned.</span></li>
        </ul>
      </div>
      <div className="capability-column">
        <div className="capability-heading"><Laptop size={17} strokeWidth={1.4} aria-hidden="true" /><h3>In the local app</h3></div>
        <ul>
          <li><strong>TLS certificate</strong><span>Issuer, validity, names and chain from a real handshake.</span></li>
          <li><strong>Redirects and headers</strong><span>The bounded request chain and the response headers along it.</span></li>
          <li><strong>Response technologies</strong><span>Header and HTML signatures, with the evidence behind each one.</span></li>
        </ul>
      </div>
    </div>
  </section>;
}

export function LocalOnlyPanel({ layer }: { layer: LocalOnlyLayer }) {
  return <div className="local-only-panel">
    <div className="local-only-head"><MonitorDown size={24} strokeWidth={1.2} aria-hidden="true" /><div><span className="eyebrow">LOCAL APP REQUIRED</span><h3>{localOnlyHeadings[layer]}</h3></div></div>
    <p className="local-only-message">{localOnlyMessage(layer)}</p>
    <p className="local-only-limit">{browserLimits[layer]}</p>
    <details className="raw-details local-setup-disclosure"><summary>How to run it locally <span>4 steps</span></summary><LocalSetupSteps compact /></details>
  </div>;
}
