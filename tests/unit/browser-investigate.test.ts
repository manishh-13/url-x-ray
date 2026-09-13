import { describe, expect, it, vi } from "vitest";
import { investigateInBrowser, type BrowserDeps } from "@/lib/client/browser-investigate";
import type { DohQuery, DohResult } from "@/lib/server/doh";
import { DNS_QUERY_TYPES } from "@/lib/server/doh";
import { buildOverviewFindings, buildTakeaway } from "@/lib/insights";
import { buildInfrastructureGraph, interpretInvestigation } from "@/lib/interpretation";
import { createReportJson, createReportSvg } from "@/lib/export";
import type { Investigation, InvestigationEvent } from "@/lib/types";

const now = () => new Date("2026-09-13T07:00:00.000Z");
const answer = (name: string, type: number, data: string): DohResult => ({ status: 0, statusText: "NOERROR", answers: [{ name, type, data, TTL: 300 }] });
const empty = (): DohResult => ({ status: 0, statusText: "NOERROR", answers: [] });

function dependencies(overrides: Partial<BrowserDeps> = {}): BrowserDeps {
  return {
    now, newId: () => "browser-test",
    doh: vi.fn<DohQuery>(async (name, type) => {
      if (name.endsWith(".origin.asn.cymru.com")) return answer(name, 16, '"13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"');
      if (name === "AS13335.asn.cymru.com") return answer(name, 16, '"13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"');
      if (type === "PTR") return answer(name, 12, "one.one.one.one.");
      if (type === "A") return answer(name, 1, "1.1.1.1");
      if (type === "CNAME") return answer(name, 5, "alias.example.net.");
      return empty();
    }),
    json: vi.fn(async () => { throw new Error("Not expected without a failed Cymru lookup"); }),
    ...overrides,
  };
}

async function run(deps: BrowserDeps, url = "https://example.com/a/path?token=secret-value#secret-fragment", signal = new AbortController().signal) {
  const events: InvestigationEvent[] = [];
  for await (const event of investigateInBrowser({ url, deps, signal })) events.push(event);
  return events;
}

function final(events: InvestigationEvent[]): Investigation {
  const event = events.at(-1);
  if (event?.type !== "complete") throw new Error("No terminal completion");
  return event.investigation;
}

