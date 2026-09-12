"use client";

import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, ArrowUpRight, CornerDownLeft, Globe2, ScanLine, Braces, Network, Fingerprint, Route } from "lucide-react";

const examples = ["github.com", "cloudflare.com", "aws.amazon.com", "vercel.com"];

export function UrlForm({ onSubmit, compact = false, initialValue = "", busy = false }: {
  onSubmit: (url: string) => void; compact?: boolean; initialValue?: string; busy?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  }
  return <form onSubmit={submit} className={`url-form ${compact ? "compact-form" : ""}`}>
    <label className="sr-only" htmlFor={compact ? "result-url" : "hero-url"}>Public URL to investigate</label>
    <div className="url-field">
      <ScanLine size={compact ? 18 : 21} className="input-symbol" aria-hidden="true" />
      <input id={compact ? "result-url" : "hero-url"} name="url" value={value} onChange={(event) => setValue(event.target.value)}
        type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
        placeholder="Paste a URL to X-ray it…" required maxLength={2048} aria-describedby={compact ? undefined : "input-privacy"} />
      <button className="primary-button" type="submit" aria-label={busy ? "Investigating URL" : "X-ray URL"} disabled={!value.trim() || busy}>
        <span>{busy ? "Investigating" : "X-ray URL"}</span><ArrowRight size={17} aria-hidden="true" />
      </button>
      {!compact && <CornerDownLeft className="input-enter" size={13} aria-hidden="true" />}
    </div>
  </form>;
}

function ConceptSchematic({ hostname, preview }: { hostname: string; preview: boolean }) {
  const reduced = useReducedMotion();
  const nodes = [
    { x: 100, y: 147, w: 215, title: hostname, sub: "THE ADDRESS", key: "url" },
    { x: 415, y: 76, w: 178, title: "DNS resolution", sub: "THE DIRECTIONS", key: "dns" },
    { x: 745, y: 76, w: 180, title: "IP & network", sub: "THE INFRASTRUCTURE", key: "network" },
    { x: 415, y: 245, w: 178, title: "TLS certificate", sub: "THE IDENTITY", key: "tls" },
    { x: 745, y: 245, w: 180, title: "HTTP response", sub: "THE CONVERSATION", key: "http" },
  ];
  const paths = [
    "M315 177H348Q365 177 365 160V123Q365 106 383 106H415",
    "M315 177H348Q365 177 365 194V259Q365 275 383 275H415",
    "M593 106H745",
    "M315 185H334Q349 185 349 207V323Q349 341 370 341H680Q700 341 700 321V295Q700 275 719 275H745",
  ];
  return <div className={`concept-schematic ${preview ? "is-previewing" : ""}`}>
    <div className="schematic-topline"><span><span className="crosshair">+</span> A LOOK BENEATH THE SURFACE</span><span>CONCEPTUAL MAP <span className="small-dot" /></span></div>
    <svg viewBox="0 0 1050 405" fill="none" className="concept-svg" aria-label="Conceptual illustration of URL, DNS, network, certificate and HTTP relationships. No live data.">
      <defs>
        <pattern id="landing-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="var(--svg-grid)" /></pattern>
        <radialGradient id="landing-light"><stop stopColor="var(--accent)" stopOpacity=".065" /><stop offset="1" stopColor="var(--bg)" stopOpacity="0" /></radialGradient>
      </defs>
      <rect x="0" y="0" width="1050" height="405" fill="url(#landing-grid)" opacity=".65" />
      <ellipse cx="275" cy="185" rx="290" ry="230" fill="url(#landing-light)" />
      <path d="M207 117V56M196 64L207 53L218 64" stroke="var(--svg-line)" strokeWidth="1" />
      <text x="207" y="33" textAnchor="middle" className="svg-tiny" fill="var(--svg-muted)">YOUR CURIOSITY STARTS HERE</text>
      {paths.map((d, i) => <g key={d}>
        <path d={d} stroke="var(--svg-line)" strokeWidth="1" strokeDasharray={i === 3 ? "3 5" : undefined} />
        {!reduced && <circle r="2.4" fill="var(--accent)" opacity=".7"><animateMotion dur={`${5 + i}s`} begin={`${i * .8}s`} repeatCount="indefinite" path={d} /></circle>}
      </g>)}
      <text x="656" y="94" textAnchor="middle" className="svg-tiny" fill="var(--svg-muted)">RESOLVES TO</text>
      <text x="531" y="358" textAnchor="middle" className="svg-tiny" fill="var(--svg-muted)">REQUESTS A RESPONSE</text>
      {nodes.map((node, index) => <g key={node.key} className={`concept-node concept-node-${node.key}`}>
        <rect x={node.x} y={node.y} width={node.w} height="63" rx="4" fill={index === 0 ? "var(--node-root)" : "var(--surface)"} stroke={index === 0 ? "var(--accent)" : "var(--svg-line)"} />
        <path d={`M${node.x - 4} ${node.y + 8}V${node.y - 4}H${node.x + 8} M${node.x + node.w - 8} ${node.y + 67}H${node.x + node.w + 4}V${node.y + 55}`} stroke={index === 0 ? "var(--accent-soft)" : "var(--svg-line-strong)"} strokeWidth="1" />
        <text x={node.x + 16} y={node.y + 21} className="svg-tiny" fill="var(--svg-muted)">{node.sub}</text>
        <text x={node.x + 16} y={node.y + 44} fill={index === 0 ? "var(--accent)" : "var(--text)"} className="svg-node-title">{node.title}</text>
        <circle cx={node.x + node.w - 15} cy={node.y + 17} r="2.5" fill={index === 0 ? "var(--accent)" : "var(--unknown)"} />
      </g>)}
      <path d="M926 106H982M975 101L982 106L975 111" stroke="var(--svg-line)" />
      <text x="984" y="88" textAnchor="end" className="svg-tiny" fill="var(--svg-muted)">KEEP GOING</text>
      <text x="38" y="380" className="svg-tiny" fill="var(--svg-muted)">FIG. 01</text><text x="1011" y="380" textAnchor="end" className="svg-tiny" fill="var(--svg-muted)">THERE IS MORE THAN MEETS THE BROWSER.</text>
    </svg>
    <div className="schematic-foot"><span>One address. An entire architecture.</span><span>Real findings appear only after you run an X-ray.</span></div>
  </div>;
}

