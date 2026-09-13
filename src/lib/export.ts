import type {
  Confidence,
  Evidence,
  Finding,
  GraphEdge,
  GraphNode,
  InfrastructureGraph,
  Investigation,
  ProviderId,
} from "./types";
import {
  buildInfrastructureGraph,
  confidenceLabel,
  interpretInvestigation,
  layerDisplay,
  statusLabel,
} from "./interpretation";

const BRAND = "URL X-RAY";

const SCOPE_LIMITATIONS = [
  "One investigation from one network vantage point at one moment. Answers can differ from another resolver, another region or a later run.",
  "JavaScript was not executed and no subresources were fetched, so anything added to the page at runtime is not visible in this report.",
  "No lookup history is saved or compared. There is no earlier run to diff against.",
  "No port scan, no traceroute and no path measurement. The graph is a map of relationships, not a network path and not a time sequence.",
  "Registry country is administrative data about the address block holder. It is not a measurement of where the responding server is, and no geographic location is claimed.",
  "Authoritative DNS operators answer the name. That does not establish who terminates the HTTP connection or serves the content.",
  "Address registration identifies the network that holds and announces the address block. It does not establish who owns or operates the site, nor that an origin runs on that provider.",
  "Unknown means not determined by this run. It never means absent.",
  "Header observations are configuration facts about one response. They are not a security assessment and not a privacy assessment.",
];

const NOT_COLLECTED = [
  "Query parameter values from the submitted URL.",
  "Response bodies beyond the analysed byte budget.",
  "Any data from a third party feed other than the sources named on the evidence rows.",
];

