import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const now = "2026-09-12T10:00:00.000Z";
const observedAt = "2026-09-12T10:00:01.000Z";
const base = {
  id: "test-observation",
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

async function mockInvestigation(page: import("@playwright/test").Page) {
  await page.route("**/api/investigate", async (route) => {
    const body = JSON.stringify({ type: "start", investigation: { ...base, providers: Object.fromEntries(Object.keys(base.providers).map((key) => [key, { status: "investigating" }])) } }) + "\n" +
      JSON.stringify({ type: "complete", investigation: { ...base, finishedAt: "2026-09-12T10:00:02.000Z" } }) + "\n";
    await route.fulfill({ status: 200, contentType: "application/x-ndjson", body });
  });
}

test("landing explains the product and opens privacy boundaries", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "See what’s behind a URL." })).toBeVisible();
  await expect(page.getByLabel("Public URL to investigate")).toBeVisible();
  await expect(page.getByText("Real findings appear only after you run an X-ray.")).toHaveCount(1);
  await page.getByRole("button", { name: /Privacy & scope/ }).click();
  await expect(page.getByRole("heading", { name: "Curiosity has boundaries." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What we won’t do" })).toBeVisible();
  await expect(page.getByText(/No private or loopback addresses/)).toHaveCount(1);
  await page.getByRole("button", { name: "Close panel" }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("a streamed observation assembles into an explorable evidence map", async ({ page }) => {
  await mockInvestigation(page);
  await page.goto("/");
  await page.getByLabel("Public URL to investigate").fill("https://example.com?token=do-not-send#private");
  await page.getByRole("button", { name: /X-ray URL/ }).click();
  await expect(page.locator(".result-title-row h1")).toContainText("example.com");
  await expect(page.getByText(/infrastructure relationships/)).toBeVisible();
  await expect(page.getByLabel(/Inspect DNS/i)).toBeVisible();
  await page.getByLabel(/Inspect DNS/i).click();
  await expect(page.getByRole("heading", { name: "DNS resolution" })).toBeVisible();
  await expect(page.getByText("93.184.216.34").first()).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: /Evidence/ }).click();
  await expect(page.getByRole("heading", { name: "Show your work." })).toBeVisible();
  await expect(page.getByText("Route origin")).toBeVisible();
});

test("shared hostname links require an explicit fresh investigation", async ({ page }) => {
  await mockInvestigation(page);
  await page.goto("/xray/example.com");
  await expect(page.getByRole("heading", { name: "example.com" })).toBeVisible();
  await expect(page.getByText("not a saved result")).toBeVisible();
  await page.getByRole("button", { name: /X-ray this hostname/ }).click();
  await expect(page.getByText("X-RAY COMPLETE")).toBeVisible();
});

test("mobile keeps the map vertically explorable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile project only");
  await mockInvestigation(page);
  await page.goto("/");
  await page.getByLabel("Public URL to investigate").fill("example.com");
  await page.getByRole("button", { name: /X-ray URL/ }).click();
  await expect(page.getByLabel("Infrastructure graph. Select a node to inspect its evidence.")).toBeVisible();
  await expect(page.getByLabel(/Inspect TLS/i)).toBeVisible();
  await page.getByLabel(/Inspect TLS/i).click();
  await expect(page.getByRole("heading", { name: "TLS certificate" })).toBeVisible();
});
