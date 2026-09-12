"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUpRight, Check, CircleHelp, Clock3, Fingerprint, Search, Waypoints, Minus } from "lucide-react";
import type { Evidence, Investigation, Layer, NetworkAddress } from "@/lib/types";
import { ConfidenceBadge, Dialog, layerNames, SourceLink } from "./primitives";
import { groupNetworkAddresses } from "@/lib/insights";
import { LayerGlossary } from "./layer-glossary";

function date(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function EvidenceList({ evidence, searchable = false }: { evidence: Evidence[]; searchable?: boolean }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => evidence.filter((item) => `${item.source} ${item.kind} ${item.label} ${item.value}`.toLowerCase().includes(query.toLowerCase())), [evidence, query]);
  return <div className="evidence-list">
    {searchable && <div className="evidence-search"><Search size={16} /><label htmlFor="evidence-search" className="sr-only">Filter evidence</label><input id="evidence-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a record, header, or signal…" /><span>{filtered.length}</span></div>}
    {filtered.length === 0 && <p className="quiet-empty">{query ? "No evidence matches this filter." : "No direct evidence has arrived for this layer."}</p>}
    {filtered.map((item) => <div className="evidence-item" key={item.id}>
      <div className="evidence-label"><span className="record-type">{item.kind}</span><strong>{item.label}</strong><ConfidenceBadge confidence={item.confidence} compact /></div>
      <code className="evidence-value">{item.value}</code>
      {item.explanation && <p>{item.explanation}</p>}
      <div className="evidence-provenance"><span>{item.source} · {date(item.observedAt)} UTC</span>{item.sourceUrl && <SourceLink url={item.sourceUrl} />}</div>
    </div>)}
  </div>;
}

function DefinitionList({ items }: { items: { label: string; value: string; help?: string }[] }) {
  return <dl className="definition-list">{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd><strong>{item.value}</strong>{item.help && <p>{item.help}</p>}</dd></div>)}</dl>;
}

function UrlDetails({ investigation: i }: { investigation: Investigation }) {
  return <><p className="detail-intro">An address is an instruction. Each part tells the browser what to ask for and where to ask.</p>
    <DefinitionList items={[
      { label: "Scheme", value: `${i.url.scheme}://`, help: i.url.scheme === "https" ? "Requests an encrypted connection. The TLS layer checks what was actually observed." : "Requests an unencrypted HTTP connection. A redirect may upgrade it to HTTPS." },
      { label: "Hostname", value: i.url.hostname, help: "The name DNS tries to turn into a network address." },
      { label: "Port", value: i.url.port || (i.url.scheme === "https" ? "443 (default)" : "80 (default)"), help: "Only standard public web ports are allowed." },
      { label: "Path", value: i.url.pathname, help: "The resource being requested. Paths are retained and can themselves contain sensitive data." },
      { label: "Query", value: i.url.hasQuery ? "Removed before requesting" : "Not present", help: "All query parameters are discarded. The response may differ from the original URL." },
      { label: "Fragment", value: i.url.hasFragment ? "Removed" : "Not present", help: "A browser-side reference. It is never sent in an HTTP request." },
    ]} /></>;
}

