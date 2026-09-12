import { describe, expect, it } from "vitest";
import { interpretInvestigation, buildInfrastructureGraph } from "@/lib/interpretation";
import { failedDnsQueries } from "@/lib/dns-status";
import { dnsProvider } from "@/lib/server/providers/dns";
import { EvidenceLedger, runProvider, type ProviderContext } from "@/lib/server/provider";
import { createDeps, type BackendDeps } from "@/lib/server/deps";
import { parseTargetUrl } from "@/lib/server/url-parser";
import type { DohAnswer, DohQuery, DohResult } from "@/lib/server/doh";
import type { Investigation, ProviderId, ProviderState } from "@/lib/types";

const clock = () => new Date("2026-09-12T04:30:00.000Z");

type Entry = { status?: number; answers?: DohAnswer[] } | Error;

/** Injected resolver: no network is touched by any test in this file. */
const stubDoh =
  (table: Record<string, Entry>): DohQuery =>
  async (name, type): Promise<DohResult> => {
    const entry = table[`${name}|${type}`];
    if (entry instanceof Error) throw entry;
    if (!entry) return { status: 3, statusText: "NXDOMAIN", answers: [] };
    const status = entry.status ?? 0;
    const statusText = status === 0 ? "NOERROR" : status === 3 ? "NXDOMAIN" : `RCODE ${status}`;
    return { status, statusText, answers: entry.answers ?? [] };
  };

const answer = (type: number, data: string, name: string, ttl = 300): DohAnswer => ({ name, type, TTL: ttl, data });

function contextFor(url: string, overrides: Partial<BackendDeps>): ProviderContext {
  const parsed = parseTargetUrl(url);
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    url: parsed.url,
    target: parsed.target,
    signal: new AbortController().signal,
    now: clock,
    deps: createDeps({ now: clock, ...overrides }),
    evidence: new EvidenceLedger(clock),
  };
}

/** Run the real DNS provider against a stub resolver and interpret its output. */
async function investigate(url: string, table: Record<string, Entry>) {
  const context = contextFor(url, { doh: stubDoh(table) });
  const run = await runProvider(dnsProvider, context, undefined);
  const providers = {} as Record<ProviderId, ProviderState>;
  for (const id of ["dns", "http", "tls", "network", "technology"] as ProviderId[]) {
    providers[id] = id === "dns" ? run.state : { status: "unavailable" };
  }
  const investigation: Investigation = {
    id: "inv-dns",
    startedAt: clock().toISOString(),
    url: context.url,
    providers,
    dns: run.data?.dns,
    evidence: context.evidence.snapshot(),
  };
  const findings = interpretInvestigation(investigation);
  return { investigation, run, findings, ids: findings.map((item) => item.id) };
}

const byId = <T extends { id: string }>(findings: T[], id: string): T | undefined =>
  findings.find((item) => item.id === id);

describe("dnsProvider output read by the interpreter", () => {
  it("reads 'NOERROR, n records' as answered rather than failed", async () => {
    const { run, findings, ids, investigation } = await investigate("https://example.com/", {
      "example.com|A": { answers: [answer(1, "203.0.114.5", "example.com"), answer(1, "203.0.114.6", "example.com")] },
      "example.com|AAAA": { status: 0, answers: [] },
      "example.com|NS": { answers: [answer(2, "ns1.example.net", "example.com")] },
      "example.com|CNAME": { status: 0, answers: [] },
      "example.com|MX": { status: 0, answers: [] },
      "example.com|TXT": { status: 0, answers: [] },
      "example.com|CAA": { status: 0, answers: [] },
      "example.com|HTTPS": { status: 0, answers: [] },
      "example.com|SVCB": { status: 0, answers: [] },
    });
    expect(run.data?.dns.queryStatus.A).toBe("NOERROR, 2 records");
    expect(run.data?.dns.queryStatus.AAAA).toBe("NOERROR, no records");
    expect(failedDnsQueries(investigation.dns)).toEqual([]);
    expect(ids).toContain("finding-dns-addresses");
    expect(ids).not.toContain("finding-dns-partial");
    expect(ids).not.toContain("finding-dns-nxdomain");
    expect(byId(findings, "finding-dns-addresses")?.title).toBe("2 addresses returned for example.com");
  });

  it("does not read an optional type's NXDOMAIN as a hostname that does not exist", async () => {
    const { ids, findings, investigation } = await investigate("https://example.com/", {
      "example.com|A": { status: 0, answers: [] },
      "example.com|AAAA": { status: 0, answers: [] },
      "example.com|MX": { answers: [answer(15, "10 mail.example.com", "example.com")] },
    });
    expect(investigation.dns?.queryStatus.TXT).toBe("NXDOMAIN");
    expect(investigation.dns?.queryStatus.NS).toBe("NXDOMAIN");
    expect(ids).not.toContain("finding-dns-nxdomain");
    expect(ids).not.toContain("finding-dns-partial");
    expect(ids).toContain("finding-dns-no-address");
    expect(byId(findings, "finding-dns-no-address")?.confidence).toBe("unknown");
    expect(buildInfrastructureGraph(investigation).nodes.find((node) => node.id === "dns")?.label).toBe(
      "1 record, no address",
    );
  });

  it("reports NXDOMAIN when the address questions themselves say the name is absent", async () => {
    const { ids, findings, investigation } = await investigate("https://absent.example.com/", {});
    expect(investigation.dns?.queryStatus.A).toBe("NXDOMAIN");
    expect(investigation.dns?.queryStatus.AAAA).toBe("NXDOMAIN");
    expect(ids).toContain("finding-dns-nxdomain");
    expect(ids).not.toContain("finding-dns-partial");
    expect(byId(findings, "finding-dns-nxdomain")?.confidence).toBe("observed");
    expect(buildInfrastructureGraph(investigation).nodes.find((node) => node.id === "dns")?.label).toBe("NXDOMAIN");
  });

  it("treats 'not applicable' on an IP literal URL as no failure at all", async () => {
    const { ids, findings, investigation } = await investigate("https://203.0.114.5/", {});
    expect(Object.values(investigation.dns?.queryStatus ?? {})).toEqual(
      Array.from({ length: Object.keys(investigation.dns?.queryStatus ?? {}).length }, () => "not applicable"),
    );
    expect(failedDnsQueries(investigation.dns)).toEqual([]);
    expect(ids).not.toContain("finding-dns-partial");
    expect(ids).not.toContain("finding-dns-nxdomain");
    expect(byId(findings, "finding-dns-addresses")?.title).toBe("1 address returned for 203.0.114.5");
  });

  it("still reports a genuinely unanswered question as unknown for this run", async () => {
    const { ids, findings, investigation } = await investigate("https://example.com/", {
      "example.com|A": { answers: [answer(1, "203.0.114.5", "example.com")] },
      "example.com|AAAA": { status: 2 },
      "example.com|TXT": new Error("resolver refused"),
    });
    expect(failedDnsQueries(investigation.dns)).toEqual(["AAAA", "TXT"]);
    expect(ids).toContain("finding-dns-partial");
    const partial = byId(findings, "finding-dns-partial");
    expect(partial?.confidence).toBe("unknown");
    expect(partial?.description).toContain("AAAA (RCODE 2)");
    expect(partial?.description).toContain("TXT (resolver refused)");
  });
});
