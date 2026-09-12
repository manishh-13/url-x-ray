import { describe, expect, it } from "vitest";
import { buildHeaderSignals, httpProvider, type HttpProviderInput } from "@/lib/server/providers/http";
import { EvidenceLedger, runProvider, type ProviderContext } from "@/lib/server/provider";
import { createDeps, type BackendDeps } from "@/lib/server/deps";
import { parseTargetUrl } from "@/lib/server/url-parser";
import { LIMITS } from "@/lib/server/limits";
import { pinnedLookup, type HttpTransport, type PinnedRequest, type PinnedResponse } from "@/lib/server/transport";
import type { DohAnswer, DohQuery } from "@/lib/server/doh";

const clock = () => new Date("2026-09-12T04:30:00.000Z");

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

interface FakeHop {
  status?: number;
  headers?: Record<string, string | string[]>;
  body?: string;
  contentType?: string;
  peerAddress?: string;
  error?: string;
}

const transportFor = (
  table: Record<string, FakeHop>,
  seen: PinnedRequest[] = [],
): HttpTransport => async (request): Promise<PinnedResponse> => {
  seen.push(request);
  const url = `${request.scheme}://${request.hostname}${request.path}`;
  const hop = table[url] ?? table["*"];
  if (!hop) throw new Error(`no fake response for ${url}`);
  if (hop.error) throw new Error(hop.error);
  const headers: Record<string, string | string[] | undefined> = { ...hop.headers };
  if (hop.body !== undefined) headers["content-type"] = hop.contentType ?? "text/html; charset=utf-8";
  return {
    status: hop.status ?? 200,
    statusMessage: "OK",
    httpVersion: "1.1",
    rawHeaders: headers,
    peerAddress: hop.peerAddress ?? request.pinnedIp,
    peerPort: request.port,
    bodyText: hop.body ?? "",
    bodyBytes: hop.body ? Buffer.byteLength(hop.body) : 0,
    bodyTruncated: false,
    bodyRead: hop.body !== undefined,
    durationMs: 12,
    tlsProtocol: request.scheme === "https" ? "TLSv1.3" : undefined,
    tlsAuthorized: request.scheme === "https" ? true : undefined,
  };
};

const dohFor = (table: Record<string, DohAnswer[]>, calls: string[] = []): DohQuery =>
  async (name, type) => {
    calls.push(`${name}|${type}`);
    const answers = table[`${name}|${type}`] ?? [];
    return { status: answers.length > 0 ? 0 : 3, statusText: answers.length > 0 ? "NOERROR" : "NXDOMAIN", answers };
  };

const a = (data: string): DohAnswer => ({ name: "n", type: 1, TTL: 60, data });
const publicInput = (ip = "203.0.114.5"): HttpProviderInput => ({
  addresses: [{ ip, version: 4 }],
  refused: [],
  dnsAnswered: true,
});

describe("httpProvider pinning", () => {
  it("pins the socket to the validated address and reports the connected peer", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/page", {
      http: transportFor({ "https://example.com/page": { body: "<html></html>" } }, seen),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen).toHaveLength(1);
    expect(seen[0].pinnedIp).toBe("203.0.114.5");
    expect(seen[0].hostname).toBe("example.com");
    expect(run.data?.http.hops[0].address).toBe("203.0.114.5");
    expect(run.data?.http.chainComplete).toBe(true);
    expect(run.state.status).toBe("complete");
  });

  it("never sends a query string or fragment in the request line", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/search?q=private#frag", {
      http: transportFor({ "https://example.com/search": { body: "<html></html>" } }, seen),
    });
    await runProvider(httpProvider, context, publicInput());
    expect(seen[0].path).toBe("/search");
    expect(JSON.stringify(seen)).not.toContain("private");
    expect(JSON.stringify(seen)).not.toContain("frag");
  });

  it("records the privacy note as evidence", async () => {
    const context = contextFor("https://example.com/", {
      http: transportFor({ "*": { body: "<html></html>" } }),
    });
    await runProvider(httpProvider, context, publicInput());
    const note = context.evidence.snapshot().find((item) => item.kind === "privacy");
    expect(note?.value).toMatch(/GET only/);
    expect(note?.value).toMatch(/no cookies/);
  });

  it("refuses to connect when the name resolves to any non routable address", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/", { http: transportFor({ "*": { body: "<html></html>" } }, seen) });
    const run = await runProvider(httpProvider, context, {
      addresses: [{ ip: "203.0.114.5", version: 4 }],
      refused: [{ ip: "169.254.169.254", reason: "linkLocal address" }],
      dnsAnswered: true,
    });
    expect(seen).toHaveLength(0);
    expect(run.state.status).toBe("unavailable");
    expect(run.data?.http.stoppedReason).toMatch(/linkLocal/);
    const blocked = context.evidence.snapshot().find((item) => item.kind === "blocked");
    expect(blocked?.explanation).toMatch(/never contacted/);
  });

  it("is unavailable with no request when there is no public address", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/", { http: transportFor({ "*": {} }, seen) });
    const run = await runProvider(httpProvider, context, { addresses: [], refused: [], dnsAnswered: true });
    expect(seen).toHaveLength(0);
    expect(run.state.status).toBe("unavailable");
    expect(run.data?.http.stoppedReason).toMatch(/no public A or AAAA record/);
  });

  it("discards a response that landed on a non routable peer", async () => {
    const context = contextFor("https://example.com/", {
      http: transportFor({ "*": { body: "<html></html>", peerAddress: "127.0.0.1" } }),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(run.data?.http.hops).toHaveLength(0);
    expect(run.data?.http.stoppedReason).toMatch(/loopback/);
  });
});