function DnsDetails({ investigation: i }: { investigation: Investigation }) {
  if (!i.dns) return <UnknownLayer message={i.providers.dns.message ?? "DNS records haven't arrived yet."} />;
  const types = ["A", "AAAA", "CNAME", "NS", "MX", "TXT", "CAA", "HTTPS", "SVCB"];
  return <><p className="detail-intro">DNS looks up records for a hostname. These answers were returned by {i.dns.resolver}. They can vary by resolver, location, and time.</p>
    <div className="dns-record-types">{types.map((type) => <span key={type} className={i.dns!.records.some((r) => r.type === type) ? "has-record" : ""} title={i.dns!.queryStatus[type] ?? "Not queried"}>{type}<small>{i.dns!.records.filter((r) => r.type === type).length || "·"}</small></span>)}</div>
    {i.dns.records.filter((r) => r.type === "CNAME").map((r, index) => <div className="cname-chain" key={`${r.name}-${index}`}><code>{r.name}</code><span><ArrowDown size={15} />CNAME</span><code>{r.value}</code></div>)}
    <details className="raw-details"><summary>Inspect DNS records <span>{i.dns.records.length} answers</span></summary><div className="table-scroll"><table><thead><tr><th>Type</th><th>Name / value</th><th>TTL</th></tr></thead><tbody>{i.dns.records.map((record, n) => <tr key={`${record.type}-${n}`}><td><span className="record-type">{record.type}</span></td><td><small>{record.name}</small><code>{record.value}</code></td><td>{record.ttl}s</td></tr>)}</tbody></table></div></details>
    <details className="raw-details"><summary>Query availability</summary><DefinitionList items={Object.entries(i.dns.queryStatus).map(([label, value]) => ({ label, value }))} /></details>
    <p className="scope-note">Cloudflare as a DNS resolver or authoritative nameserver does not establish that a website uses Cloudflare’s edge network.</p>
  </>;
}

export function RedirectDetails({ investigation: i }: { investigation: Investigation }) {
  if (!i.http?.hops.length) return <UnknownLayer message={i.http?.stoppedReason || i.providers.http.message || "The HTTP response hasn't arrived yet."} />;
  return <><p className="detail-intro">{i.http.chainComplete ? i.http.redirectCount ? `The request followed ${i.http.redirectCount} ${i.http.redirectCount === 1 ? "redirect" : "redirects"} before reaching this response.` : "No redirect chain detected in this HTTP observation." : "Only part of the redirect chain could be observed."}</p>
    <div className="redirect-chain">{i.http.hops.map((hop, n) => <div className="redirect-hop" key={`${hop.url}-${n}`}><div className="redirect-track"><span className={`http-status ${hop.status >= 400 ? "status-warning" : ""}`}>{hop.status}</span>{n < i.http!.hops.length - 1 && <div className="redirect-line"><ArrowDown size={14} /></div>}</div><div className="hop-content"><code>{hop.url}</code><span>{n === 0 ? "Initial request" : `Hop ${n}`} · {Math.round(hop.durationMs)} ms{hop.address ? ` · ${hop.address}` : ""}</span>{hop.location && <small>Redirect to {hop.location}</small>}<details className="hop-headers"><summary>Response headers</summary><div className="header-values">{Object.entries(hop.headers).map(([key, value]) => <div key={key}><strong>{key}</strong><code>{value}</code></div>)}</div></details></div></div>)}</div>
    {i.http.stoppedReason && <p className="scope-note">{i.http.stoppedReason}</p>}
    <h3 className="detail-heading">What the headers tell us</h3>
    <div className="header-signals">{i.http.headerSignals.map((signal) => <div key={signal.name}><span className={`header-signal-icon ${signal.state}`}>{signal.state === "present" ? <Check size={15} /> : signal.state === "unknown" ? <CircleHelp size={15} /> : <Minus size={15} />}</span><div><strong>{signal.title}</strong><span>{signal.state === "present" ? "Observed" : signal.state === "absent" ? "Not observed" : "Unknown"}</span><p>{signal.explanation}</p>{signal.value && <code>{signal.value}</code>}</div></div>)}</div>
    <p className="scope-note">Header presence alone does not establish that a site is secure or unsafe. This is one server-side GET, without cookies, JavaScript, or subresource requests.</p>
  </>;
}

