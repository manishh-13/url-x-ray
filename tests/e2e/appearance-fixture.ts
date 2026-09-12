import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Investigation } from "../../src/lib/types";

const startedAt = "2026-09-12T10:00:00.000Z";
const finishedAt = "2026-09-12T10:00:02.000Z";
const observedAt = "2026-09-12T10:00:01.000Z";

// A fully populated observation, shaped exactly like a real run: every provider
// completed, a redirect chain with headers, a CNAME alias, a certificate chain,
// enriched network data and an inferred edge guess. Populated data matters for
// appearance work, because empty layers render placeholders instead of the
// tables, disclosures and captions the readability floors apply to.
// queryStatus uses the strings the DNS provider itself writes (see
// src/lib/server/providers/dns.ts), not invented status codes.
const base: Investigation = {
  id: "appearance-observation",
  url: { href: "https://example.com/", hostname: "example.com", scheme: "https", port: "", pathname: "/", queryKeys: [], hasQuery: false, hasFragment: false, display: "https://example.com/" },
  startedAt,
  providers: {
    dns: { status: "complete", durationMs: 40, message: "9 record types queried over DNS-over-HTTPS." },
    http: { status: "complete", durationMs: 180 },
    tls: { status: "complete", durationMs: 55 },
    network: { status: "complete", durationMs: 42 },
    technology: { status: "complete", durationMs: 16 },
  },
  dns: {
    resolver: "Cloudflare DNS-over-HTTPS",
    records: [
      { type: "A", name: "example.com", value: "93.184.216.34", ttl: 300 },
      { type: "A", name: "example.com", value: "93.184.216.35", ttl: 300 },
      { type: "AAAA", name: "example.com", value: "2606:2800:220:1:248:1893:25c8:1946", ttl: 300 },
      // An apex alias, as a flattening resolver returns it.
      { type: "CNAME", name: "example.com", value: "example-com.edge.example-cdn.net", ttl: 120 },
      { type: "NS", name: "example.com", value: "a.iana-servers.net", ttl: 86400 },
      { type: "TXT", name: "example.com", value: "v=spf1 -all", ttl: 3600 },
    ],
    addresses: ["93.184.216.34", "93.184.216.35", "2606:2800:220:1:248:1893:25c8:1946"],
    queryStatus: {
      A: "NOERROR, 2 records", AAAA: "NOERROR, 1 record", CNAME: "NOERROR, 1 record",
      NS: "NOERROR, 1 record", MX: "NOERROR, no records", TXT: "NOERROR, 1 record",
      CAA: "no answer in time", HTTPS: "NOERROR, no records", SVCB: "NXDOMAIN",
    },
  },
  http: {
    hops: [
      { url: "https://example.com/", status: 301, location: "https://example.com/home", headers: { "content-type": "text/html; charset=utf-8", location: "https://example.com/home", server: "ECS (dcb/7F84)", "strict-transport-security": "max-age=63072000; includeSubDomains" }, durationMs: 96, address: "93.184.216.34" },
      { url: "https://example.com/home", status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'self'; img-src 'self' data:", "strict-transport-security": "max-age=63072000; includeSubDomains", server: "ECS (dcb/7F84)" }, durationMs: 84, address: "93.184.216.34" },
    ],
    finalUrl: "https://example.com/home",
    finalStatus: 200,
    redirectCount: 1,
    chainComplete: true,
    headerSignals: [
      { name: "strict-transport-security", title: "Strict transport security", state: "present", explanation: "The final response asked browsers to use HTTPS for this hostname.", value: "max-age=63072000; includeSubDomains" },
      { name: "x-content-type-options", title: "MIME sniffing protection", state: "present", explanation: "The final response included X-Content-Type-Options.", value: "nosniff" },
      { name: "content-security-policy", title: "Content security policy", state: "present", explanation: "A policy was declared for this response only.", value: "default-src 'self'; img-src 'self' data:" },
      { name: "x-frame-options", title: "Framing protection", state: "absent", explanation: "This response did not declare a framing policy, which a CSP frame-ancestors directive can also cover." },
    ],
    durationMs: 180,
  },
  tls: {
    hostname: "example.com",
    issuer: "DigiCert TLS RSA SHA256 2020 CA1",
    subject: "example.com",
    sans: ["DNS:example.com", "DNS:www.example.com", "DNS:api.example.com", "DNS:cdn.example.com"],
    validFrom: "2026-01-14T00:00:00.000Z",
    validTo: "2027-02-15T23:59:59.000Z",
    protocol: "TLSv1.3",
    fingerprint256: "9C:1E:4B:7A:22:D8:63:F0:5A:11:8E:44:C7:30:9B:6D:2F:58:A0:71:E3:4C:92:0B:6A:D5:37:18:CE:44:80:F2",
    authorized: true,
    chain: [
      { subject: "example.com", issuer: "DigiCert TLS RSA SHA256 2020 CA1", validTo: "2027-02-15T23:59:59.000Z" },
      { subject: "DigiCert TLS RSA SHA256 2020 CA1", issuer: "DigiCert Global Root CA", validTo: "2031-04-13T23:59:59.000Z" },
    ],
  },
  network: {
    addresses: [
      { ip: "93.184.216.34", version: 4, asn: "AS15133", organization: "EDGECAST, US", prefix: "93.184.216.0/24", country: "US", ptr: ["example.com"], source: "Team Cymru DNS", sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" },
      { ip: "2606:2800:220:1:248:1893:25c8:1946", version: 6, asn: "AS15133", organization: "EDGECAST, US", prefix: "2606:2800:220::/48", country: "US", source: "Team Cymru DNS", sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" },
    ],
    limited: false,
  },
  technology: {
    technologies: [
      { name: "HTML", category: "Frontend", confidence: "observed", evidenceIds: ["http-content"], explanation: "The final response declared an HTML content type." },
      { name: "HSTS", category: "Infrastructure", confidence: "observed", evidenceIds: ["http-hsts"], explanation: "The redirect response carried a Strict-Transport-Security header." },
    ],
    infrastructure: [
      { name: "Edgecast edge network", confidence: "inferred", evidenceIds: ["network-asn", "dns-cname"], explanation: "The observed addresses are announced by AS15133 and the hostname resolves through an edge alias. That is a routing observation, not proof of where the origin is hosted." },
    ],
    analyzedBytes: 25_600,
    truncated: false,
  },
  evidence: [
    { id: "url-host", source: "url", kind: "HOSTNAME", label: "Requested hostname", value: "example.com", confidence: "observed", observedAt, explanation: "Taken from the URL you submitted, after query removal." },
    { id: "dns-a", source: "dns", kind: "A", label: "IPv4 address", value: "93.184.216.34", confidence: "observed", observedAt, sourceUrl: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/" },
    { id: "dns-aaaa", source: "dns", kind: "AAAA", label: "IPv6 address", value: "2606:2800:220:1:248:1893:25c8:1946", confidence: "observed", observedAt, sourceUrl: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/" },
    { id: "dns-cname", source: "dns", kind: "CNAME", label: "Alias target", value: "example-com.edge.example-cdn.net", confidence: "observed", observedAt, explanation: "The name resolves through an alias before reaching an address." },
    { id: "dns-ns", source: "dns", kind: "NS", label: "Authoritative nameserver", value: "a.iana-servers.net", confidence: "observed", observedAt },
    { id: "http-status", source: "http", kind: "STATUS", label: "Final response", value: "200", confidence: "observed", observedAt },
    { id: "http-redirect", source: "http", kind: "REDIRECT", label: "Redirect observed", value: "301 to https://example.com/home", confidence: "observed", observedAt },
    { id: "http-peer", source: "http", kind: "PEER", label: "Connected address", value: "93.184.216.34", confidence: "observed", observedAt },
    { id: "http-hsts", source: "http", kind: "HEADER", label: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains", confidence: "observed", observedAt },
    { id: "http-content", source: "technology", kind: "HEADER", label: "Content-Type", value: "text/html; charset=utf-8", confidence: "observed", observedAt },
    { id: "tls-issuer", source: "tls", kind: "ISSUER", label: "Certificate issuer", value: "DigiCert TLS RSA SHA256 2020 CA1", confidence: "observed", observedAt },
    { id: "tls-sans", source: "tls", kind: "SAN", label: "Subject alternative names", value: "DNS:example.com, DNS:www.example.com, DNS:api.example.com, DNS:cdn.example.com", confidence: "observed", observedAt },
    { id: "network-asn", source: "network", kind: "ASN", label: "Route origin", value: "AS15133 EDGECAST, US", confidence: "observed", observedAt, sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" },
    { id: "network-prefix", source: "network", kind: "PREFIX", label: "Announced prefix", value: "93.184.216.0/24", confidence: "inferred", observedAt, explanation: "Reported by the network-data source for this address.", sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" },
  ],
};

/** A finished investigation. A fresh deep copy each call, so a test can edit it. */
export function appearanceInvestigation(): Investigation {
  return structuredClone({ ...base, finishedAt });
}

export type MockCalls = {
  /** Live count of intercepted /api/investigate calls. */
  count: number;
};

/**
 * Serves one investigation from a routed request: a `start` event with every
 * provider still investigating, then the finished observation. No live traffic
 * and no timers, so runs are deterministic.
 */
export async function mockInvestigation(page: Page, investigation: Investigation = appearanceInvestigation()): Promise<MockCalls> {
  const calls: MockCalls = { count: 0 };
  const providerIds = Object.keys(investigation.providers) as (keyof Investigation["providers"])[];
  const starting: Investigation = {
    ...investigation,
    finishedAt: undefined,
    providers: Object.fromEntries(providerIds.map((id) => [id, { status: "investigating" }])) as Investigation["providers"],
  };
  await page.route("**/api/investigate", async (route) => {
    calls.count += 1;
    const body = `${JSON.stringify({ type: "start", investigation: starting })}\n${JSON.stringify({ type: "complete", investigation })}\n`;
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
  return calls;
}

export async function runInvestigation(page: Page, target = "example.com") {
  await page.getByLabel("Public URL to investigate").fill(target);
  await page.getByRole("button", { name: /X-ray URL/ }).click();
  await expect(page.locator(".result-title-row h1")).toContainText("example.com");
}

export function themeToggle(page: Page, to: "dark" | "light"): Locator {
  return page.getByRole("button", { name: `Switch to ${to} mode`, exact: true });
}

export function theme(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

// Waits for every running animation on the open dialog (and its subtree) to
// finish, then for two frames, so geometry is read after the entrance settles.
// No timers, so this stays deterministic on a slow machine.
export async function settledDialog(page: Page): Promise<Locator> {
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toHaveCount(1);
  await dialog.evaluate(async (el) => {
    const animations = (el as HTMLElement).getAnimations({ subtree: true });
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))));
  });
  return dialog;
}

/**
 * Opens every collapsed disclosure inside `scope` so the tables, header lists
 * and evidence rows behind them are measurable instead of vacuously skipped.
 * The `details` set is stable while toggling, so indexed locators stay valid;
 * nested disclosures become visible on a later pass.
 */
export async function openDisclosures(scope: Page | Locator, passes = 3): Promise<number> {
  let opened = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const items = await scope.locator("details").all();
    let clicked = 0;
    for (const item of items) {
      if (await item.evaluate((el) => (el as HTMLDetailsElement).open)) continue;
      const summary = item.locator("summary").first();
      if (!(await summary.isVisible())) continue;
      await summary.click();
      await expect(item).toHaveJSProperty("open", true);
      clicked += 1;
      opened += 1;
    }
    if (clicked === 0) break;
  }
  return opened;
}

export type Box = {
  top: number; left: number; right: number; bottom: number; width: number; height: number;
  viewportWidth: number; viewportHeight: number;
};

export function dialogBox(dialog: Locator): Promise<Box> {
  return dialog.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
    };
  });
}

export function documentOverflow(page: Page) {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, bodyScrollWidth: document.body.scrollWidth };
  });
}