describe("httpProvider redirects", () => {
  it("revalidates and re-pins every destination", async () => {
    const seen: PinnedRequest[] = [];
    const dohCalls: string[] = [];
    const context = contextFor("https://example.com/", {
      http: transportFor({
        "https://example.com/": { status: 301, headers: { location: "https://cdn.other-site.net/final" } },
        "https://cdn.other-site.net/final": { body: "<html></html>" },
      }, seen),
      doh: dohFor({ "cdn.other-site.net|A": [a("198.51.101.9")] }, dohCalls),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen.map((entry) => entry.pinnedIp)).toEqual(["203.0.114.5", "198.51.101.9"]);
    expect(dohCalls).toEqual(["cdn.other-site.net|A", "cdn.other-site.net|AAAA"]);
    expect(run.data?.http.redirectCount).toBe(1);
    expect(run.data?.http.finalUrl).toBe("https://cdn.other-site.net/final");
    expect(run.data?.http.chainComplete).toBe(true);
  });

  it("blocks a redirect to a private address before any I/O", async () => {
    for (const location of [
      "http://127.0.0.1:80/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/",
      "http://10.0.0.7/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://localhost/",
      "https://user:pass@example.com/",
      "https://example.com:8443/",
    ]) {
      const seen: PinnedRequest[] = [];
      const context = contextFor("https://example.com/", {
        http: transportFor({
          "https://example.com/": { status: 302, headers: { location } },
          "*": { body: "<html>should never be fetched</html>" },
        }, seen),
      });
      const run = await runProvider(httpProvider, context, publicInput());
      expect(seen, location).toHaveLength(1);
      expect(run.data?.http.stoppedReason, location).toMatch(/Redirect refused before any connection/);
      expect(run.data?.http.chainComplete).toBe(false);
    }
  });

  it("blocks a rebinding redirect where the new name mixes public and private answers", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/", {
      http: transportFor({
        "https://example.com/": { status: 302, headers: { location: "https://rebind.example-target.net/" } },
        "*": { body: "<html>should never be fetched</html>" },
      }, seen),
      doh: dohFor({
        "rebind.example-target.net|A": [a("198.51.101.9"), a("127.0.0.1")],
      }),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen).toHaveLength(1);
    expect(run.data?.http.stoppedReason).toMatch(/loopback/);
  });

  it("does not follow a redirect to a name that cannot be resolved", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/", {
      http: transportFor({
        "https://example.com/": { status: 302, headers: { location: "https://missing.example-target.net/" } },
        "*": { body: "<html></html>" },
      }, seen),
      doh: dohFor({}),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen).toHaveLength(1);
    expect(run.data?.http.stoppedReason).toMatch(/no public A or AAAA record|could not be resolved/);
  });

  it("detects a redirect loop", async () => {
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/a", {
      http: transportFor({
        "https://example.com/a": { status: 302, headers: { location: "/b" } },
        "https://example.com/b": { status: 302, headers: { location: "/a" } },
      }, seen),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen).toHaveLength(2);
    expect(run.data?.http.stoppedReason).toMatch(/already visited/);
  });

  it("stops at the redirect limit", async () => {
    const table: Record<string, FakeHop> = {};
    for (let index = 0; index < 20; index += 1) {
      table[`https://example.com/${index}`] = { status: 302, headers: { location: `/${index + 1}` } };
    }
    const seen: PinnedRequest[] = [];
    const context = contextFor("https://example.com/0", { http: transportFor(table, seen) });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(seen).toHaveLength(LIMITS.maxRedirects + 1);
    expect(run.data?.http.stoppedReason).toMatch(new RegExp(`after ${LIMITS.maxRedirects} redirects`));
    expect(run.data?.http.redirectCount).toBe(LIMITS.maxRedirects);
  });

  it("redacts the query of a Location header everywhere it appears", async () => {
    const context = contextFor("https://example.com/start", {
      http: transportFor({
        "https://example.com/start": { status: 302, headers: { location: "/cb?code=super-secret&state=xyz" } },
        "https://example.com/cb": { body: "<html></html>" },
      }),
      doh: dohFor({}),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    const serialized = JSON.stringify({ http: run.data?.http, evidence: context.evidence.snapshot() });
    expect(serialized).not.toContain("super-secret");
    expect(run.data?.http.hops[0].location).toBe("https://example.com/cb?code=[redacted]&state=[redacted]");
    expect(run.data?.http.hops[1].url).toBe("https://example.com/cb");
  });
});