function TlsDetails({ investigation: i }: { investigation: Investigation }) {
  if (!i.tls) return <UnknownLayer message={i.providers.tls.message ?? "TLS information couldn't be retrieved yet."} />;
  const tls = i.tls;
  const start = new Date(tls.validFrom).getTime(), end = new Date(tls.validTo).getTime(), now = new Date(i.startedAt).getTime();
  const progress = Math.max(0, Math.min(100, (now - start) / (end - start) * 100));
  return <><div className="certificate-intro"><Fingerprint size={36} strokeWidth={1} /><div><span className="eyebrow">IDENTITY, PRESENTED</span><h3>{tls.subject || tls.hostname}</h3><p>{tls.authorized ? "The certificate passed this observer’s TLS validation." : "The certificate did not pass this observer’s TLS validation."}</p></div></div>
    <DefinitionList items={[
      { label: "Endpoint", value: tls.hostname, help: "A separate handshake to the original hostname, not necessarily the redirect destination." },
      { label: "Issuer", value: tls.issuer || "Unknown" },
      { label: "Protocol", value: tls.protocol || "Unknown" },
      { label: "Valid from", value: date(tls.validFrom) },
      { label: "Valid until", value: date(tls.validTo) },
    ]} />
    {Number.isFinite(progress) && <div className="certificate-timeline"><div><i style={{ width: `${progress}%` }} /><span style={{ left: `${progress}%` }} /></div><p><span>{date(tls.validFrom)}</span><span>Observation</span><span>{date(tls.validTo)}</span></p></div>}
    {tls.authorizationError && <p className="scope-note">Validation: {tls.authorizationError}</p>}
    <h3 className="detail-heading">Also on this certificate <span>{tls.sans.length}</span></h3><div className="san-list">{tls.sans.map((san) => <code key={san}>{san}</code>)}</div>
    <p className="scope-note">Certificate names are identity claims, not proof these hostnames share an origin server.</p>
    {tls.chain.length > 0 && <details className="raw-details"><summary>Inspect certificate chain <span>{tls.chain.length} certificates</span></summary><div className="certificate-chain">{tls.chain.map((cert, n) => <div key={`${cert.subject}-${n}`}><span className="chain-number">0{n + 1}</span><div><strong>{cert.subject}</strong><p>Issued by {cert.issuer}</p><small>Valid until {date(cert.validTo)}</small></div></div>)}</div></details>}
    <details className="raw-details"><summary>SHA-256 fingerprint</summary><code className="evidence-value">{tls.fingerprint256 || "Unavailable"}</code></details>
  </>;
}

export function NetworkDetails({ investigation: i }: { investigation: Investigation }) {
  const addresses: NetworkAddress[] = i.network?.addresses ?? i.dns?.addresses.map((ip) => ({ ip, version: ip.includes(":") ? 6 as const : 4 as const, source: "DNS observation" })) ?? [];
  const groups = groupNetworkAddresses(addresses);
  return <><p className="detail-intro">Addresses with the same autonomous system number (ASN) are grouped by their announcing network. The website’s origin host can be different.</p>
    {addresses.length === 0 && <UnknownLayer message={i.providers.network.message ?? "No publicly routable addresses were available to explore."} />}
    <div className="network-addresses">{groups.map((group) => <section className="network-group" key={group.id}><header className="network-group-heading"><h3>{group.asn || "Network not identified"}</h3><p>{group.organizations.join(", ")}{group.organizations.length ? " · " : ""}{group.addresses.length} {group.addresses.length === 1 ? "address" : "addresses"}</p></header>{group.addresses.map((address) => <details className="network-address" key={address.ip} open={addresses.length === 1}><summary><span className="record-type">IPv{address.version}</span><code>{address.ip}</code><ArrowUpRight size={15} /></summary><DefinitionList items={[
      { label: "ASN", value: address.asn ?? "Unknown" },
      { label: "Organization", value: address.organization ?? "Unknown", help: "The organization reported for this network by the data source." },
      { label: "Network prefix", value: address.prefix ?? "Unknown" },
      { label: "Registry country", value: address.country ?? "Unknown", help: "Registration metadata, not the physical location of the server or edge." },
      { label: "Reverse DNS", value: address.ptr?.length ? address.ptr.join(", ") : "Not available" },
    ]} /><div className="evidence-provenance"><span>{address.source}</span>{address.sourceUrl && <SourceLink url={address.sourceUrl} />}</div></details>)}</section>)}</div>
    {i.network?.limited && <p className="scope-note">Network enrichment is deliberately bounded. Additional DNS addresses may not have been enriched.</p>}
  </>;
}

