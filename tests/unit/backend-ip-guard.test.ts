import { describe, expect, it } from "vitest";
import { assertGloballyRoutableIp, classifyIp, isGloballyRoutableIp } from "@/lib/server/ip-guard";

describe("classifyIp", () => {
  it("accepts globally routable addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.4.4", "203.0.114.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      const verdict = classifyIp(ip);
      expect(verdict.ok, ip).toBe(true);
      expect(verdict.range).toBe("unicast");
    }
  });

  it("reports the version and a normalized form", () => {
    expect(classifyIp("1.1.1.1").version).toBe(4);
    const six = classifyIp("2606:4700:0000::0001");
    expect(six.version).toBe(6);
    expect(six.normalized).toBe(classifyIp("2606:4700::1").normalized);
  });

  it("rejects every non global range with the range name", () => {
    const cases: [string, string][] = [
      ["127.0.0.1", "loopback"],
      ["10.1.1.1", "private"],
      ["172.31.255.255", "private"],
      ["192.168.0.1", "private"],
      ["169.254.169.254", "linkLocal"],
      ["100.64.0.1", "carrierGradeNat"],
      ["0.0.0.0", "unspecified"],
      ["224.0.0.1", "multicast"],
      ["255.255.255.255", "broadcast"],
      ["192.0.2.1", "reserved"],
      ["240.0.0.1", "reserved"],
      ["::1", "loopback"],
      ["::", "unspecified"],
      ["fe80::1", "linkLocal"],
      ["fc00::1", "uniqueLocal"],
      ["ff02::1", "multicast"],
      ["::ffff:127.0.0.1", "ipv4Mapped"],
      ["::ffff:10.0.0.1", "ipv4Mapped"],
      ["::ffff:8.8.8.8", "ipv4Mapped"],
      ["2002::1", "6to4"],
      ["2001::1", "teredo"],
      ["64:ff9b::1.1.1.1", "rfc6052"],
    ];
    for (const [ip, range] of cases) {
      const verdict = classifyIp(ip);
      expect(verdict.ok, ip).toBe(false);
      expect(verdict.range, ip).toBe(range);
    }
  });

  it("rejects an IPv4 mapped address even when it wraps a public address", () => {
    expect(isGloballyRoutableIp("::ffff:1.1.1.1")).toBe(false);
  });

  it("rejects zone scoped, empty and malformed input", () => {
    expect(classifyIp("fe80::1%eth0").ok).toBe(false);
    expect(classifyIp("").ok).toBe(false);
    expect(classifyIp("not-an-ip").range).toBe("invalid");
    expect(classifyIp("1.1.1.1.1").range).toBe("invalid");
    expect(classifyIp("999.1.1.1").range).toBe("invalid");
  });
});

describe("assertGloballyRoutableIp", () => {
  it("returns the address and version for a public address", () => {
    expect(assertGloballyRoutableIp("1.1.1.1")).toEqual({ ip: "1.1.1.1", version: 4 });
  });

  it("throws before any socket work for a non routable address", () => {
    expect(() => assertGloballyRoutableIp("169.254.169.254")).toThrow(/linkLocal/);
    expect(() => assertGloballyRoutableIp("::1")).toThrow(/loopback/);
    expect(() => assertGloballyRoutableIp("garbage")).toThrow();
  });
});