describe("httpProvider response handling", () => {
  it("never returns cookies or credential headers", async () => {
    const context = contextFor("https://example.com/", {
      http: transportFor({
        "*": {
          body: "<html></html>",
          headers: {
            "set-cookie": ["session=secret-value; HttpOnly", "id=2"],
            "www-authenticate": 'Basic realm="private"',
            server: "nginx",
          },
        },
      }),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    const serialized = JSON.stringify(run.data?.http);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("set-cookie");
    expect(run.data?.http.hops[0].headers.server).toBe("nginx");
  });

  it("keeps the HTML in artifacts only, never in the snapshot", async () => {
    const html = "<html><body>page text</body></html>";
    const context = contextFor("https://example.com/", { http: transportFor({ "*": { body: html } }) });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(run.data?.artifacts.html).toBe(html);
    expect(JSON.stringify(run.data?.http)).not.toContain("page text");
  });

  it("reports a transport failure as an unavailable layer with no hops", async () => {
    const context = contextFor("https://example.com/", { http: transportFor({ "*": { error: "socket hang up" } }) });
    const run = await runProvider(httpProvider, context, publicInput());
    expect(run.state.status).toBe("unavailable");
    expect(run.state.message).toBe("socket hang up");
    expect(run.data?.http.hops).toEqual([]);
  });

  it("notes when the connected address differs from the pinned answer", async () => {
    const context = contextFor("https://example.com/", {
      http: transportFor({ "*": { body: "<html></html>", peerAddress: "198.51.101.9" } }),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    const mismatch = context.evidence.snapshot().find((item) => item.kind === "peer-mismatch");
    expect(mismatch?.value).toBe("pinned 203.0.114.5, connected 198.51.101.9");
    expect(run.data?.http.hops[0].address).toBe("198.51.101.9");
  });

  it("summarizes security headers of the final response", async () => {
    const context = contextFor("https://example.com/", {
      http: transportFor({
        "*": { body: "<html></html>", headers: { "strict-transport-security": "max-age=63072000" } },
      }),
    });
    const run = await runProvider(httpProvider, context, publicInput());
    const signals = run.data?.http.headerSignals ?? [];
    expect(signals.find((signal) => signal.name === "strict-transport-security")?.state).toBe("present");
    expect(signals.find((signal) => signal.name === "content-security-policy")?.state).toBe("absent");
  });

  it("marks signals unknown when no final response was received", () => {
    expect(buildHeaderSignals(undefined).every((signal) => signal.state === "unknown")).toBe(true);
  });
});

describe("pinnedLookup", () => {
  it("answers with the pinned address in both callback shapes", () => {
    const lookup = pinnedLookup("203.0.114.5", 4);
    let single: unknown[] = [];
    lookup("example.com", {}, (...args) => { single = args; });
    expect(single).toEqual([null, "203.0.114.5", 4]);
    let all: unknown[] = [];
    lookup("example.com", { all: true }, (...args) => { all = args; });
    expect(all).toEqual([null, [{ address: "203.0.114.5", family: 4 }]]);
  });
});
