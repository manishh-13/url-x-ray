import { describe, expect, it } from "vitest";
import type { DnsData } from "@/lib/types";
import { dnsNameDoesNotExist, dnsQueryOutcome, failedDnsQueries } from "@/lib/dns-status";

function dns(queryStatus: Record<string, string>, addresses: string[] = []): DnsData {
  return { resolver: "1.1.1.1 DoH", records: [], addresses, queryStatus };
}

describe("dnsQueryOutcome", () => {
  it("reads an answered question as success, with or without a record count", () => {
    expect(dnsQueryOutcome("NOERROR")).toBe("success");
    expect(dnsQueryOutcome("OK")).toBe("success");
    expect(dnsQueryOutcome("NOERROR, 1 record")).toBe("success");
    expect(dnsQueryOutcome("NOERROR, 2 records")).toBe("success");
    expect(dnsQueryOutcome("NOERROR, no records")).toBe("success");
    expect(dnsQueryOutcome("noerror, 12 records")).toBe("success");
  });

  it("treats NXDOMAIN as an answer, not a transport failure", () => {
    expect(dnsQueryOutcome("NXDOMAIN")).toBe("nxdomain");
    expect(dnsQueryOutcome("nxdomain")).toBe("nxdomain");
  });

  it("treats an IP literal skip as not applicable", () => {
    expect(dnsQueryOutcome("not applicable")).toBe("not-applicable");
    expect(dnsQueryOutcome("Not Applicable")).toBe("not-applicable");
  });

  it("does not invent a failure for a missing or blank status", () => {
    expect(dnsQueryOutcome(undefined)).toBe("not-applicable");
    expect(dnsQueryOutcome("")).toBe("not-applicable");
    expect(dnsQueryOutcome("   ")).toBe("not-applicable");
  });

  it("reports resolver and transport problems as unavailable", () => {
    expect(dnsQueryOutcome("SERVFAIL")).toBe("unavailable");
    expect(dnsQueryOutcome("REFUSED")).toBe("unavailable");
    expect(dnsQueryOutcome("RCODE 5")).toBe("unavailable");
    expect(dnsQueryOutcome("no answer in time")).toBe("unavailable");
    expect(dnsQueryOutcome("resolver refused")).toBe("unavailable");
  });

  it("anchors the parse instead of matching substrings", () => {
    expect(dnsQueryOutcome("NOERROR was expected but the resolver failed")).toBe("unavailable");
    expect(dnsQueryOutcome("upstream said NXDOMAIN then timed out")).toBe("unavailable");
    expect(dnsQueryOutcome("not applicable, query dropped")).toBe("unavailable");
  });
});

describe("failedDnsQueries", () => {
  it("returns nothing for answered questions, empty answers and skipped lookups", () => {
    expect(failedDnsQueries(dns({ A: "NOERROR, 2 records", AAAA: "NOERROR, no records" }))).toEqual([]);
    expect(failedDnsQueries(dns({ A: "not applicable", TXT: "not applicable" }))).toEqual([]);
    expect(failedDnsQueries(dns({ A: "NXDOMAIN", TXT: "NXDOMAIN" }))).toEqual([]);
  });

  it("ignores blank statuses rather than inventing errors", () => {
    expect(failedDnsQueries(dns({ A: "", AAAA: "   " }))).toEqual([]);
  });

  it("lists only genuinely unanswered types, in recorded order", () => {
    const value = dns({
      A: "NOERROR, 1 record",
      AAAA: "SERVFAIL",
      CAA: "NXDOMAIN",
      TXT: "no answer in time",
    });
    expect(failedDnsQueries(value)).toEqual(["AAAA", "TXT"]);
  });

  it("handles missing DNS data and a missing status map", () => {
    expect(failedDnsQueries(undefined)).toEqual([]);
    expect(failedDnsQueries({ resolver: "r", records: [], addresses: [], queryStatus: {} })).toEqual([]);
  });
});

describe("dnsNameDoesNotExist", () => {
  it("is true only when an address question itself returned NXDOMAIN", () => {
    expect(dnsNameDoesNotExist(dns({ A: "NXDOMAIN", AAAA: "NXDOMAIN" }))).toBe(true);
    expect(dnsNameDoesNotExist(dns({ A: "NXDOMAIN", AAAA: "SERVFAIL" }))).toBe(true);
    expect(dnsNameDoesNotExist(dns({ a: "NXDOMAIN" }))).toBe(true);
  });

  it("never reads an optional type's NXDOMAIN as a missing hostname", () => {
    expect(
      dnsNameDoesNotExist(
        dns({ A: "NOERROR, no records", AAAA: "NOERROR, no records", TXT: "NXDOMAIN", NS: "NXDOMAIN", CAA: "NXDOMAIN" }),
      ),
    ).toBe(false);
  });

  it("is false whenever an address was returned", () => {
    expect(dnsNameDoesNotExist(dns({ A: "NOERROR, 1 record", CAA: "NXDOMAIN" }, ["203.0.113.10"]))).toBe(false);
    expect(dnsNameDoesNotExist(dns({ A: "NXDOMAIN" }, ["203.0.113.10"]))).toBe(false);
  });

  it("is false for missing data and for an empty status map", () => {
    expect(dnsNameDoesNotExist(undefined)).toBe(false);
    expect(dnsNameDoesNotExist(dns({}))).toBe(false);
    expect(dnsNameDoesNotExist(dns({ A: "", AAAA: "" }))).toBe(false);
  });
});