describe("real browser collection, without a target transport", () => {
  it("collects the shared DNS/network providers and clearly marks local-only layers", async () => {
    const deps = dependencies();
    const events = await run(deps);
    const i = final(events);
    expect(events.map((event) => event.type)).toEqual(["start", "update", "update", "update", "complete"]);
    expect(i.edition).toBe("browser");
    expect(i.providers.dns.status).toBe("complete");
    expect(i.providers.network.status).toBe("complete");
    expect(i.dns?.queryStatus.A).toBe("NOERROR, 1 record");
    expect(i.network?.addresses[0]).toMatchObject({ ip: "1.1.1.1", asn: "AS13335", organization: "CLOUDFLARENET, US", ptr: ["one.one.one.one"] });
    for (const id of ["http", "tls", "technology"] as const) expect(i.providers[id]).toMatchObject({ status: "unavailable", reason: "local-only" });
    expect(i.http).toBeUndefined();
    expect(i.tls).toBeUndefined();
    expect(i.technology?.technologies).toEqual([]);
    expect(i.technology?.analyzedBytes).toBe(0);
    expect(i.technology?.infrastructure).toHaveLength(1);
    const hint = i.technology!.infrastructure[0];
    expect(hint).toMatchObject({ name: "Cloudflare", confidence: "inferred" });
    expect(i.evidence.find((row) => row.id === hint.evidenceIds[0])?.source).toBe("network");
    expect(deps.json).not.toHaveBeenCalled();
    expect(vi.mocked(deps.doh).mock.calls.filter(([name]) => name === "example.com").map(([, type]) => type)).toEqual([...DNS_QUERY_TYPES]);
  });

  it("never sends the URL path, query values or fragment to a lookup source", async () => {
    const deps = dependencies();
    const events = await run(deps);
    expect(JSON.stringify(vi.mocked(deps.doh).mock.calls)).not.toMatch(/a\/path|secret-value|secret-fragment|token/);
    expect(JSON.stringify(events)).not.toMatch(/secret-value|secret-fragment/);
    expect(final(events).url.pathname).toBe("/a/path");
    expect(final(events).url.queryKeys).toEqual(["token"]);
  });

  it.each(["http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/", "https://[::1]/", "https://example.com:8443/", "https://user:pass@example.com/", "file:///etc/passwd", "internal.corp"])("rejects %s before any lookup", async (url) => {
    const deps = dependencies();
    const events = await run(deps, url);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(deps.doh).not.toHaveBeenCalled();
    expect(deps.json).not.toHaveBeenCalled();
  });

  it("keeps captured snapshots immutable while later layers arrive", async () => {
    const events = await run(dependencies());
    const first = events[0];
    if (first.type !== "start") throw new Error("Unexpected start");
    expect(first.investigation.dns).toBeUndefined();
    expect(first.investigation.providers.dns.status).toBe("pending");
    expect(first.investigation.evidence.every((row) => row.source === "url")).toBe(true);
    expect(final(events).dns?.records.length).toBeGreaterThan(0);
  });

  it("keeps live DNS when registry enrichment is unavailable", async () => {
    const base = dependencies();
    const deps = dependencies({ doh: vi.fn(async (name, type, signal) => {
      if (name !== "example.com") throw new Error("Registry timed out");
      return base.doh(name, type, signal);
    }) });
    const i = final(await run(deps));
    expect(i.dns?.addresses).toEqual(["1.1.1.1"]);
    expect(i.network?.addresses[0].asn).toBeUndefined();
    expect(i.technology?.infrastructure).toEqual([]);
    expect(buildTakeaway(i, false).notes.join(" ")).toContain("could not be identified");
  });

  it("uses RIPEstat only as a public-address fallback", async () => {
    const deps = dependencies({
      doh: vi.fn(async (name, type) => type === "A" ? answer(name, 1, "1.1.1.1") : empty()),
      json: vi.fn(async (url) => url.includes("network-info") ? { data: { asns: ["13335"], prefix: "1.1.1.0/24" } } : { data: { holder: "CLOUDFLARENET" } }),
    });
    const i = final(await run(deps));
    expect(i.network?.addresses[0]).toMatchObject({ asn: "AS13335", source: "RIPEstat public API" });
    expect(vi.mocked(deps.json).mock.calls.map(([url]) => url)).toEqual([
      "https://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1",
      "https://stat.ripe.net/data/as-overview/data.json?resource=AS13335",
    ]);
  });

  it("shows NXDOMAIN without pretending an HTTP request failed", async () => {
    const i = final(await run(dependencies({ doh: vi.fn(async () => ({ status: 3, statusText: "NXDOMAIN", answers: [] })) })));
    const take = buildTakeaway(i, false);
    expect(take.title).toBe("This hostname did not resolve.");
    expect(take.nextChecks[0].id).toBe("dns-name");
    expect(take.description).not.toMatch(/HTTP|server.*down/);
  });

  it("distinguishes failed address queries from a real empty answer", async () => {
    const failed = final(await run(dependencies({ doh: vi.fn(async () => { throw new Error("Failed to fetch"); }) })));
    const noRecords = final(await run(dependencies({ doh: vi.fn(async () => empty()) })));
    expect(buildTakeaway(failed, false).title).toBe("The address lookup could not be completed.");
    expect(buildTakeaway(noRecords, false).title).toBe("No public address was returned.");
    expect(failed.providers.dns.status).toBe("unavailable");
  });

  it("identifies partial DNS without recommending HTTP troubleshooting", async () => {
    const base = dependencies();
    const i = final(await run(dependencies({ doh: vi.fn(async (name, type, signal) => {
      if (type === "HTTPS") throw new Error("Resolver timeout");
      return base.doh(name, type, signal);
    }) })));
    const take = buildTakeaway(i, false);
    expect(take.nextChecks.map((check) => check.id)).toEqual(["dns-partial"]);
    expect(take.tone).toBe("neutral");
    expect(take.title).not.toMatch(/response|request|succeeded/i);
  });

  it("only enriches public records from a mixed public/private answer", async () => {
    const base = dependencies();
    const deps = dependencies({ doh: vi.fn(async (name, type, signal) => {
      const result = await base.doh(name, type, signal);
      if (type === "A") result.answers.push({ name, type: 1, data: "10.0.0.1", TTL: 1 });
      return result;
    }) });
    const i = final(await run(deps));
    expect(i.dns?.addresses).toEqual(["1.1.1.1"]);
    expect(i.dns?.records.some((row) => row.value === "10.0.0.1")).toBe(true);
    expect(vi.mocked(deps.doh).mock.calls.some(([name]) => name.includes("1.0.0.10"))).toBe(false);
    expect(buildTakeaway(i, false).notes.join(" ")).toContain("outside the public Internet");
  });

  it.each(["1.1.1.1", "[2606:4700:4700::1111]"])("keeps direct public IP %s useful without claiming DNS resolved it", async (host) => {
    const deps = dependencies();
    const i = final(await run(deps, `https://${host}/`));
    expect(vi.mocked(deps.doh).mock.calls.some(([, type]) => type === "A" || type === "AAAA")).toBe(false);
    expect(buildTakeaway(i, false).title).toBe("Public address, ready to explore.");
    expect(interpretInvestigation(i).some((item) => item.id === "finding-dns-literal")).toBe(true);
    const graph = buildInfrastructureGraph(i);
    expect(graph.edges.some((edge) => edge.id === "url-dns" || edge.id === "dns-ip")).toBe(false);
    expect(graph.edges.some((edge) => edge.id === "url-ip")).toBe(true);
    expect(graph.nodes.find((node) => node.id === "ip")?.detail).toBe("supplied directly in the URL");
  });

  it("cancels before work begins and does not emit a completed stale run", async () => {
    const deps = dependencies();
    const before = new AbortController(); before.abort();
    expect(await run(deps, "example.com", before.signal)).toEqual([]);
    expect(deps.doh).not.toHaveBeenCalled();
    const controller = new AbortController();
    const during = dependencies({ doh: vi.fn(async () => { controller.abort(); throw new DOMException("Stopped", "AbortError"); }) });
    const events = await run(during, "example.com", controller.signal);
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(during.json).not.toHaveBeenCalled();
  });

  it("bounds enrichment to four observed addresses", async () => {
    const deps = dependencies({ doh: vi.fn(async (name, type) => type === "A"
      ? { status: 0, statusText: "NOERROR", answers: Array.from({ length: 12 }, (_, n) => ({ name, type: 1, data: `1.1.1.${n + 1}`, TTL: 300 })) }
      : empty()) });
    const i = final(await run(deps));
    expect(i.dns?.addresses).toHaveLength(12);
    expect(i.network?.addresses).toHaveLength(4);
    expect(i.network?.limited).toBe(true);
    expect(vi.mocked(deps.doh).mock.calls.filter(([name]) => name.endsWith(".origin.asn.cymru.com"))).toHaveLength(4);
  });
});

