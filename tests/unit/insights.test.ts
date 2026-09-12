import { describe, expect, it } from "vitest";
import { buildOverviewFindings, buildTakeaway, groupNetworkAddresses } from "@/lib/insights";
import type { Investigation, NetworkAddress } from "@/lib/types";

function observation(): Investigation {
  return {
    id: "insights-run", startedAt: "2026-09-12T10:00:00.000Z", finishedAt: "2026-09-12T10:00:02.000Z",
    url: { href: "https://example.com/", hostname: "example.com", scheme: "https", port: "", pathname: "/", hasQuery: false, hasFragment: false, queryKeys: [], display: "https://example.com/" },
    providers: { dns: { status: "complete" }, http: { status: "complete" }, tls: { status: "complete" }, network: { status: "complete" }, technology: { status: "complete" } },
    dns: { resolver: "Cloudflare DNS over HTTPS", records: [{ type: "A", name: "example.com", value: "93.184.216.34", ttl: 300 }], addresses: ["93.184.216.34"], queryStatus: { A: "NOERROR, 1 record", AAAA: "NOERROR, no records", NS: "NOERROR, 2 records", TXT: "NOERROR, no records" } },
    http: { hops: [{ url: "https://example.com/", status: 200, headers: { "content-type": "text/html" }, durationMs: 42, address: "93.184.216.34" }], finalUrl: "https://example.com/", finalStatus: 200, redirectCount: 0, chainComplete: true, headerSignals: [{ name: "strict-transport-security", title: "HSTS", state: "absent", explanation: "Not present" }], durationMs: 42 },
    tls: { hostname: "example.com", issuer: "CN=Example CA", subject: "CN=example.com", sans: ["DNS:example.com", "DNS:www.example.com"], validFrom: "Jan 1 00:00:00 2026 GMT", validTo: "Oct 27 22:17:21 2026 GMT", authorized: true, protocol: "TLSv1.3", fingerprint256: "AA:BB", chain: [] },
    network: { addresses: [{ ip: "93.184.216.34", version: 4, asn: "AS15133", organization: "Example Network", prefix: "93.184.216.0/24", country: "US", source: "Team Cymru DNS" }], limited: false },
    technology: { technologies: [{ name: "nginx", category: "Backend", confidence: "observed", evidenceIds: ["tech"], explanation: "Server header" }], infrastructure: [], analyzedBytes: 100, truncated: false },
    evidence: (["url", "dns", "http", "tls", "network", "technology"] as const).map((source) => ({ id: source === "technology" ? "tech" : source, source, kind: source === "http" ? "hop" : "record", label: source, value: source, confidence: "observed", observedAt: "2026-09-12T10:00:01.000Z" })),
  };
}

function response(i: Investigation, status: number) {
  i.http!.finalStatus = status;
  i.http!.hops[0].status = status;
}

function noResponse(i: Investigation) {
  i.http = { hops: [], finalUrl: i.url.href, finalStatus: 0, redirectCount: 0, chainComplete: false, headerSignals: [], durationMs: 30, stoppedReason: "The request ended before a response arrived." };
  i.providers.http.status = "unavailable";
}

