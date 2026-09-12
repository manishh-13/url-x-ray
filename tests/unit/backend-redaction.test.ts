import { describe, expect, it } from "vitest";
import {
  displayUrl,
  isSensitiveHeader,
  queryKeysOf,
  redactSearch,
  redactUrl,
  redactUrlsInText,
  sanitizeResponseHeaders,
  truncate,
} from "@/lib/server/redact";
import { LIMITS } from "@/lib/server/limits";

describe("query redaction", () => {
  it("keeps keys and never values", () => {
    expect(queryKeysOf("?token=abc&id=7&token=def")).toEqual(["token", "id"]);
    expect(redactSearch("?token=abc&id=7")).toBe("?token=[redacted]&id=[redacted]");
  });

  it("bounds the number of retained keys", () => {
    const search = "?" + Array.from({ length: 50 }, (_, index) => `k${index}=v`).join("&");
    expect(queryKeysOf(search)).toHaveLength(LIMITS.maxQueryKeys);
  });

  it("handles a query with no readable keys", () => {
    expect(redactSearch("?")).toBe("");
    expect(redactSearch("")).toBe("");
  });
});

describe("redactUrl", () => {
  it("strips credentials, redacts values and drops the fragment", () => {
    expect(redactUrl("https://user:pw@example.com/p?a=1&b=2#frag"))
      .toBe("https://example.com/p?a=[redacted]&b=[redacted]");
  });

  it("resolves a relative URL against a base", () => {
    expect(redactUrl("/callback?code=secret", "https://example.com/start"))
      .toBe("https://example.com/callback?code=[redacted]");
  });

  it("reports unparseable input instead of echoing it", () => {
    expect(redactUrl("not a url at all")).toBe("[unparseable url]");
  });
});

describe("redactUrlsInText", () => {
  it("redacts query values inside header syntax", () => {
    expect(redactUrlsInText('<https://example.com/a?token=abc>; rel="preload"'))
      .toBe('<https://example.com/a?token=[redacted]>; rel="preload"');
  });

  it("leaves text with no query untouched", () => {
    expect(redactUrlsInText("0; url=https://example.com/next")).toBe("0; url=https://example.com/next");
  });
});

describe("displayUrl", () => {
  it("hides default ports and redacts the query", () => {
    expect(displayUrl(new URL("https://example.com/a?x=secret"))).toBe("https://example.com/a?x=[redacted]");
  });
});

describe("sanitizeResponseHeaders", () => {
  it("drops every sensitive header value", () => {
    const headers = sanitizeResponseHeaders({
      "Set-Cookie": ["session=abc; HttpOnly", "tracker=xyz"],
      "set-cookie2": "legacy=1",
      Authorization: "Bearer token",
      "WWW-Authenticate": 'Basic realm="x"',
      "x-api-key": "key",
      Server: "nginx",
    });
    expect(headers).toEqual({ server: "nginx" });
    expect(JSON.stringify(headers)).not.toContain("abc");
  });

  it("redacts the query of a Location header", () => {
    const headers = sanitizeResponseHeaders(
      { Location: "/cb?code=super-secret&state=xyz" },
      "https://example.com/start",
    );
    expect(headers.location).toBe("https://example.com/cb?code=[redacted]&state=[redacted]");
    expect(headers.location).not.toContain("super-secret");
  });

  it("bounds header count and value length", () => {
    const raw: Record<string, string> = {};
    for (let index = 0; index < 200; index += 1) raw[`x-h${index}`] = "v";
    raw["x-long"] = "a".repeat(5_000);
    const headers = sanitizeResponseHeaders(raw);
    expect(Object.keys(headers).length).toBeLessThanOrEqual(LIMITS.maxHeadersPerHop);
    const long = sanitizeResponseHeaders({ "x-long": "a".repeat(5_000) })["x-long"];
    expect(long.length).toBeLessThan(5_000);
    expect(long.endsWith("...[truncated]")).toBe(true);
  });

  it("lowercases names and joins repeated values", () => {
    expect(sanitizeResponseHeaders({ Vary: ["Accept", "Origin"] })).toEqual({ vary: "Accept, Origin" });
  });

  it("identifies sensitive headers case insensitively", () => {
    expect(isSensitiveHeader("Set-Cookie")).toBe(true);
    expect(isSensitiveHeader("server")).toBe(false);
  });

  it("truncates with an explicit marker", () => {
    expect(truncate("abcdef", 3)).toBe("abc...[truncated]");
  });
});