export function Landing({ onSubmit, error }: { onSubmit: (url: string) => void; error: string | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  const reduced = useReducedMotion();
  return <main id="main-content" className="landing">
    <section className="hero">
      <motion.div initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
        <p className="hero-eyebrow"><span className="line-marker" /> THE INTERNET, UNDER THE SURFACE</p>
        <h1>See what’s<br /><span>behind a URL.</span></h1>
        <p className="hero-description">An address is just the beginning. Explore the DNS, networks,<br className="desktop-break" /> certificates, and technologies that make a website possible.</p>
      </motion.div>
      <motion.div className="hero-input-area" initial={reduced ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65, delay: .12 }}>
        <UrlForm onSubmit={onSubmit} />
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="try-row"><button className="try-example" onClick={() => onSubmit("https://example.com")}>Try example.com <ArrowUpRight size={13} /></button><span className="try-divider" />
          <div className="example-links">{examples.map((example) => <button key={example} onMouseEnter={() => setPreview(example)} onMouseLeave={() => setPreview(null)} onFocus={() => setPreview(example)} onBlur={() => setPreview(null)} onClick={() => onSubmit(`https://${example}`)}>{example}</button>)}</div>
        </div>
        <p id="input-privacy" className="input-privacy">Public URLs only. No sign-in. No saved investigations.</p>
      </motion.div>
    </section>
    <motion.section className="landing-instrument" tabIndex={0} initial={reduced ? false : { opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .85, delay: .2 }} aria-label="Scrollable introduction to the infrastructure map">
      <ConceptSchematic hostname={preview ?? "example.com"} preview={!!preview} />
    </motion.section>
    <section id="how-it-works" className="how-section">
      <div className="how-intro"><span className="eyebrow">A DIFFERENT WAY TO LOOK</span><h2>Less lookup.<br />More understanding.</h2><p>Follow the evidence from the address you can see to the infrastructure you can’t.</p></div>
      <div className="how-steps">
        {[
          { icon: Braces, n: "01", title: "Take it apart.", text: "A URL becomes its individual parts. DNS reveals the names and addresses behind the hostname." },
          { icon: Network, n: "02", title: "Follow the connections.", text: "Watch a living map assemble from public records, HTTP responses, and the network carrying them." },
          { icon: Fingerprint, n: "03", title: "See how we know.", text: "Every finding has evidence. What we observe, what we infer, and what we don’t know stay separate." },
        ].map(({ icon: Icon, n, title, text }) => <div className="how-step" key={n}><div className="step-index"><Icon size={19} strokeWidth={1.3} /><span>{n}</span></div><div><h3>{title}</h3><p>{text}</p></div></div>)}
      </div>
    </section>
    <section className="honesty-line"><Globe2 size={18} strokeWidth={1.2} /><p>Public information. Human understanding.<br /><span>No threat scores. No invented hosting claims. Just the evidence.</span></p><Route size={31} strokeWidth={.9} className="honesty-route" /></section>
  </main>;
}