export const BODY_MIN_PX = 15;
export const META_MIN_PX = 12;
/** Table cells, code and other dense data: below prose, above metadata. */
export const DATA_MIN_PX = 13;

// Essential prose: the sentences a reader has to be able to read comfortably.
export const BODY_SELECTORS = {
  landing: [".hero-description", ".how-intro p", ".how-step p", ".how-step h3", ".honesty-line p", ".privacy-sections section p"],
  result: [
    ".story-finding h3", ".story-finding p", ".story-intro", ".evidence-item > p", ".relationship-count",
    ".infrastructure-note p", ".observation-scope p", ".map-scope", ".quiet-empty",
    // Lead's overview and takeaway UI, measured here once it renders.
    ".result-summary-description", ".result-summary-note", ".next-check p",
  ],
  dialog: [
    ".detail-intro", ".scope-note", ".privacy-sections section p", ".definition-list dd p", ".header-signals p",
    ".method-steps p", ".confidence-explanations p", ".technology-detail > p", ".unknown-layer p",
    ".history-empty p", ".certificate-intro p", ".certificate-chain p", ".export-options span",
    ".raw-details > summary", ".hop-headers > summary", ".layer-glossary dd",
  ],
};

// Supporting metadata: labels, badges and captions. A lower floor, still legible.
export const META_SELECTORS = {
  landing: [".eyebrow", ".brand small", ".site-footer > p", ".try-row", ".schematic-topline", ".step-index span", ".input-privacy"],
  result: [
    ".eyebrow", ".confidence", ".graph-node .node-detail", ".node-top", ".graph-legend span", ".map-topline",
    ".layer-rail button", ".layer-rail > span", ".progress-stage", ".workbench-breadcrumb", ".result-eyebrow",
    ".parse-label", ".url-part span", ".depth-selector button", ".depth-selector button > span",
    ".keyboard-hints span", ".observation-scope > span", ".evidence-provenance", ".record-type",
    ".evidence-totals strong span", ".map-controls",
  ],
  dialog: [
    ".eyebrow", ".confidence", ".layer-switcher button", ".definition-list dt", ".detail-heading span",
    ".dns-record-types > span", ".cname-chain span", ".raw-details > summary span", "th",
    ".hop-content > span", ".hop-content > small", ".header-values strong", ".http-status",
    ".header-signals > div > div > span", ".certificate-timeline p span", ".chain-number",
    ".technology-category", ".method-steps > div > span", ".privacy-end p",
    ".evidence-provenance", ".layer-glossary dt", ".network-group-heading",
  ],
};