describe("evidence-grounded takeaway", () => {
  it("gives a short successful request summary without a global health claim", () => {
    const take = buildTakeaway(observation(), false);
    expect(take).toMatchObject({ tone: "positive", title: "This request succeeded.", layer: "http" });
    expect(take.description).toBe("The server returned HTTP 200 with no redirects.");
    expect(take.nextChecks).toEqual([]);
    expect(JSON.stringify(take)).not.toMatch(/healthy|secure|safe site|vulnerab/i);
  });

  it.each([201, 204, 206, 299])("recognizes HTTP %s as a successful response", (status) => {
    const i = observation(); response(i, status);
    expect(buildTakeaway(i, false).tone).toBe("positive");
    expect(buildTakeaway(i, false).description).toContain(`HTTP ${status}`);
  });

  it("names the observed redirect destination", () => {
    const i = observation();
    i.http!.hops.unshift({ ...i.http!.hops[0], status: 301, location: "https://www.example.com/" });
    i.http!.finalUrl = "https://www.example.com/";
    i.http!.hops[1].url = i.http!.finalUrl;
    i.http!.redirectCount = 1;
    const take = buildTakeaway(i, false);
    expect(take.description).toContain("after 1 redirect");
    expect(take.description).toContain("https://www.example.com/");
  });

  it.each([
    [401, "http-auth", "authentication"], [403, "http-forbidden", "refused"],
    [404, "http-path", "not found"], [410, "http-path", "gone"],
    [429, "http-rate", "rate limited"], [500, "http-server", "error"],
    [502, "http-server", "error"], [503, "http-server", "error"],
  ] as const)("explains HTTP %s and suggests a relevant check", (status, check, wording) => {
    const i = observation(); response(i, status);
    const take = buildTakeaway(i, false);
    expect(take.tone).toBe("attention");
    expect(take.title).toContain(wording);
    expect(take.nextChecks[0]).toMatchObject({ id: check, layer: "http", evidenceIds: ["http"] });
    expect(JSON.stringify(take)).not.toMatch(/WAF blocked|Cloudflare blocked|origin is down|disable.*verification/i);
  });

  it("does not blame an inferred platform for an HTTP refusal", () => {
    const i = observation(); response(i, 403);
    i.technology!.infrastructure = [{ name: "Cloudflare", confidence: "inferred", evidenceIds: ["http"], explanation: "cf-ray header" }];
    const take = buildTakeaway(i, false);
    expect(JSON.stringify(take)).not.toContain("Cloudflare");
    expect(take.nextChecks[0].description).toContain("logs to find why");
  });

  it("does not call a partial redirect chain successful", () => {
    const i = observation(); response(i, 302);
    i.http!.chainComplete = false;
    i.http!.stoppedReason = "The redirect chain returns to a URL it already visited.";
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("The redirect chain stopped early.");
    expect(take.description).toContain("already visited");
    expect(take.nextChecks[0].id).toBe("http-redirect");
  });

  it("distinguishes a zero-hop HTTP failure from a redirect failure", () => {
    const i = observation(); noResponse(i);
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("No HTTP response was captured.");
    expect(take.nextChecks[0].id).toBe("http-unavailable");
    expect(JSON.stringify(take)).not.toContain("HTTP 0");
    expect(take.title).not.toMatch(/redirect/i);
  });

  it("recognizes a real DNS name failure and points to DNS", () => {
    const i = observation(); noResponse(i);
    i.dns!.addresses = [];
    i.dns!.queryStatus = { A: "NXDOMAIN", AAAA: "NXDOMAIN" };
    const take = buildTakeaway(i, false);
    expect(take).toMatchObject({ title: "This hostname did not resolve.", layer: "dns" });
    expect(take.description).toContain("NXDOMAIN");
    expect(take.nextChecks[0].id).toBe("dns-name");
  });

  it("does not confuse resolver failure with a nonexistent domain", () => {
    const i = observation(); noResponse(i);
    i.dns!.addresses = [];
    i.dns!.queryStatus = { A: "SERVFAIL", AAAA: "no answer in time" };
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("The address lookup could not be completed.");
    expect(take.nextChecks[0].title).toBe("Check the resolver response");
    expect(take.description).not.toMatch(/does not exist|NXDOMAIN/);
  });

  it("treats empty successful address answers as no addresses, not query errors", () => {
    const i = observation(); noResponse(i);
    i.dns!.addresses = [];
    i.dns!.queryStatus = { A: "NOERROR, no records", AAAA: "NOERROR, no records", TXT: "NXDOMAIN" };
    expect(buildTakeaway(i, false).title).toBe("No public address was returned.");
  });

  it("does not warn about valid provider-shaped DNS success statuses", () => {
    const take = buildTakeaway(observation(), false);
    expect(take.notes).toEqual([]);
    expect(take.nextChecks).toEqual([]);
  });

  it("retains an unavailable optional query without erasing HTTP success", () => {
    const i = observation(); i.dns!.queryStatus.TXT = "SERVFAIL";
    const take = buildTakeaway(i, false);
    expect(take.tone).toBe("positive");
    expect(take.notes.join(" ")).toContain("TXT DNS query was unavailable");
    expect(take.nextChecks[0].id).toBe("dns-partial");
  });

  it("prioritizes the public-address boundary without recommending a bypass", () => {
    const i = observation(); noResponse(i);
    i.evidence.push({ id: "block", source: "http", kind: "blocked", label: "Destination refused", value: "private address", confidence: "observed", observedAt: i.startedAt });
    i.http!.stoppedReason = "The redirect points outside the public Internet.";
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("The request stopped before its destination.");
    expect(take.nextChecks[0].id).toBe("public-destination");
    expect(JSON.stringify(take)).not.toMatch(/bypass|disable|turn off/);
  });

  it("uses captured certificate dates and the observation time for expiry", () => {
    const i = observation(); noResponse(i);
    i.tls!.validTo = "Sep 1 00:00:00 2026 GMT";
    i.tls!.authorized = false;
    i.tls!.authorizationError = "CERT_HAS_EXPIRED";
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("The certificate had expired.");
    expect(take.description).toContain("1 Sept 2026 UTC");
    expect(take.layer).toBe("tls");
    expect(take.nextChecks[0].id).toBe("tls-expired");
    i.startedAt = "2026-08-01T00:00:00.000Z";
    i.tls!.authorized = true;
    delete i.tls!.authorizationError;
    expect(buildTakeaway(i, false).title).not.toContain("expired");
  });

  it("recognizes a not-yet-valid certificate", () => {
    const i = observation(); i.tls!.validFrom = "2026-10-01T00:00:00.000Z";
    expect(buildTakeaway(i, false).nextChecks[0].id).toBe("tls-future");
  });

  it("ignores malformed dates instead of inventing expiry", () => {
    const i = observation(); i.tls!.validTo = "not a date";
    expect(buildTakeaway(i, false).tone).toBe("positive");
    expect(JSON.stringify(buildTakeaway(i, false))).not.toMatch(/expired|Invalid Date|NaN/);
  });

  it("explains a hostname validation error without treating HTTP as the same check", () => {
    const i = observation(); i.tls!.authorized = false; i.tls!.authorizationError = "ERR_TLS_CERT_ALTNAME_INVALID";
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("The certificate check failed.");
    expect(take.nextChecks[0].id).toBe("tls-name");
    expect(take.description).toContain("HTTP check separately received HTTP 200");
  });

  it("keeps unknown TLS validation errors generic", () => {
    const i = observation(); i.tls!.authorized = false; i.tls!.authorizationError = "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
    expect(buildTakeaway(i, false).nextChecks[0].id).toBe("tls-validation");
    expect(buildTakeaway(i, false).description).toContain("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("keeps two concrete checks when both certificate and HTTP evidence need attention", () => {
    const i = observation(); i.tls!.authorized = false; response(i, 403); i.dns!.queryStatus.TXT = "SERVFAIL";
    const take = buildTakeaway(i, false);
    expect(take.nextChecks.map((item) => item.id)).toEqual(["tls-validation", "http-forbidden"]);
    expect(take.notes.join(" ")).toContain("TXT");
  });

  it("waits for completion instead of declaring success while TLS is still running", () => {
    const i = observation(); delete i.finishedAt; delete i.tls; i.providers.tls.status = "investigating";
    const take = buildTakeaway(i, true);
    expect(take.tone).toBe("pending");
    expect(take.title).toContain("Finishing the checks");
    expect(take.nextChecks).toEqual([]);
  });

  it("leaves stopped investigations neutral even if an earlier HTTP response arrived", () => {
    const i = observation(); delete i.finishedAt;
    expect(buildTakeaway(i, false)).toMatchObject({ tone: "neutral", title: "This investigation stopped early." });
  });

  it("keeps query removal visible without echoing a value", () => {
    const i = observation(); i.url.hasQuery = true; i.url.queryKeys = ["token"];
    const take = buildTakeaway(i, false);
    expect(take.notes[0]).toContain("Query parameters were removed");
    expect(take.notes[0]).not.toContain("token");
  });

  it("does not call an intentionally skipped HTTP-URL TLS check a failure", () => {
    const i = observation(); i.url.scheme = "http"; delete i.tls; i.providers.tls.status = "unavailable";
    expect(buildTakeaway(i, false).tone).toBe("positive");
    expect(buildTakeaway(i, false).notes.join(" ")).not.toContain("certificate");
  });

  it("does not confuse a missing optional provider with an HTTP failure", () => {
    const i = observation(); delete i.network; i.providers.network.status = "unavailable";
    const take = buildTakeaway(i, false);
    expect(take.tone).toBe("positive");
    expect(take.notes.join(" ")).toContain("Network details could not be collected");
  });

  it("never refers to absent evidence IDs", () => {
    const i = observation(); response(i, 403); i.evidence = [];
    const take = buildTakeaway(i, false);
    expect(take.evidenceIds).toEqual([]);
    expect(take.nextChecks.every((item) => item.evidenceIds.length === 0)).toBe(true);
  });

  it("does not mutate the captured observation", () => {
    const i = observation(); const before = structuredClone(i);
    buildTakeaway(i, false); buildOverviewFindings(i, false); groupNetworkAddresses(i.network!.addresses);
    expect(i).toEqual(before);
  });
});

describe("network grouping and short overview", () => {
  it("groups a network's IPv4 and IPv6 addresses while retaining prefixes", () => {
    const addresses: NetworkAddress[] = [
      { ip: "1.1.1.1", version: 4, asn: "AS13335", prefix: "1.1.1.0/24", organization: "Cloudflare", source: "DNS" },
      { ip: "2606:4700:4700::1111", version: 6, asn: "as13335", prefix: "2606:4700::/32", organization: "Cloudflare", source: "DNS" },
    ];
    const groups = groupNetworkAddresses(addresses);
    expect(groups).toHaveLength(1);
    expect(groups[0].addresses).toEqual(addresses);
    expect(groups[0].prefixes).toEqual(["1.1.1.0/24", "2606:4700::/32"]);
    expect(groups[0].organizations).toEqual(["Cloudflare"]);
  });

  it("does not merge different networks just because they share a company name", () => {
    const base = observation().network!.addresses[0];
    expect(groupNetworkAddresses([base, { ...base, ip: "1.1.1.1", asn: "AS13335" }])).toHaveLength(2);
  });

  it("keeps unknown networks separate and deduplicates identical addresses", () => {
    const base = { ip: "1.1.1.1", version: 4 as const, source: "DNS" };
    const groups = groupNetworkAddresses([base, base, { ...base, ip: "8.8.8.8" }]);
    expect(groups).toHaveLength(2);
    expect(groups.every((group) => group.addresses.length === 1)).toBe(true);
  });

  it("returns five short findings, with only one network paragraph", () => {
    const i = observation();
    i.network!.addresses.push({ ...i.network!.addresses[0], ip: "93.184.216.35" });
    const overview = buildOverviewFindings(i, false);
    expect(overview).toHaveLength(5);
    expect(overview.filter((item) => item.layer === "network")).toHaveLength(1);
    expect(overview.find((item) => item.layer === "network")?.title).toBe("2 addresses in one network");
    expect(overview.every((item) => item.description.length < 400)).toBe(true);
  });

  it("keeps inferred platforms labelled as inferred in the compact story", () => {
    const i = observation();
    i.technology!.infrastructure = [{ name: "Example Edge", confidence: "inferred", evidenceIds: ["http", "missing"], explanation: "Header" }];
    const summary = buildOverviewFindings(i, false).find((item) => item.layer === "infrastructure");
    expect(summary?.confidence).toBe("inferred");
    expect(summary?.evidenceIds).toEqual(["http"]);
  });

  it("marks missing layers unknown instead of making up details", () => {
    const i = observation(); delete i.http; delete i.tls; delete i.network; delete i.technology;
    const overview = buildOverviewFindings(i, false);
    expect(overview).toHaveLength(5);
    expect(overview.filter((item) => item.layer !== "dns").every((item) => item.confidence === "unknown")).toBe(true);
  });

  it("explains explicit IP literal skips but not blank query statuses", () => {
    const i = observation(); i.url.hostname = "93.184.216.34"; i.dns!.queryStatus = { A: "not applicable", AAAA: "not applicable" };
    expect(buildOverviewFindings(i, false)[0].title).toContain("supplied directly");
    i.dns!.queryStatus = { A: "", AAAA: "" };
    expect(buildOverviewFindings(i, false)[0].title).not.toContain("supplied directly");
  });
});
