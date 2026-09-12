import { describe, expect, it } from "vitest";
import { dnsProvider } from "@/lib/server/providers/dns";
import { EvidenceLedger, runProvider, type ProviderContext } from "@/lib/server/provider";
import { createDeps, type BackendDeps } from "@/lib/server/deps";
import { parseTargetUrl } from "@/lib/server/url-parser";
import type { DohAnswer, DohQuery, DohResult } from "@/lib/server/doh";
import { DNS_QUERY_TYPES, decodeTxt, reverseName4, reverseNibbles6, normalizeDohPayload } from "@/lib/server/doh";

const clock = () => new Date("2026-09-12T04:30:00.000Z");

type TableEntry = { status?: number; answers?: DohAnswer[] } | Error;

export const fakeDoh = (table: Record<string, TableEntry>, calls: string[] = []): DohQuery =>
  async (name, type): Promise<DohResult> => {
    calls.push(`${name}|${type}`);
    const entry = table[`${name}|${type}`];
    if (entry instanceof Error) throw entry;
    if (!entry) return { status: 3, statusText: "NXDOMAIN", answers: [] };
    const status = entry.status ?? 0;
    const statusText = status === 0 ? "NOERROR" : status === 3 ? "NXDOMAIN" : `RCODE ${status}`;
    return { status, statusText, answers: entry.answers ?? [] };
  };

const contextFor = (url: string, overrides: Partial<BackendDeps> = {}): ProviderContext => {
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
};

const answer = (type: number, data: string, ttl = 300, name = "example.com"): DohAnswer => ({ name, type, TTL: ttl, data });

describe("doh helpers", () => {
  it("decodes quoted and chunked TXT data", () => {
    expect(decodeTxt('"v=spf1 include:_spf.example.com ~all"')).toBe("v=spf1 include:_spf.example.com ~all");
    expect(decodeTxt('"part-one" "part-two"')).toBe("part-onepart-two");
    expect(decodeTxt("bare-value")).toBe("bare-value");
  });

  it("builds reverse names", () => {
    expect(reverseName4("203.0.114.5")).toBe("5.114.0.203.in-addr.arpa");
    expect(reverseNibbles6("2606:4700:0:0:0:0:0:1").split(".")).toHaveLength(32);
  });

  it("normalizes a resolver payload defensively", () => {
    const result = normalizeDohPayload({ Status: 0, Answer: [{ name: "a.", type: 1, TTL: 60, data: "1.1.1.1" }, { junk: true }] });
    expect(result.answers).toEqual([{ name: "a", type: 1, TTL: 60, data: "1.1.1.1" }]);
    expect(normalizeDohPayload(null).status).toBe(-1);
  });
});

describe("dnsProvider", () => {
  it("queries every public record type independently", async () => {
    const calls: string[] = [];
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({ "example.com|A": { answers: [answer(1, "203.0.114.5")] } }, calls),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(calls).toEqual(DNS_QUERY_TYPES.map((type) => `example.com|${type}`));
    expect(run.state.status).toBe("complete");
    expect(run.data?.dns.addresses).toEqual(["203.0.114.5"]);
  });

  it("reports each question's own status honestly", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({
        "example.com|A": { answers: [answer(1, "203.0.114.5")] },
        "example.com|AAAA": { answers: [answer(28, "2606:4700::1111")] },
        "example.com|CAA": { status: 3 },
        "example.com|TXT": new Error("resolver refused"),
      }),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    const status = run.data?.dns.queryStatus ?? {};
    expect(status.A).toBe("NOERROR, 1 record");
    expect(status.AAAA).toBe("NOERROR, 1 record");
    expect(status.CAA).toBe("NXDOMAIN");
    expect(status.TXT).toBe("resolver refused");
    expect(status.NS).toBe("NXDOMAIN");
    expect(run.state.status).toBe("complete");
    expect(run.state.message).toContain("TXT");
  });

  it("keeps addresses that are routable and refuses the rest", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({
        "example.com|A": { answers: [answer(1, "203.0.114.5"), answer(1, "127.0.0.1"), answer(1, "169.254.169.254")] },
        "example.com|AAAA": { answers: [answer(28, "::1")] },
      }),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(run.data?.routableAddresses).toEqual([{ ip: "203.0.114.5", version: 4 }]);
    expect(run.data?.refusedAddresses.map((entry) => entry.ip)).toEqual(["127.0.0.1", "169.254.169.254", "::1"]);
    expect(run.data?.dns.addresses).toEqual(["203.0.114.5"]);
    const refusalEvidence = context.evidence.snapshot().filter((item) => item.kind === "refused-address");
    expect(refusalEvidence).toHaveLength(3);
    expect(refusalEvidence[0].explanation).toMatch(/no connection was attempted/);
  });

  it("deduplicates repeated answers", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({ "example.com|A": { answers: [answer(1, "203.0.114.5"), answer(1, "203.0.114.5")] } }),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(run.data?.routableAddresses).toHaveLength(1);
  });

  it("records evidence with a source and a timestamp for every record", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({ "example.com|MX": { answers: [answer(15, "10 mail.example.com.")] } }),
    });
    await runProvider(dnsProvider, context, undefined);
    const item = context.evidence.snapshot().find((entry) => entry.value === "10 mail.example.com");
    expect(item).toBeDefined();
    expect(item?.source).toBe("dns");
    expect(item?.confidence).toBe("observed");
    expect(item?.observedAt).toBe(clock().toISOString());
    expect(item?.explanation).toContain("Cloudflare");
  });

  it("is unavailable only when no question was answered", async () => {
    const failing: Record<string, TableEntry> = {};
    for (const type of DNS_QUERY_TYPES) failing[`example.com|${type}`] = new Error("resolver unreachable");
    const context = contextFor("https://example.com/", { doh: fakeDoh(failing) });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(run.state.status).toBe("unavailable");
    expect(run.data?.dns.records).toEqual([]);
  });

  it("skips resolution for an IP literal but still supplies the pin", async () => {
    const calls: string[] = [];
    const context = contextFor("https://1.1.1.1/", { doh: fakeDoh({}, calls) });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(calls).toEqual([]);
    expect(run.state.status).toBe("complete");
    expect(run.data?.routableAddresses).toEqual([{ ip: "1.1.1.1", version: 4 }]);
    expect(run.data?.dns.queryStatus.A).toBe("not applicable");
  });

  it("truncates a very long TXT value", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({ "example.com|TXT": { answers: [answer(16, `"${"x".repeat(900)}"`)] } }),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    const record = run.data?.dns.records.find((entry) => entry.type === "TXT");
    expect(record?.value.endsWith("...[truncated]")).toBe(true);
    expect(record?.value.length).toBeLessThan(400);
  });

  it("reports a partial answer when the name has no public address", async () => {
    const context = contextFor("https://example.com/", {
      doh: fakeDoh({ "example.com|A": { answers: [answer(1, "10.0.0.1")] } }),
    });
    const run = await runProvider(dnsProvider, context, undefined);
    expect(run.state.status).toBe("complete");
    expect(run.state.message).toMatch(/outside the public Internet/);
  });
});
