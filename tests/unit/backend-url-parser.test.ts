import { describe, expect, it } from "vitest";
import { parseRedirectTarget, parseTargetUrl, validateHostname } from "@/lib/server/url-parser";

const ok = (raw: string) => {
  const outcome = parseTargetUrl(raw);
  if (!outcome.ok) throw new Error(`expected ${raw} to be accepted, got ${outcome.code}`);
  return outcome;
};

const rejected = (raw: string) => {
  const outcome = parseTargetUrl(raw);
  if (outcome.ok) throw new Error(`expected ${raw} to be rejected`);
  return outcome;
};

describe("parseTargetUrl acceptance", () => {
  it("accepts an https URL and reports a request URL without query or fragment", () => {
    const { url, target } = ok("https://example.com/a/b?token=secret&id=7#section");
    expect(target.requestUrl).toBe("https://example.com/a/b");
    expect(target.scheme).toBe("https");
    expect(target.port).toBe(443);
    expect(url.queryKeys).toEqual(["token", "id"]);
    expect(url.hasQuery).toBe(true);
    expect(url.hasFragment).toBe(true);
  });

  it("never carries a query value in href or display", () => {
    const { url } = ok("https://example.com/search?q=my-private-term&session=abc123#frag");
    expect(url.href).not.toContain("my-private-term");
    expect(url.href).not.toContain("abc123");
    expect(url.href).not.toContain("#");
    expect(url.display).toBe("https://example.com/search?q=[redacted]&session=[redacted]");
  });

  it("defaults a bare hostname to https", () => {
    expect(ok("example.com").target.requestUrl).toBe("https://example.com/");
  });

  it("accepts plain http on port 80", () => {
    const { target } = ok("http://example.com");
    expect(target.scheme).toBe("http");
    expect(target.port).toBe(80);
  });

  it("lowercases the host and drops a trailing dot", () => {
    expect(ok("https://EXAMPLE.COM./").target.hostname).toBe("example.com");
  });

  it("accepts a globally routable IP literal", () => {
    const { target } = ok("https://1.1.1.1/");
    expect(target.isIpLiteral).toBe(true);
    expect(target.hostname).toBe("1.1.1.1");
  });

  it("normalizes a globally routable IPv6 literal and preserves URL brackets", () => {
    const { url, target } = ok("https://[2606:4700:4700::1111]/dns");
    expect(target.isIpLiteral).toBe(true);
    expect(target.hostname).toBe("2606:4700:4700::1111");
    expect(target.requestUrl).toBe("https://[2606:4700:4700::1111]/dns");
    expect(url.hostname).toBe("2606:4700:4700::1111");
  });
});

describe("parseTargetUrl rejection", () => {
  it("rejects an empty or oversized input", () => {
    expect(rejected("").code).toBe("empty");
    expect(rejected("https://example.com/" + "a".repeat(3000)).code).toBe("too_long");
  });

  it("rejects non http schemes", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html,<script>1</script>",
      "file:///etc/passwd",
      "ftp://example.com/",
      "ws://example.com/",
      "gopher://example.com/",
      "view-source:https://example.com",
    ]) {
      expect(rejected(raw).code).toBe("unsupported_scheme");
    }
  });

  it("rejects embedded credentials", () => {
    expect(rejected("https://user:pass@example.com/").code).toBe("credentials");
    expect(rejected("https://user@example.com/").code).toBe("credentials");
  });

  it("rejects nonstandard ports", () => {
    expect(rejected("https://example.com:8443/").code).toBe("nonstandard_port");
    expect(rejected("http://example.com:8080/").code).toBe("nonstandard_port");
    expect(rejected("https://example.com:80/").code).toBe("nonstandard_port");
  });

  it("rejects loopback, private, link local and special use addresses", () => {
    for (const raw of [
      "http://127.0.0.1/",
      "http://127.1/",
      "http://10.0.0.5/",
      "http://172.16.4.4/",
      "http://192.168.1.1/",
      "http://169.254.169.254/",
      "http://100.64.0.1/",
      "http://0.0.0.0/",
      "http://[::1]/",
      "http://[fe80::1]/",
      "http://[fc00::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.169.254]/",
      "http://[64:ff9b::a9fe:a9fe]/",
      "http://192.0.2.10/",
      "http://255.255.255.255/",
    ]) {
      expect(rejected(raw).code, raw).toBe("non_routable_host");
    }
  });

  it("rejects single label, local and reserved hostnames", () => {
    expect(rejected("http://localhost/").code).toBe("reserved_host");
    expect(rejected("http://metadata/").code).toBe("reserved_host");
    expect(rejected("http://intranet-box/").code).toBe("single_label_host");
    for (const raw of [
      "http://router.local/",
      "http://db.internal/",
      "http://host.corp/",
      "http://api.test/",
      "http://thing.invalid/",
      "http://site.example/",
      "http://x.onion/",
      "http://1.0.0.127.in-addr.arpa/",
    ]) {
      expect(rejected(raw).code, raw).toBe("reserved_host");
    }
  });

  it("rejects whitespace, control characters and malformed input", () => {
    expect(rejected("https://exa mple.com/").code).toBe("malformed");
    expect(rejected("https://example.com/\u0000").code).toBe("malformed");
    expect(rejected("https://").code).toBe("malformed");
  });

  it("rejects hosts with invalid labels", () => {
    expect(rejected("https://exa!mple.com/").code).toBe("invalid_host");
    expect(rejected(`https://${"a".repeat(64)}.com/`).code).toBe("invalid_host");
  });
});

describe("validateHostname", () => {
  it("classifies IP literals directly", () => {
    expect(validateHostname("8.8.8.8")).toEqual({ ok: true, isIpLiteral: true });
    expect(validateHostname("::ffff:10.0.0.1").ok).toBe(false);
  });

  it("accepts a normal multi label name", () => {
    expect(validateHostname("www.example.co.uk")).toEqual({ ok: true, isIpLiteral: false });
  });
});

describe("parseRedirectTarget", () => {
  it("resolves a relative destination against the current hop", () => {
    const outcome = parseRedirectTarget("/next/page?x=1", "https://example.com/start");
    expect(outcome.ok && outcome.target.requestUrl).toBe("https://example.com/next/page");
  });

  it("refuses a destination that leaves the public Internet", () => {
    for (const location of [
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://10.1.2.3/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://user:pass@example.com/",
      "https://example.com:9999/",
      "http://localhost/",
    ]) {
      expect(parseRedirectTarget(location, "https://example.com/").ok, location).toBe(false);
    }
  });

  it("refuses an empty destination", () => {
    expect(parseRedirectTarget("", "https://example.com/").ok).toBe(false);
  });

  it("drops the query of a redirect destination", () => {
    const outcome = parseRedirectTarget("https://cdn.other-site.net/cb?code=secret", "https://example.com/");
    expect(outcome.ok && outcome.target.requestUrl).toBe("https://cdn.other-site.net/cb");
  });
});