const XML_UNSAFE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function toText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function sanitizeText(value: unknown, max = 2048): string {
  const text = toText(value).replace(XML_UNSAFE, " ").replace(LONE_SURROGATE, "");
  const collapsed = text.replace(/[\r\n\t]+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, Math.max(0, max - 3))}...` : collapsed;
}

export function escapeXml(value: unknown, max = 2048): string {
  return sanitizeText(value, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function clip(value: unknown, max: number): string {
  const text = sanitizeText(value, max + 8);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

function safeSourceUrl(value: unknown): string | undefined {
  const text = sanitizeText(value, 512);
  return /^https?:\/\/[^\s]+$/i.test(text) ? text : undefined;
}

export interface EvidenceCounts {
  total: number;
  bySource: Record<string, number>;
  byConfidence: Record<Confidence, number>;
}

export function countEvidence(investigation: Investigation): EvidenceCounts {
  const bySource: Record<string, number> = {};
  const byConfidence: Record<Confidence, number> = { observed: 0, inferred: 0, unknown: 0 };
  const rows = investigation.evidence ?? [];
  for (const row of rows) {
    const source = sanitizeText(row.source, 24) || "unknown";
    bySource[source] = (bySource[source] ?? 0) + 1;
    if (row.confidence === "observed" || row.confidence === "inferred" || row.confidence === "unknown") {
      byConfidence[row.confidence] += 1;
    }
  }
  return { total: rows.length, bySource, byConfidence };
}

function sanitizeEvidence(row: Evidence) {
  const sourceUrl = safeSourceUrl(row.sourceUrl);
  return {
    id: sanitizeText(row.id, 128),
    source: sanitizeText(row.source, 24),
    kind: sanitizeText(row.kind, 64),
    label: sanitizeText(row.label, 256),
    value: sanitizeText(row.value, 1024),
    confidence: row.confidence,
    observedAt: sanitizeText(row.observedAt, 64),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(row.explanation ? { explanation: sanitizeText(row.explanation, 1024) } : {}),
  };
}

export function sanitizeInvestigation(investigation: Investigation) {
  const url = investigation.url;
  const providers: Record<string, { status: string; reason?: string; message?: string; durationMs?: number }> = {};
  for (const key of Object.keys(investigation.providers ?? {})) {
    const state = investigation.providers[key as ProviderId];
    if (!state) continue;
    providers[sanitizeText(key, 24)] = {
      status: state.status,
      ...(state.reason ? { reason: state.reason } : {}),
      ...(state.message ? { message: sanitizeText(state.message, 512) } : {}),
      ...(typeof state.durationMs === "number" ? { durationMs: state.durationMs } : {}),
    };
  }

  return {
    id: sanitizeText(investigation.id, 128),
    edition: investigation.edition ?? "local",
    startedAt: sanitizeText(investigation.startedAt, 64),
    ...(investigation.finishedAt ? { finishedAt: sanitizeText(investigation.finishedAt, 64) } : {}),
    url: url
      ? {
          href: sanitizeText(url.href, 1024),
          hostname: sanitizeText(url.hostname, 256),
          scheme: url.scheme,
          port: sanitizeText(url.port, 8),
          pathname: sanitizeText(url.pathname, 512),
          queryKeys: (url.queryKeys ?? []).slice(0, 40).map((key) => sanitizeText(key, 64)),
          hasQuery: Boolean(url.hasQuery),
          hasFragment: Boolean(url.hasFragment),
          display: sanitizeText(url.display, 512),
        }
      : undefined,
    providers,
    ...(investigation.dns
      ? {
          dns: {
            resolver: sanitizeText(investigation.dns.resolver, 128),
            addresses: (investigation.dns.addresses ?? []).slice(0, 64).map((a) => sanitizeText(a, 64)),
            records: (investigation.dns.records ?? []).slice(0, 200).map((record) => ({
              type: sanitizeText(record.type, 16),
              name: sanitizeText(record.name, 256),
              value: sanitizeText(record.value, 512),
              ttl: record.ttl,
            })),
            queryStatus: Object.fromEntries(
              Object.entries(investigation.dns.queryStatus ?? {})
                .slice(0, 32)
                .map(([key, value]) => [sanitizeText(key, 16), sanitizeText(value, 64)]),
            ),
          },
        }
      : {}),
    ...(investigation.http
      ? {
          http: {
            finalUrl: sanitizeText(investigation.http.finalUrl, 1024),
            finalStatus: investigation.http.finalStatus,
            redirectCount: investigation.http.redirectCount,
            chainComplete: investigation.http.chainComplete,
            ...(investigation.http.stoppedReason
              ? { stoppedReason: sanitizeText(investigation.http.stoppedReason, 256) }
              : {}),
            durationMs: investigation.http.durationMs,
            hops: (investigation.http.hops ?? []).slice(0, 20).map((hop) => ({
              url: sanitizeText(hop.url, 1024),
              status: hop.status,
              ...(hop.location ? { location: sanitizeText(hop.location, 1024) } : {}),
              ...(hop.address ? { address: sanitizeText(hop.address, 64) } : {}),
              durationMs: hop.durationMs,
              headers: Object.fromEntries(
                Object.entries(hop.headers ?? {})
                  .slice(0, 60)
                  .map(([key, value]) => [sanitizeText(key, 64), sanitizeText(value, 512)]),
              ),
            })),
            headerSignals: (investigation.http.headerSignals ?? []).slice(0, 40).map((signal) => ({
              name: sanitizeText(signal.name, 64),
              title: sanitizeText(signal.title, 128),
              state: signal.state,
              explanation: sanitizeText(signal.explanation, 512),
              ...(signal.value ? { value: sanitizeText(signal.value, 512) } : {}),
            })),
          },
        }
      : {}),
    ...(investigation.tls
      ? {
          tls: {
            hostname: sanitizeText(investigation.tls.hostname, 256),
            issuer: sanitizeText(investigation.tls.issuer, 512),
            subject: sanitizeText(investigation.tls.subject, 512),
            sans: (investigation.tls.sans ?? []).slice(0, 100).map((san) => sanitizeText(san, 256)),
            validFrom: sanitizeText(investigation.tls.validFrom, 64),
            validTo: sanitizeText(investigation.tls.validTo, 64),
            protocol: sanitizeText(investigation.tls.protocol, 32),
            fingerprint256: sanitizeText(investigation.tls.fingerprint256, 128),
            authorized: Boolean(investigation.tls.authorized),
            ...(investigation.tls.authorizationError
              ? { authorizationError: sanitizeText(investigation.tls.authorizationError, 256) }
              : {}),
            chain: (investigation.tls.chain ?? []).slice(0, 10).map((link) => ({
              subject: sanitizeText(link.subject, 512),
              issuer: sanitizeText(link.issuer, 512),
              validTo: sanitizeText(link.validTo, 64),
            })),
          },
        }
      : {}),
    ...(investigation.network
      ? {
          network: {
            limited: Boolean(investigation.network.limited),
            addresses: (investigation.network.addresses ?? []).slice(0, 32).map((address) => {
              const sourceUrl = safeSourceUrl(address.sourceUrl);
              return {
                ip: sanitizeText(address.ip, 64),
                version: address.version,
                ...(address.asn ? { asn: sanitizeText(address.asn, 32) } : {}),
                ...(address.organization
                  ? { organization: sanitizeText(address.organization, 256) }
                  : {}),
                ...(address.prefix ? { prefix: sanitizeText(address.prefix, 64) } : {}),
                ...(address.country ? { registryCountry: sanitizeText(address.country, 8) } : {}),
                ...(address.ptr
                  ? { ptr: address.ptr.slice(0, 8).map((name) => sanitizeText(name, 256)) }
                  : {}),
                source: sanitizeText(address.source, 128),
                ...(sourceUrl ? { sourceUrl } : {}),
              };
            }),
          },
        }
      : {}),
    ...(investigation.technology
      ? {
          technology: {
            analyzedBytes: investigation.technology.analyzedBytes,
            truncated: Boolean(investigation.technology.truncated),
            javascriptExecuted: false,
            technologies: (investigation.technology.technologies ?? []).slice(0, 60).map((item) => ({
              name: sanitizeText(item.name, 128),
              category: item.category,
              confidence: item.confidence,
              evidenceIds: (item.evidenceIds ?? []).slice(0, 20).map((id) => sanitizeText(id, 128)),
              explanation: sanitizeText(item.explanation, 512),
            })),
            infrastructure: (investigation.technology.infrastructure ?? [])
              .slice(0, 20)
              .map((guess) => ({
                name: sanitizeText(guess.name, 128),
                confidence: guess.confidence,
                evidenceIds: (guess.evidenceIds ?? []).slice(0, 20).map((id) => sanitizeText(id, 128)),
                explanation: sanitizeText(guess.explanation, 512),
              })),
          },
        }
      : {}),
    evidence: (investigation.evidence ?? []).slice(0, 500).map(sanitizeEvidence),
  };
}

export function createReportJson(investigation: Investigation): string {
  const findings = interpretInvestigation(investigation);
  const graph = buildInfrastructureGraph(investigation);
  const counts = countEvidence(investigation);
  const report = {
    tool: BRAND,
    schemaVersion: 1,
    generatedAt: sanitizeText(investigation.finishedAt ?? investigation.startedAt, 64),
    reportKind: "single-investigation-snapshot",
    investigation: sanitizeInvestigation(investigation),
    findings: findings.map((finding) => ({
      id: finding.id,
      layer: finding.layer,
      title: sanitizeText(finding.title, 256),
      description: sanitizeText(finding.description, 4096),
      confidence: finding.confidence,
      evidenceIds: finding.evidenceIds,
    })),
    graph: {
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        layer: node.layer,
        eyebrow: node.eyebrow,
        label: sanitizeText(node.label, 256),
        detail: sanitizeText(node.detail, 256),
        confidence: node.confidence,
        status: node.status,
        evidenceIds: node.evidenceIds,
      })),
      edges: graph.edges.map((edge) => ({ ...edge })),
      note: "Edges are semantic relationships between observed facts. The graph is not a network path and not a time sequence.",
    },
    evidenceCounts: counts,
    scope: {
      limitations: investigation.edition === "browser" ? ["Browser edition: only public DNS and network sources were queried. No HTTP request or TLS handshake was made to the website.", ...SCOPE_LIMITATIONS] : SCOPE_LIMITATIONS,
      notCollected: investigation.edition === "browser" ? ["TLS certificates, HTTP responses, redirects, headers and response technology markers. Run the local app to collect these.", ...NOT_COLLECTED] : NOT_COLLECTED,
      confidenceMeaning: {
        observed: "Measured or returned by a named source during this run.",
        inferred: "Suggested by evidence in this run, stated as a guess and not a confirmation.",
        unknown: "Not determined by this run. Not a claim of absence.",
      },
    },
  };
  return JSON.stringify(report, null, 2);
}

const COLORS = {
  background: "#0b0b0c",
  panel: "#101113",
  panelEdge: "#1e2023",
  hair: "#17181a",
  text: "#f2f3ef",
  muted: "#8b8f8a",
  faint: "#5e625f",
  accent: "#e4eea2",
  inferred: "#9aa867",
  unknown: "#45484b",
};

const MONO = "'IBM Plex Mono','SFMono-Regular',Menlo,Consolas,'Liberation Mono',monospace";
const SANS = "'Instrument Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

const CANVAS = { width: 1440, height: 1000 };
const NODE = { width: 178, height: 66 };

const NODE_POSITIONS: Record<string, { cx: number; cy: number }> = {
  url: { cx: 152, cy: 470 },
  dns: { cx: 404, cy: 252 },
  http: { cx: 404, cy: 470 },
  tls: { cx: 404, cy: 688 },
  ip: { cx: 656, cy: 252 },
  technology: { cx: 656, cy: 470 },
  network: { cx: 908, cy: 252 },
  infrastructure: { cx: 908, cy: 620 },
};

function confidenceColor(confidence: Confidence): string {
  if (confidence === "observed") return COLORS.accent;
  if (confidence === "inferred") return COLORS.inferred;
  return COLORS.unknown;
}

function text(
  content: unknown,
  x: number,
  y: number,
  options: {
    size?: number;
    fill?: string;
    family?: string;
    weight?: number | string;
    spacing?: number;
    anchor?: "start" | "middle" | "end";
    max?: number;
    opacity?: number;
  } = {},
): string {
  const value = escapeXml(clip(content, options.max ?? 200));
  if (!value) return "";
  const parts = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${options.family ?? SANS}"`,
    `font-size="${options.size ?? 12}"`,
    `fill="${options.fill ?? COLORS.text}"`,
  ];
  if (options.weight) parts.push(`font-weight="${options.weight}"`);
  if (options.spacing) parts.push(`letter-spacing="${options.spacing}"`);
  if (options.anchor) parts.push(`text-anchor="${options.anchor}"`);
  if (options.opacity !== undefined) parts.push(`opacity="${options.opacity}"`);
  return `<text ${parts.join(" ")}>${value}</text>`;
}