function TechnologyDetails({ investigation: i, infrastructure = false }: { investigation: Investigation; infrastructure?: boolean }) {
  const signals = infrastructure ? i.technology?.infrastructure : i.technology?.technologies;
  return <><p className="detail-intro">{infrastructure ? "These platform suggestions come from response signals. Expand one to explore the evidence behind it." : "Explore recognizable technology signals in the response headers and HTML."}</p>
    {!signals?.length && <UnknownLayer message={infrastructure ? "The collected evidence doesn't support naming an edge or hosting provider." : "No supported technology signatures were observed. This does not mean the page uses no frameworks."} />}
    {signals?.map((signal) => <div className="technology-detail" key={signal.name}><div><h3>{signal.name}</h3><ConfidenceBadge confidence={signal.confidence} /></div>{"category" in signal && <span className="technology-category">{signal.category}</span>}<p>{signal.explanation}</p><details className="raw-details"><summary>Why do you think this?</summary><EvidenceList evidence={i.evidence.filter((e) => signal.evidenceIds.includes(e.id))} /></details></div>)}
    {!infrastructure && i.technology && <p className="scope-note">Inspected {Math.round(i.technology.analyzedBytes / 1024)} KB of the final response. {i.technology.truncated ? "The response was capped; more signals may exist beyond this limit." : "No scripts were executed and no linked assets were fetched."}</p>}
  </>;
}

export function UnknownLayer({ message }: { message: string }) {
  return <div className="unknown-layer"><CircleHelp size={23} strokeWidth={1.2} /><div><ConfidenceBadge confidence="unknown" /><p>{message}</p></div></div>;
}

export function HistoryEmpty() {
  return <div className="history-empty"><Clock3 size={25} strokeWidth={1.1} /><div><span className="eyebrow">TIME IS ANOTHER LAYER</span><h3>No historical observations yet.</h3><p>Export this observation to keep a record. Re-run the URL whenever you want a fresh look.</p></div></div>;
}

export function LayerContent({ investigation, layer }: { investigation: Investigation; layer: Layer }) {
  if (layer === "url") return <UrlDetails investigation={investigation} />;
  if (layer === "dns") return <DnsDetails investigation={investigation} />;
  if (layer === "http") return <RedirectDetails investigation={investigation} />;
  if (layer === "tls") return <TlsDetails investigation={investigation} />;
  if (layer === "network") return <NetworkDetails investigation={investigation} />;
  if (layer === "technology" || layer === "infrastructure") return <TechnologyDetails investigation={investigation} infrastructure={layer === "infrastructure"} />;
  return <HistoryEmpty />;
}

export function LayerDrawer({ investigation, layer, onClose, onLayerChange }: { investigation: Investigation; layer: Layer | null; onClose: () => void; onLayerChange: (layer: Layer) => void }) {
  return <Dialog open={!!layer} onClose={onClose} title={layer ? layerNames[layer] : "Inspect a layer"} eyebrow="BENEATH THE SURFACE" wide>
    <div className="layer-switcher">{(["url", "dns", "http", "tls", "network", "infrastructure", "technology"] as Layer[]).map((l) => <button aria-pressed={layer === l} key={l} onClick={() => onLayerChange(l)}>{l === "infrastructure" ? "Edge" : l === "technology" ? "Tech" : l.toUpperCase()}</button>)}</div>
    {layer && <div key={layer} className="layer-content"><LayerGlossary layer={layer} /><LayerContent investigation={investigation} layer={layer} />
      {layer !== "history" && <details className="raw-details layer-evidence"><summary><span><Waypoints size={15} />All evidence for this layer</span><span>{investigation.evidence.filter((e) => e.source === layer || (layer === "infrastructure" && e.source === "technology")).length} items</span></summary><EvidenceList evidence={investigation.evidence.filter((e) => e.source === layer || (layer === "infrastructure" && e.source === "technology"))} /></details>}
    </div>}
  </Dialog>;
}
