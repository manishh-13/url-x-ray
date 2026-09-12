import { describe, expect, it } from "vitest";
import {
  checkContentType,
  checkSameOrigin,
  guardInvestigateRequest,
  parseInvestigateBody,
  readBoundedBody,
} from "@/lib/server/request-guard";
import { ConcurrencyGate } from "@/lib/server/gate";
import { LIMITS } from "@/lib/server/limits";

const request = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://x-ray.local/api/investigate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "x-ray.local",
      origin: "https://x-ray.local",
      ...headers,
    },
    body,
  });

describe("checkSameOrigin", () => {
  it("accepts same-origin Sec-Fetch-Site together with a matching Origin", () => {
    const headers = new Headers({
      "sec-fetch-site": "same-origin",
      origin: "https://x-ray.local",
      host: "x-ray.local",
    });
    expect(checkSameOrigin(headers, "https://x-ray.local/api").ok).toBe(true);
  });

  it("refuses any Sec-Fetch-Site that is not same-origin", () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      const headers = new Headers({ "sec-fetch-site": site, origin: "https://x-ray.local", host: "x-ray.local" });
      expect(checkSameOrigin(headers, "https://x-ray.local/api").ok, site).toBe(false);
    }
  });

  it("requires an Origin even when Sec-Fetch-Site says same-origin", () => {
    expect(checkSameOrigin(new Headers({ "sec-fetch-site": "same-origin", host: "x-ray.local" }), "https://x-ray.local/a").ok).toBe(false);
  });

  it("requires the same scheme, hostname and port", () => {
    const matching = new Headers({ origin: "https://x-ray.local:8443", host: "x-ray.local:8443", "sec-fetch-site": "same-origin" });
    expect(checkSameOrigin(matching, "https://x-ray.local:8443/api").ok).toBe(true);
    expect(checkSameOrigin(matching, "http://x-ray.local:8443/api").ok).toBe(false);
    const wrongPort = new Headers({ origin: "https://x-ray.local:8443", host: "x-ray.local", "sec-fetch-site": "same-origin" });
    expect(checkSameOrigin(wrongPort, "https://x-ray.local/api").ok).toBe(false);
    const wrongHost = new Headers({ origin: "https://x-ray.local:8443", host: "other.local:8443", "sec-fetch-site": "same-origin" });
    expect(checkSameOrigin(wrongHost, "https://other.local:8443/api").ok).toBe(false);
  });

  it("refuses a non http origin scheme", () => {
    expect(checkSameOrigin(new Headers({ origin: "chrome-extension://abc", host: "x-ray.local" }), "https://x-ray.local/a").ok).toBe(false);
  });

  it("does not trust same-origin fetch metadata with a mismatched Origin", () => {
    const headers = new Headers({ "sec-fetch-site": "same-origin", origin: "https://evil.example.net", host: "x-ray.local" });
    expect(checkSameOrigin(headers, "https://x-ray.local/api").ok).toBe(false);
  });

  it("rejects a cross origin post and a missing origin", () => {
    expect(checkSameOrigin(new Headers({ origin: "https://evil.example.net", host: "x-ray.local" }), "https://x-ray.local/a").ok).toBe(false);
    expect(checkSameOrigin(new Headers({ host: "x-ray.local" }), "https://x-ray.local/a").ok).toBe(false);
    expect(checkSameOrigin(new Headers({ origin: "null", host: "x-ray.local" }), "https://x-ray.local/a").ok).toBe(false);
  });

  it("returns 403 rather than leaking which check failed", () => {
    const outcome = checkSameOrigin(new Headers({ "sec-fetch-site": "cross-site", host: "x-ray.local" }), "https://x-ray.local/a");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(403);
  });
});

describe("checkContentType", () => {
  it("requires application/json", () => {
    expect(checkContentType(new Headers({ "content-type": "application/json; charset=utf-8" })).ok).toBe(true);
    for (const type of ["text/plain", "multipart/form-data", "application/x-www-form-urlencoded", ""]) {
      const outcome = checkContentType(new Headers(type ? { "content-type": type } : {}));
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.status).toBe(415);
    }
  });
});

describe("readBoundedBody", () => {
  it("reads a small body", async () => {
    const outcome = await readBoundedBody(request('{"url":"https://example.com"}'));
    expect(outcome.ok && outcome.value).toBe('{"url":"https://example.com"}');
  });

  it("refuses a body over the limit with 413", async () => {
    const oversized = JSON.stringify({ url: "https://example.com", padding: "a".repeat(LIMITS.maxRequestBodyBytes) });
    const outcome = await readBoundedBody(request(oversized));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(413);
  });

  it("stops a stream that exceeds the limit without buffering it all", async () => {
    let produced = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        if (produced > 1_000) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const streamed = new Request("https://x-ray.local/api/investigate", {
      method: "POST",
      headers: { "content-type": "application/json", host: "x-ray.local", origin: "https://x-ray.local" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const outcome = await readBoundedBody(streamed);
    expect(outcome.ok).toBe(false);
    expect(produced).toBeLessThan(20);
  });
});

describe("parseInvestigateBody", () => {
  it("accepts a url field and ignores extra fields", () => {
    const outcome = parseInvestigateBody('{"url":"https://example.com","extra":1}');
    expect(outcome.ok && outcome.value).toEqual({ url: "https://example.com" });
  });

  it("rejects invalid JSON, wrong shapes and missing urls", () => {
    for (const body of ["not json", "[]", "null", '"x"', "{}", '{"url":123}', '{"url":"   "}']) {
      expect(parseInvestigateBody(body).ok, body).toBe(false);
    }
  });

  it("rejects an oversized url string", () => {
    const outcome = parseInvestigateBody(JSON.stringify({ url: "https://example.com/" + "a".repeat(LIMITS.maxUrlChars) }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(413);
  });
});

describe("guardInvestigateRequest", () => {
  it("accepts a well formed same origin request", async () => {
    const outcome = await guardInvestigateRequest(request('{"url":"https://example.com"}'));
    expect(outcome.ok && outcome.value.url).toBe("https://example.com");
  });

  it("rejects cross origin before reading the body", async () => {
    const outcome = await guardInvestigateRequest(request('{"url":"https://example.com"}', { origin: "https://evil.example.net" }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.status).toBe(403);
  });
});

describe("ConcurrencyGate", () => {
  it("caps concurrent investigations and releases capacity", () => {
    const gate = new ConcurrencyGate(2, 100, 60_000, () => 0);
    const first = gate.acquire();
    const second = gate.acquire();
    expect(first.ok && second.ok).toBe(true);
    const third = gate.acquire();
    expect(third.ok).toBe(false);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
    first.release();
    expect(gate.acquire().ok).toBe(true);
  });

  it("is idempotent on release", () => {
    const gate = new ConcurrencyGate(1, 100, 60_000, () => 0);
    const lease = gate.acquire();
    lease.release();
    lease.release();
    expect(gate.inFlight).toBe(0);
  });

  it("caps requests per rolling window and recovers after it", () => {
    let now = 0;
    const gate = new ConcurrencyGate(10, 2, 1_000, () => now);
    gate.acquire().release();
    gate.acquire().release();
    const blocked = gate.acquire();
    expect(blocked.ok).toBe(false);
    now = 1_500;
    expect(gate.acquire().ok).toBe(true);
  });
});