function panel(x: number, y: number, width: number, height: number): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="2" fill="${COLORS.panel}" stroke="${COLORS.panelEdge}" stroke-width="1"/>`;
}

function hairline(x1: number, y1: number, x2: number, y2: number, color = COLORS.panelEdge): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1"/>`;
}

function anchorPoints(from: { cx: number; cy: number }, to: { cx: number; cy: number }) {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  if (Math.abs(dx) >= 120) {
    const sign = dx > 0 ? 1 : -1;
    return {
      x1: from.cx + (sign * NODE.width) / 2,
      y1: from.cy,
      x2: to.cx - (sign * NODE.width) / 2,
      y2: to.cy,
    };
  }
  const sign = dy > 0 ? 1 : -1;
  return {
    x1: from.cx,
    y1: from.cy + (sign * NODE.height) / 2,
    x2: to.cx,
    y2: to.cy - (sign * NODE.height) / 2,
  };
}

function renderEdge(edge: GraphEdge): string {
  const from = NODE_POSITIONS[edge.from];
  const to = NODE_POSITIONS[edge.to];
  if (!from || !to) return "";
  const { x1, y1, x2, y2 } = anchorPoints(from, to);
  const inference = edge.kind === "inference";
  const stroke = inference ? COLORS.inferred : COLORS.faint;
  const dash = inference ? ` stroke-dasharray="2 5"` : edge.kind === "relationship" ? ` stroke-dasharray="7 4"` : "";
  const marker = inference ? "arrow-inferred" : "arrow-observed";
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const label = clip(edge.label, 22);
  const labelWidth = label.length * 5.6 + 12;
  return [
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="1"${dash} marker-end="url(#${marker})"/>`,
    `<rect x="${midX - labelWidth / 2}" y="${midY - 9}" width="${labelWidth}" height="16" rx="2" fill="${COLORS.background}" stroke="${COLORS.panelEdge}" stroke-width="0.5"/>`,
    text(label, midX, midY + 3, {
      size: 9,
      family: MONO,
      fill: inference ? COLORS.inferred : COLORS.muted,
      anchor: "middle",
      spacing: 0.4,
    }),
  ].join("");
}

function renderNode(node: GraphNode): string {
  const position = NODE_POSITIONS[node.id];
  if (!position) return "";
  const x = position.cx - NODE.width / 2;
  const y = position.cy - NODE.height / 2;
  const accent = confidenceColor(node.confidence);
  const dashed = node.confidence === "unknown" ? ` stroke-dasharray="3 3"` : "";
  return [
    `<rect x="${x}" y="${y}" width="${NODE.width}" height="${NODE.height}" rx="2" fill="${COLORS.panel}" stroke="${accent}" stroke-opacity="${node.confidence === "observed" ? 0.75 : 0.55}" stroke-width="1"${dashed}/>`,
    `<rect x="${x}" y="${y}" width="3" height="${NODE.height}" fill="${accent}" fill-opacity="${node.confidence === "unknown" ? 0.4 : 0.9}"/>`,
    text(node.eyebrow, x + 14, y + 19, {
      size: 8.5,
      family: MONO,
      fill: COLORS.muted,
      spacing: 1.6,
      max: 22,
    }),
    text(node.label, x + 14, y + 38, {
      size: 14,
      family: MONO,
      fill: node.confidence === "unknown" ? COLORS.muted : COLORS.text,
      max: 22,
    }),
    text(node.detail, x + 14, y + 54, { size: 9.5, family: MONO, fill: COLORS.faint, max: 30 }),
    text(confidenceLabel(node.confidence).toUpperCase(), x + NODE.width - 12, y + 19, {
      size: 8,
      family: MONO,
      fill: accent,
      spacing: 1,
      anchor: "end",
      opacity: 0.85,
      max: 10,
    }),
  ].join("");
}

function legendRow(x: number, y: number, color: string, label: string, note: string, dashed: boolean): string {
  return [
    `<line x1="${x}" y1="${y}" x2="${x + 26}" y2="${y}" stroke="${color}" stroke-width="1.5"${dashed ? ` stroke-dasharray="3 3"` : ""}/>`,
    text(label, x + 36, y + 4, { size: 10.5, family: MONO, fill: COLORS.text, max: 12 }),
    text(note, x + 104, y + 4, { size: 9.5, fill: COLORS.faint, max: 40 }),
  ].join("");
}

function renderRail(investigation: Investigation, findings: Finding[], graph: InfrastructureGraph): string {
  const railX = 1024;
  const railWidth = 360;
  const counts = countEvidence(investigation);
  const out: string[] = [];

  out.push(panel(railX, 176, railWidth, 214));
  out.push(text("EVIDENCE", railX + 18, 202, { size: 9, family: MONO, fill: COLORS.muted, spacing: 2 }));
  out.push(
    text(String(counts.total), railX + 18, 240, { size: 30, family: MONO, fill: COLORS.accent }),
  );
  out.push(text("rows recorded", railX + 78, 240, { size: 10, fill: COLORS.faint, max: 24 }));
  out.push(hairline(railX + 18, 254, railX + railWidth - 18, 254));

  const sources: ProviderId[] = ["dns", "http", "tls", "network", "technology"];
  sources.forEach((source, index) => {
    const y = 276 + index * 21;
    const value = counts.bySource[source] ?? 0;
    out.push(
      text(source.toUpperCase(), railX + 18, y, {
        size: 10,
        family: MONO,
        fill: COLORS.muted,
        spacing: 1.2,
        max: 14,
      }),
    );
    out.push(
      text(investigation.providers?.[source]?.reason === "local-only" ? "Local app" : statusLabel(investigation.providers?.[source]?.status ?? "pending"), railX + 108, y, {
        size: 9.5,
        fill: COLORS.faint,
        max: 18,
      }),
    );
    out.push(
      text(String(value), railX + railWidth - 18, y, {
        size: 11,
        family: MONO,
        fill: value > 0 ? COLORS.text : COLORS.unknown,
        anchor: "end",
        max: 6,
      }),
    );
  });

  out.push(panel(railX, 404, railWidth, 116));
  out.push(text("LEGEND", railX + 18, 430, { size: 9, family: MONO, fill: COLORS.muted, spacing: 2 }));
  out.push(legendRow(railX + 18, 452, COLORS.accent, "OBSERVED", "measured this run", false));
  out.push(legendRow(railX + 18, 478, COLORS.inferred, "INFERRED", "suggested by evidence", true));
  out.push(legendRow(railX + 18, 504, COLORS.unknown, "UNKNOWN", "not determined, not absent", true));

  out.push(panel(railX, 534, railWidth, 266));
  out.push(
    text("READING", railX + 18, 560, { size: 9, family: MONO, fill: COLORS.muted, spacing: 2 }),
  );
  const top = findings.slice(0, 7);
  top.forEach((finding, index) => {
    const y = 584 + index * 30;
    out.push(
      `<rect x="${railX + 18}" y="${y - 9}" width="3" height="20" fill="${confidenceColor(finding.confidence)}" fill-opacity="0.85"/>`,
    );
    out.push(
      text(layerDisplay(finding.layer).eyebrow, railX + 30, y, {
        size: 8,
        family: MONO,
        fill: COLORS.muted,
        spacing: 1.4,
        max: 14,
      }),
    );
    out.push(
      text(finding.title, railX + 30, y + 13, {
        size: 10.5,
        fill: finding.confidence === "unknown" ? COLORS.muted : COLORS.text,
        max: 48,
      }),
    );
  });
  out.push(
    text(
      `${findings.length} findings | ${graph.nodes.length} nodes | ${graph.edges.length} relationships`,
      railX + 18,
      788,
      { size: 9.5, family: MONO, fill: COLORS.faint, max: 46 },
    ),
  );
  return out.join("");
}

export function createReportSvg(investigation: Investigation): string {
  const findings = interpretInvestigation(investigation);
  const graph = buildInfrastructureGraph(investigation);
  const counts = countEvidence(investigation);
  const hostname = sanitizeText(investigation.url?.hostname, 120) || "unparsed hostname";
  const timestamp = sanitizeText(investigation.finishedAt ?? investigation.startedAt, 64) || "time not recorded";
  const unknownLayers = graph.nodes
    .filter((node) => node.confidence === "unknown")
    .map((node) => node.id);

  const body: string[] = [];
  body.push(`<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="${COLORS.background}"/>`);
  for (let x = 56; x <= 1384; x += 83) {
    body.push(`<line x1="${x}" y1="176" x2="${x}" y2="800" stroke="${COLORS.hair}" stroke-width="0.5"/>`);
  }
  body.push(hairline(56, 152, 1384, 152));
  body.push(hairline(56, 820, 1384, 820));

  body.push(
    text(BRAND, 56, 66, { size: 22, family: MONO, fill: COLORS.accent, spacing: 6, weight: 500 }),
  );
  body.push(
    text("EVIDENCE FIRST INFRASTRUCTURE MAP", 56, 86, {
      size: 9,
      family: MONO,
      fill: COLORS.muted,
      spacing: 3,
    }),
  );
  body.push(text(hostname, 56, 128, { size: 28, family: MONO, fill: COLORS.text, max: 52 }));
  body.push(
    text(
      `${String(investigation.url?.scheme ?? "").toUpperCase()} ${sanitizeText(investigation.url?.pathname, 120) || "/"}`,
      56,
      146,
      { size: 10, family: MONO, fill: COLORS.faint, max: 60 },
    ),
  );

  body.push(
    text(timestamp, 1384, 66, { size: 11, family: MONO, fill: COLORS.text, anchor: "end", max: 40 }),
  );
  body.push(
    text(`investigation ${sanitizeText(investigation.id, 64) || "unidentified"}`, 1384, 86, {
      size: 9,
      family: MONO,
      fill: COLORS.muted,
      anchor: "end",
      max: 48,
    }),
  );
  body.push(
    text(
      `${counts.total} evidence rows | ${counts.byConfidence.observed} observed | ${counts.byConfidence.inferred} inferred | ${counts.byConfidence.unknown} unknown`,
      1384,
      128,
      { size: 10, family: MONO, fill: COLORS.faint, anchor: "end", max: 78 },
    ),
  );
  body.push(
    text(
      unknownLayers.length > 0 ? `unknown layers: ${unknownLayers.join(" ")}` : "every layer resolved",
      1384,
      146,
      { size: 9.5, family: MONO, fill: COLORS.muted, anchor: "end", max: 60 },
    ),
  );

  body.push(
    text("INFRASTRUCTURE GRAPH", 56, 170, { size: 9, family: MONO, fill: COLORS.muted, spacing: 2 }),
  );
  body.push(
    text("SEMANTIC RELATIONSHIPS, NOT A NETWORK PATH", 992, 170, {
      size: 9,
      family: MONO,
      fill: COLORS.faint,
      spacing: 1.4,
      anchor: "end",
      max: 52,
    }),
  );

  for (const edge of graph.edges) body.push(renderEdge(edge));
  for (const node of graph.nodes) body.push(renderNode(node));
  body.push(renderRail(investigation, findings, graph));

  const footer = [
    "Observed means measured by a named source in this single run. Inferred means suggested by that evidence and stated as a guess. Unknown means not determined here, never absent.",
    investigation.edition === "browser"
      ? "Browser edition: public DNS and network lookups only. No request was sent to the website. TLS, redirects, headers and response technologies require the local app."
      : "No JavaScript executed, no subresources fetched, no port scan, no traceroute, no saved history. Registry country is administrative data about an address block, not a server location.",
    "Authoritative DNS answers a name; address registration identifies a network. Neither establishes who serves the content or where an origin runs. Every claim traces to an evidence row here.",
  ];
  footer.forEach((line, index) => {
    body.push(
      text(line, 56, 848 + index * 18, { size: 9.5, fill: index === 0 ? COLORS.muted : COLORS.faint, max: 210 }),
    );
  });
  body.push(
    text(`${BRAND} | generated from this investigation only | ${timestamp}`, 56, 958, {
      size: 9,
      family: MONO,
      fill: COLORS.faint,
      spacing: 1.2,
      max: 90,
    }),
  );
  body.push(
    text(`${graph.nodes.length} nodes | ${graph.edges.length} relationships | ${findings.length} findings`, 1384, 958, {
      size: 9,
      family: MONO,
      fill: COLORS.faint,
      spacing: 1.2,
      anchor: "end",
      max: 60,
    }),
  );

  const defs = `<defs><marker id="arrow-observed" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${COLORS.faint}"/></marker><marker id="arrow-inferred" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="${COLORS.inferred}"/></marker></defs>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}" viewBox="0 0 ${CANVAS.width} ${CANVAS.height}" role="img" aria-labelledby="xray-title xray-desc">`,
    `<title id="xray-title">${escapeXml(`${BRAND} report for ${hostname}`)}</title>`,
    `<desc id="xray-desc">${escapeXml(
      `Infrastructure graph with ${graph.nodes.length} nodes and ${graph.edges.length} relationships, ${counts.total} evidence rows, generated ${timestamp}. Semantic relationships only, not a network path.`,
    )}</desc>`,
    defs,
    body.join(""),
    "</svg>",
  ].join("");
}
