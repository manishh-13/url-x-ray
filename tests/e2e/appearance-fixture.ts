import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

const now = "2026-09-12T10:00:00.000Z";
const observedAt = "2026-09-12T10:00:01.000Z";

// Same observation shape the existing app.spec.ts mock streams, so appearance
// checks read a fully populated result without any live traffic.
const base = {
  id: "appearance-observation",
  url: { href: "https://example.com/", hostname: "example.com", scheme: "https", port: "", pathname: "/", queryKeys: [], hasQuery: false, hasFragment: false, display: "https://example.com/" },
  startedAt: now,
  providers: {
    dns: { status: "complete", durationMs: 40 }, http: { status: "complete", durationMs: 80 }, tls: { status: "complete", durationMs: 55 },
    network: { status: "complete", durationMs: 42 }, technology: { status: "complete", durationMs: 16 },
  },
  dns: { resolver: "Cloudflare DNS-over-HTTPS", records: [
    { type: "A", name: "example.com", value: "93.184.216.34", ttl: 300 },
    { type: "NS", name: "example.com", value: "a.iana-servers.net", ttl: 86400 },
  ], addresses: ["93.184.216.34"], queryStatus: { A: "NOERROR", AAAA: "NOERROR", CNAME: "NOERROR", NS: "NOERROR", MX: "NOERROR", TXT: "NOERROR", CAA: "NOERROR", HTTPS: "NOERROR", SVCB: "NOERROR" } },
  http: { hops: [{ url: "https://example.com/", status: 200, headers: { "content-type": "text/html", "x-content-type-options": "nosniff" }, durationMs: 80, address: "93.184.216.34" }], finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0, chainComplete: true, headerSignals: [
    { name: "x-content-type-options", title: "MIME sniffing protection", state: "present", explanation: "The response included X-Content-Type-Options.", value: "nosniff" },
    { name: "strict-transport-security", title: "Strict transport security", state: "absent", explanation: "This single HTTPS response did not include HSTS." },
  ], durationMs: 80 },
  tls: { hostname: "example.com", issuer: "DigiCert Inc", subject: "example.com", sans: ["example.com", "www.example.com"], validFrom: "2026-01-01T00:00:00.000Z", validTo: "2027-01-01T00:00:00.000Z", protocol: "TLSv1.3", fingerprint256: "AA:BB:CC", authorized: true, chain: [{ subject: "example.com", issuer: "DigiCert Inc", validTo: "2027-01-01T00:00:00.000Z" }] },
  network: { addresses: [{ ip: "93.184.216.34", version: 4, asn: "AS15133", organization: "EDGECAST", prefix: "93.184.216.0/24", country: "US", ptr: ["example.com"], source: "Team Cymru DNS", sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" }], limited: false },
  technology: { technologies: [{ name: "HTML", category: "Frontend", confidence: "observed", evidenceIds: ["http-content"], explanation: "The response content type was HTML." }], infrastructure: [], analyzedBytes: 1256, truncated: false },
  evidence: [
    { id: "url-host", source: "url", kind: "HOSTNAME", label: "Requested hostname", value: "example.com", confidence: "observed", observedAt },
    { id: "dns-a", source: "dns", kind: "A", label: "IPv4 address", value: "93.184.216.34", confidence: "observed", observedAt, sourceUrl: "https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/" },
    { id: "http-status", source: "http", kind: "STATUS", label: "Final response", value: "200", confidence: "observed", observedAt },
    { id: "http-peer", source: "http", kind: "PEER", label: "Connected address", value: "93.184.216.34", confidence: "observed", observedAt },
    { id: "http-content", source: "technology", kind: "HEADER", label: "Content-Type", value: "text/html", confidence: "observed", observedAt },
    { id: "tls-issuer", source: "tls", kind: "ISSUER", label: "Certificate issuer", value: "DigiCert Inc", confidence: "observed", observedAt },
    { id: "network-asn", source: "network", kind: "ASN", label: "Route origin", value: "AS15133 EDGECAST", confidence: "observed", observedAt, sourceUrl: "https://www.team-cymru.com/ip-asn-mapping" },
  ],
};

export type MockCalls = { count: number };

export async function mockInvestigation(page: Page): Promise<MockCalls> {
  const calls: MockCalls = { count: 0 };
  await page.route("**/api/investigate", async (route) => {
    calls.count += 1;
    const body = JSON.stringify({ type: "start", investigation: { ...base, providers: Object.fromEntries(Object.keys(base.providers).map((key) => [key, { status: "investigating" }])) } }) + "\n" +
      JSON.stringify({ type: "complete", investigation: { ...base, finishedAt: "2026-09-12T10:00:02.000Z" } }) + "\n";
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

// Essential prose: the sentences a reader has to be able to read comfortably.
export const BODY_SELECTORS = {
  landing: [".hero-description", ".how-intro p", ".how-step p", ".how-step h3", ".honesty-line p"],
  result: [".story-finding h3", ".story-finding p", ".evidence-item > p", ".relationship-count"],
  dialog: [".detail-intro", ".scope-note", ".privacy-sections section p", ".definition-list dd p", ".header-signals p"],
};

// Supporting metadata: labels, badges and captions. A lower floor, still legible.
export const META_SELECTORS = {
  landing: [".eyebrow", ".brand small", ".site-footer > p", ".try-row"],
  result: [".eyebrow", ".confidence", ".graph-node .node-detail", ".story-intro", ".observation-scope p", ".layer-rail button"],
  dialog: [".eyebrow", ".confidence", "table td", ".raw-details > summary"],
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

type AxeResults = { violations: { id: string; help: string; nodes: { target: unknown[]; any?: { message?: string }[]; failureSummary?: string }[] }[] };

export function formatViolations(label: string, results: AxeResults): string[] {
  return results.violations.flatMap((violation) => violation.nodes.slice(0, 4).map((node) => {
    const reason = node.any?.[0]?.message ?? node.failureSummary ?? violation.help;
    return `${label}: ${violation.id} at ${node.target.join(" ")} :: ${reason.replace(/\s+/g, " ").slice(0, 150)}`;
  }));
}
