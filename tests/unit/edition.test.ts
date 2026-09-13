import { describe, expect, it } from "vitest";
import { createShareUrl, readSharedHostname } from "@/lib/edition";
import type { Investigation } from "@/lib/types";
import { parseTargetUrl } from "@/lib/server/url-parser";

function observation(hostname = "example.com", edition: Investigation["edition"] = "browser"): Investigation {
  const parsed = parseTargetUrl(`https://${hostname}/path?secret=discarded`);
  if (!parsed.ok) throw new Error(parsed.message);
  return { id: "shared", edition, url: parsed.url, startedAt: "2026-09-13T07:00:00.000Z", evidence: [], providers: { dns: { status: "pending" }, network: { status: "pending" }, http: { status: "pending" }, tls: { status: "pending" }, technology: { status: "pending" } } };
}

describe("base-path-safe share links", () => {
  it("uses a hostname-only query link that static Pages can serve", () => {
    const shared = createShareUrl("https://example.org", observation(), "/url-x-ray");
    expect(shared).toBe("https://example.org/url-x-ray/?host=example.com");
    expect(shared).not.toMatch(/secret|discarded|path/);
  });
  it("also supports a root-hosted static export", () => {
    expect(createShareUrl("https://example.org", observation(), "")).toBe("https://example.org/?host=example.com");
  });
  it("preserves local hostname routes and supports IPv6 shared starts", () => {
    expect(createShareUrl("http://127.0.0.1:3099", observation("example.com", "local"), "")).toBe("http://127.0.0.1:3099/xray/example.com");
    const link = createShareUrl("http://127.0.0.1:3099", observation("[2606:4700:4700::1111]", "local"), "");
    expect(readSharedHostname(new URL(link).search)).toBe("2606:4700:4700::1111");
  });
  it.each(["example.com", "www.example.com", "1.1.1.1", "2606:4700:4700::1111"])("accepts public shared hostname %s", (host) => {
    expect(readSharedHostname(`?host=${encodeURIComponent(host)}`)).toBe(host);
  });
  it.each(["", "localhost", "127.0.0.1", "::1", "example.com/path", "example.com?token=secret", "https://example.com", "example.com:443", "user@example.com", "example.com#secret", "example.com\\private", "example.com private", "internal.corp"])("rejects unsafe or non-host shared entry %s", (host) => {
    expect(readSharedHostname(`?host=${encodeURIComponent(host)}`)).toBeUndefined();
  });
});
