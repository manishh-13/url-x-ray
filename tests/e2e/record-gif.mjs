import { chromium } from "playwright";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const frames = join(root, "docs/.xray-frames");
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const startedAt = "2026-09-12T10:00:00.000Z";
const url = { href: "https://example.com/", hostname: "example.com", scheme: "https", port: "443", pathname: "/", queryKeys: [], hasQuery: false, hasFragment: false, display: "https://example.com/" };
const providers = { dns: { status: "complete" }, http: { status: "complete" }, tls: { status: "complete" }, network: { status: "complete" }, technology: { status: "complete" } };
const full = { id: "readme-observation", url, startedAt, finishedAt: "2026-09-12T10:00:03.000Z", providers,
 dns: { resolver: "Cloudflare DNS over HTTPS (1.1.1.1)", records: [{ type: "A", name: "example.com", value: "93.184.216.34", ttl: 300 }, { type: "NS", name: "example.com", value: "a.iana-servers.net", ttl: 86400 }], addresses: ["93.184.216.34"], queryStatus: { A: "NOERROR, 1 record", AAAA: "NOERROR, no records", CNAME: "NOERROR, no records", NS: "NOERROR, 1 record", MX: "NOERROR, no records", TXT: "NOERROR, no records", CAA: "NOERROR, no records", HTTPS: "NOERROR, no records", SVCB: "NOERROR, no records" } },
 http: { hops: [{ url: "https://example.com/", status: 200, headers: { "content-type": "text/html", "x-content-type-options": "nosniff" }, durationMs: 83, address: "93.184.216.34" }], finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0, chainComplete: true, headerSignals: [{ name: "x-content-type-options", title: "No MIME sniffing", state: "present", explanation: "Stops browsers guessing a different content type.", value: "nosniff" }], durationMs: 83 },
 tls: { hostname: "example.com", issuer: "DigiCert Inc", subject: "example.com", sans: ["example.com", "www.example.com"], validFrom: "2026-01-01T00:00:00.000Z", validTo: "2027-01-01T00:00:00.000Z", protocol: "TLSv1.3", fingerprint256: "AA:BB:CC", authorized: true, chain: [{ subject: "example.com", issuer: "DigiCert Inc", validTo: "2027-01-01T00:00:00.000Z" }] },
 network: { addresses: [{ ip: "93.184.216.34", version: 4, asn: "AS15133", organization: "EDGECAST", prefix: "93.184.216.0/24", country: "US", ptr: ["example.com"], source: "Team Cymru IP to ASN mapping", sourceUrl: "https://team-cymru.com/community-services/ip-asn-mapping/" }], limited: false },
 technology: { technologies: [], infrastructure: [], analyzedBytes: 1256, truncated: false },
 evidence: [{ id: "url-1", source: "url", kind: "input", label: "URL under investigation", value: "https://example.com/", confidence: "observed", observedAt: startedAt }, { id: "dns-1", source: "dns", kind: "record", label: "A record", value: "93.184.216.34", confidence: "observed", observedAt: startedAt }, { id: "http-1", source: "http", kind: "hop", label: "HTTP 200", value: "https://example.com/ via 93.184.216.34", confidence: "observed", observedAt: startedAt }, { id: "tls-1", source: "tls", kind: "certificate", label: "Certificate issuer", value: "DigiCert Inc", confidence: "observed", observedAt: startedAt }, { id: "network-1", source: "network", kind: "asn", label: "Announcing network", value: "AS15133 | EDGECAST | 93.184.216.0/24", confidence: "observed", observedAt: startedAt }] };
const pending = { ...full, finishedAt: undefined, providers: Object.fromEntries(Object.keys(providers).map(key => [key, { status: key === "dns" ? "investigating" : "pending" }])), dns: undefined, http: undefined, tls: undefined, network: undefined, technology: undefined, evidence: [full.evidence[0]] };
await page.route("**/api/investigate", async route => {
  const body = JSON.stringify({ type: "start", investigation: pending }) + "\n" + JSON.stringify({ type: "complete", investigation: full }) + "\n";
  await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
});
await page.goto("http://127.0.0.1:3099", { waitUntil: "networkidle" });
let n = 0;
const shot = async (repeat = 1) => { for (let i = 0; i < repeat; i++) await page.screenshot({ path: join(frames, `${String(n++).padStart(3, "0")}.png`) }); };
await shot(10);
await page.locator("#hero-url").fill("https://example.com");
await shot(8);
await page.getByRole("button", { name: "X-ray URL" }).click();
await page.locator(".result-title-row").waitFor();
await shot(18);
await page.locator("#investigation-workspace").scrollIntoViewIfNeeded();
await shot(16);
await page.getByRole("button", { name: /Evidence/ }).click();
await page.getByRole("heading", { name: "Show your work." }).waitFor();
await shot(14);
await browser.close();
