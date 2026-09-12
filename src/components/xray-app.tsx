"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, MotionConfig, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Braces, CircleHelp, Globe2, LoaderCircle, Moon, ScanLine, Sun } from "lucide-react";
import { useInvestigation } from "@/lib/client/use-investigation";
import { Landing } from "./landing";
import { Workbench } from "./workbench";
import { ConfidenceBadge, Dialog, XRayMark } from "./primitives";

export function XRayApp({ initialHostname }: { initialHostname?: string }) {
  const { investigation, running, error, run, cancel, reset } = useInvestigation();
  const [methodology, setMethodology] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [sharedEntry, setSharedEntry] = useState(!!initialHostname);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const reduced = useReducedMotion();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  const start = useCallback((url: string) => {
    setSharedEntry(false);
    void run(url);
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [run]);
  const home = () => { reset(); setSharedEntry(false); window.scrollTo({ top: 0, behavior: "instant" }); };
  return <MotionConfig reducedMotion="user"><div className={`app-shell ${investigation ? "has-investigation" : ""}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header">
      <button className="brand" onClick={home} aria-label="URL X-Ray home"><XRayMark /><span>URL X-RAY</span><span className="brand-divider" /><small>INTERNET OBSERVATORY</small></button>
      <nav aria-label="Main navigation">
        <button onClick={() => setMethodology(true)}>How it works<ArrowUpRight size={14} /></button>
        <button onClick={() => setPrivacy(true)} className="header-privacy">Our boundaries<ArrowUpRight size={14} /></button>
        <button className="theme-toggle" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} aria-pressed={theme === "dark"} onClick={() => setTheme((current) => current === "light" ? "dark" : "light")}>
          {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === "light" ? "Dark" : "Light"}</span>
        </button>
        <span className="private-build"><span />PRIVATE ALPHA</span>
      </nav>
    </header>
    {investigation ? <Workbench key={investigation.id} investigation={investigation} running={running} error={error} onRun={start} onCancel={cancel} onHome={home} onMethodology={() => setMethodology(true)} /> : running ? <main id="main-content" className="opening-instrument"><motion.div initial={reduced ? false : { opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }}><div className="opening-mark"><XRayMark /><span /></div><span className="eyebrow">OPENING THE INSTRUMENT</span><h1>Every URL has a story.</h1><p><LoaderCircle size={15} className="spin" />Parsing the address and checking the public boundary.</p><button className="text-button" onClick={cancel}>Cancel investigation</button></motion.div></main> : sharedEntry && initialHostname ? <main className="shared-entry" id="main-content"><span className="eyebrow">A SHARED STARTING POINT</span><Globe2 size={40} strokeWidth={1} /><h1>{initialHostname}</h1><p>Put this hostname under the X-ray. This starts a fresh observation of public infrastructure, not a saved result.</p><button className="primary-button" onClick={() => start(`https://${initialHostname}`)}><ScanLine size={16} />X-ray this hostname<ArrowRight size={17} /></button><button className="text-button" onClick={home}><ArrowLeft size={13} />Start somewhere else</button></main> : <Landing onSubmit={start} error={error} />}
    <footer className="site-footer"><div><XRayMark /><span>Every URL has a story.</span></div><p>Publicly observable. Never all-knowing.</p><button onClick={() => setPrivacy(true)}>Privacy & scope<ArrowUpRight size={12} /></button></footer>
    <Dialog open={methodology} onClose={() => setMethodology(false)} title="Understand the invisible." eyebrow="HOW THE INSTRUMENT WORKS" wide><p className="detail-intro">URL X-Ray turns a URL into a map of its publicly observable infrastructure. Real evidence arrives independently, and the explanation grows with it.</p><div className="method-steps">{[
      { number: "01", title: "An address, taken apart", text: "We parse the scheme, hostname, port, and path. Query values and fragments are removed before the target is requested." },
      { number: "02", title: "Independent observations", text: "Public DNS queries reveal records. A bounded HTTP request follows permitted redirects. A separate TLS handshake inspects the original hostname. Public network sources add ASN context." },
      { number: "03", title: "A map, with receipts", text: "Relationships connect the evidence. Rules identify supported technology signatures and possible edge providers. Every inferred finding links back to the signals behind it." },
    ].map((step) => <div key={step.number}><span>{step.number}</span><div><h3>{step.title}</h3><p>{step.text}</p></div></div>)}</div><div className="confidence-explanations"><div><ConfidenceBadge confidence="observed" /><p>Directly obtained from a response or public data source at the time shown.</p></div><div><ConfidenceBadge confidence="inferred" /><p>An interpretation suggested by the evidence, not an independently verified fact.</p></div><div><ConfidenceBadge confidence="unknown" /><p>Not enough evidence to make a claim. This is a useful answer, too.</p></div></div><p className="scope-note"><CircleHelp size={16} />The graph is not a traceroute. A CDN can hide an origin, an ASN does not prove hosting, and a registry country does not locate a server. The interface does not fill in these gaps.</p></Dialog>
    <Dialog open={privacy} onClose={() => setPrivacy(false)} title="Curiosity has boundaries." eyebrow="PRIVACY & SCOPE" wide><p className="detail-intro">URL X-Ray analyzes publicly observable information. It does not attempt to access private systems or bypass security controls.</p><div className="privacy-sections"><section><h3>What leaves this machine</h3><p>The hostname is sent to Cloudflare’s public DNS-over-HTTPS resolver. The target receives a normal, bounded HTTP GET and, for HTTPS, a TLS handshake. Public network-data providers receive observed IP addresses. Those services may log requests.</p></section><section><h3>What we don’t keep</h3><p>There are no accounts, analytics, saved investigations, or URL history. Query values and fragments are discarded before target requests. The path is retained and may contain sensitive information, so inspect only URLs you are comfortable sending to the target.</p></section><section><h3>What we won’t do</h3><p>No private or loopback addresses, nonstandard ports, credentials, cookies, authentication bypass, port scans, JavaScript execution, or subresource crawling. Every redirect is checked again before connecting.</p></section><section><h3>A smaller, honest view</h3><p>Query removal, the observer’s location, TLS trust store, response limits, or blocked requests can change what we see. An incomplete layer stays incomplete. A missing header is not a verdict on a site.</p></section><section><h3>No hidden deeper scan</h3><p>There is no urlscan.io submission or third-party screenshot scan. Hostname links start a new investigation only when you ask. Local exports may contain URL paths and public metadata; review them before sharing.</p></section></div><div className="privacy-end"><Braces size={17} /><p>Private alpha. Bound to localhost. Not deployed publicly.</p></div></Dialog>
  </div></MotionConfig>;
}