// Dense data: table cells, code and monospace values.
export const DATA_SELECTORS = {
  result: [".url-part code", ".evidence-value"],
  dialog: [
    "table td", "table td code", "table td small", ".definition-list dd strong", ".cname-chain code",
    ".hop-content > code", ".header-values code", ".header-signals code", ".san-list code",
    ".network-address > summary code", ".evidence-value", ".share-field input",
  ],
};

export type TextSize = { selector: string; px: number; text: string };

export async function textSizes(page: Page, selectors: string[]): Promise<TextSize[]> {
  return page.evaluate((list) => {
    const out: { selector: string; px: number; text: string }[] = [];
    for (const selector of list) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        const el = node as HTMLElement;
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        const text = (el.textContent ?? "").trim();
        if (text.length < 3) continue;
        out.push({ selector, px: Math.round(parseFloat(style.fontSize) * 100) / 100, text: text.slice(0, 44) });
      }
    }
    return out;
  }, selectors);
}

export function tooSmall(sizes: TextSize[], min: number): string[] {
  const worst = new Map<string, TextSize>();
  for (const size of sizes) {
    if (size.px >= min) continue;
    const seen = worst.get(size.selector);
    if (!seen || size.px < seen.px) worst.set(size.selector, size);
  }
  return [...worst.values()].map((s) => `${s.selector} is ${s.px}px (min ${min}px): "${s.text}"`);
}

/** Counts how many of `selectors` actually matched, so a pass cannot be vacuous. */
export async function matchedSelectors(page: Page, selectors: string[]): Promise<string[]> {
  return page.evaluate((list) => list.filter((selector) => {
    return Array.from(document.querySelectorAll(selector)).some((node) => {
      const el = node as HTMLElement;
      return el.getClientRects().length > 0 && (el.textContent ?? "").trim().length >= 3;
    });
  }), selectors);
}

type AxeResults = { violations: { id: string; help: string; nodes: { target: unknown[]; any?: { message?: string }[]; failureSummary?: string }[] }[] };

export function formatViolations(label: string, results: AxeResults): string[] {
  return results.violations.flatMap((violation) => violation.nodes.slice(0, 4).map((node) => {
    const reason = node.any?.[0]?.message ?? node.failureSummary ?? violation.help;
    return `${label}: ${violation.id} at ${node.target.join(" ")} :: ${reason.replace(/\s+/g, " ").slice(0, 150)}`;
  }));
}
