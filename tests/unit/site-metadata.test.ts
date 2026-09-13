import { describe, expect, it } from "vitest";
import { createSiteMetadata } from "@/lib/site-metadata";
import { siteOriginFromEnv } from "../../scripts/site-origin.mjs";

describe("hosted sharing metadata", () => {
  it.each([
    ["https://manishh-13.github.io", "/url-x-ray"],
    ["https://example.org", ""],
    ["https://example.org", "/tools/xray"],
  ])("keeps every social URL on %s%s", (siteOrigin, basePath) => {
    const canonical = `${siteOrigin}${basePath}/`;
    const image = `${canonical}social-preview.png`;
    const metadata = createSiteMetadata({ browserEdition: true, basePath, siteOrigin });
    expect(metadata).toMatchObject({
      robots: { index: true, follow: true },
      icons: { icon: `${basePath}/icon.svg` },
      alternates: { canonical },
      openGraph: { type: "website", url: canonical, images: [{ url: image, width: 1200, height: 630 }] },
      twitter: { card: "summary_large_image", images: [{ url: image }] },
    });
    expect(metadata.description).toContain("in your browser");
    expect(JSON.stringify(metadata)).not.toMatch(/localhost|127\.0\.0\.1|\?host=|api\/investigate/);
  });

  it("keeps the local edition unindexed and without public social metadata", () => {
    const metadata = createSiteMetadata({ browserEdition: false, basePath: "", siteOrigin: "https://example.org" });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.openGraph).toBeUndefined();
    expect(metadata.twitter).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
    expect(metadata.metadataBase).toBeUndefined();
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("public deployment origin", () => {
  it("defaults to this project’s Pages origin", () => {
    expect(siteOriginFromEnv({})).toBe("https://manishh-13.github.io");
  });
  it.each(["https://example.org", "https://example.org/", "https://example.org:8443"])("accepts HTTPS origin %s", (origin) => {
    expect(siteOriginFromEnv({ PAGES_SITE_ORIGIN: origin })).toBe(new URL(origin).origin);
  });
  it.each(["", "not a url", "http://example.org", "javascript:alert(1)", "https://user:password@example.org", "https://example.org/path", "https://example.org?host=example.com", "https://example.org#fragment"])("rejects a non-origin value %s", (origin) => {
    expect(() => siteOriginFromEnv({ PAGES_SITE_ORIGIN: origin })).toThrow("PAGES_SITE_ORIGIN");
  });
});