describe("browser findings and exports", () => {
  it("keeps unavailable local features out of error takeaways and invented evidence", async () => {
    const i = final(await run(dependencies()));
    const take = buildTakeaway(i, false);
    expect(take).toMatchObject({ tone: "positive", title: "Public DNS records, ready to explore.", layer: "dns", nextChecks: [] });
    const findings = interpretInvestigation(i);
    for (const layer of ["http", "tls", "technology"] as const) {
      expect(findings.filter((item) => item.layer === layer)).toHaveLength(1);
      expect(findings.find((item) => item.layer === layer)).toMatchObject({ confidence: "unknown", evidenceIds: [] });
    }
    expect(JSON.stringify(findings)).not.toMatch(/No HTTP response captured|No certificate captured|analysed response carried|Detection read 0|from response evidence/);
    const overview = buildOverviewFindings(i, false);
    expect(overview).toHaveLength(5);
    expect(overview.find((item) => item.layer === "infrastructure")?.title).toContain("network records");
    const graph = buildInfrastructureGraph(i);
    for (const layer of ["http", "tls", "technology"]) expect(graph.nodes.find((node) => node.id === layer)?.label).toBe("run locally");
    expect(graph.edges.some((edge) => edge.kind === "request")).toBe(false);
    expect(graph.edges.find((edge) => edge.to === "infrastructure")).toMatchObject({ from: "network", kind: "inference" });
    expect(graph.nodes.find((node) => node.id === "infrastructure")?.status).toBe("complete");
  });

  it("exports the edition and local-only reason in JSON and marks the image scope", async () => {
    const i = final(await run(dependencies()));
    const json = JSON.parse(createReportJson(i));
    expect(json.investigation.edition).toBe("browser");
    expect(json.investigation.providers.http.reason).toBe("local-only");
    expect(json.scope.limitations[0]).toContain("No HTTP request or TLS handshake");
    expect(createReportSvg(i)).toContain("Browser edition: public DNS and network lookups only.");
    expect(createReportJson(i)).not.toMatch(/secret-value|secret-fragment/);
  });
});
