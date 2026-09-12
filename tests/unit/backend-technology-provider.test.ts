import { describe, expect, it } from "vitest";
import {
  HEADER_RULES,
  INFRASTRUCTURE_HEADER_RULES,
  MARKUP_RULES,
  technologyProvider,
  type TechnologyProviderInput,
} from "@/lib/server/providers/technology";
import { EvidenceLedger, runProvider, type ProviderContext } from "@/lib/server/provider";
import { createDeps } from "@/lib/server/deps";
import { parseTargetUrl } from "@/lib/server/url-parser";

const clock = () => new Date("2026-09-12T04:30:00.000Z");

const context = (): ProviderContext => {
  const parsed = parseTargetUrl("https://example.com/");
  if (!parsed.ok) throw new Error(parsed.message);
  return {
    url: parsed.url,
    target: parsed.target,
    signal: new AbortController().signal,
    now: clock,
    deps: createDeps({ now: clock }),
    evidence: new EvidenceLedger(clock),
  };
};

const input = (overrides: Partial<TechnologyProviderInput> = {}): TechnologyProviderInput => ({
  headers: {},
  html: "",
  htmlBytes: 0,
  htmlTruncated: false,
  networkFacts: [],
  ...overrides,
});

const run = async (overrides: Partial<TechnologyProviderInput> = {}) => {
  const ctx = context();
  const outcome = await runProvider(technologyProvider, ctx, input(overrides));
  return { ctx, data: outcome.data?.technology, state: outcome.state };
};

describe("technology detection from headers", () => {
  it("detects server software from the Server header", async () => {
    const { data } = await run({ headers: { server: "nginx/1.24.0" } });
    const nginx = data?.technologies.find((entry) => entry.name === "nginx");
    expect(nginx?.confidence).toBe("observed");
    expect(nginx?.category).toBe("Backend");
    expect(nginx?.evidenceIds.length).toBeGreaterThan(0);
  });

  it("cites the exact header it read as evidence", async () => {
    const { ctx, data } = await run({ headers: { "x-powered-by": "Express" } });
    const express = data?.technologies.find((entry) => entry.name === "Express");
    const cited = ctx.evidence.snapshot().find((item) => item.id === express?.evidenceIds[0]);
    expect(cited?.source).toBe("http");
    expect(cited?.label).toBe("Response header x-powered-by");
    expect(cited?.value).toBe("Express");
    expect(cited?.observedAt).toBe(clock().toISOString());
  });

  it("treats a vendor edge header as infrastructure with cited evidence", async () => {
    const { ctx, data } = await run({ headers: { "cf-ray": "8a1b2c3d4e5f-LHR", server: "cloudflare" } });
    const cloudflare = data?.infrastructure.find((entry) => entry.name === "Cloudflare");
    expect(cloudflare?.confidence).toBe("inferred");
    expect(cloudflare?.evidenceIds.length).toBeGreaterThanOrEqual(2);
    for (const id of cloudflare?.evidenceIds ?? []) {
      expect(ctx.evidence.snapshot().some((item) => item.id === id)).toBe(true);
    }
  });

  it("marks a convention only header as inferred", async () => {
    const { data } = await run({ headers: { "x-runtime": "0.041" } });
    expect(data?.technologies.find((entry) => entry.name === "Ruby on Rails")?.confidence).toBe("inferred");
  });

  it("ignores a header whose value does not match the rule", async () => {
    const { data } = await run({ headers: { server: "my-own-server/1.0" } });
    expect(data?.technologies).toEqual([]);
  });
});

describe("technology detection from markup", () => {
  it("detects Next.js from its serialized payload script", async () => {
    const html = '<html><body><script id="__NEXT_DATA__" type="application/json">{}</script></body></html>';
    const { data } = await run({ html, htmlBytes: html.length });
    const next = data?.technologies.find((entry) => entry.name === "Next.js");
    expect(next?.confidence).toBe("observed");
    expect(next?.category).toBe("Frontend");
  });

  it("detects a CMS from a generator meta tag", async () => {
    const html = '<meta name="generator" content="WordPress 6.5" />';
    const { data } = await run({ html, htmlBytes: html.length });
    expect(data?.technologies.map((entry) => entry.name)).toContain("WordPress");
  });

  it("detects analytics only from a concrete script reference", async () => {
    const html = '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-XYZ"></script>';
    const { data } = await run({ html, htmlBytes: html.length });
    const gtm = data?.technologies.find((entry) => entry.name === "Google Tag Manager");
    expect(gtm?.category).toBe("Analytics");
  });

  it("does not guess React from generic markup", async () => {
    const html = '<html><body><div id="root"></div><div class="app"></div></body></html>';
    const { data } = await run({ html, htmlBytes: html.length });
    expect(data?.technologies).toEqual([]);
    expect(data?.infrastructure).toEqual([]);
  });

  it("reports React only when the server renderer marker is present", async () => {
    const html = '<div data-reactroot=""><span>hi</span></div>';
    const { data } = await run({ html, htmlBytes: html.length });
    expect(data?.technologies.find((entry) => entry.name === "React")?.confidence).toBe("observed");
  });

  it("cites a markup marker without echoing the HTML", async () => {
    const html = '<html><body>secret business copy<script id="__NEXT_DATA__">{}</script></body></html>';
    const { ctx, data } = await run({ html, htmlBytes: html.length });
    const serialized = JSON.stringify({ data, evidence: ctx.evidence.snapshot() });
    expect(serialized).not.toContain("secret business copy");
    expect(serialized).toContain("__NEXT_DATA__ script");
  });

  it("reports analysed size and truncation honestly", async () => {
    const { data, state } = await run({ html: "<html></html>", htmlBytes: 900_000, htmlTruncated: true });
    expect(data?.analyzedBytes).toBe(900_000);
    expect(data?.truncated).toBe(true);
    expect(state.message).toMatch(/stopped at/);
  });
});

describe("infrastructure inference", () => {
  it("infers an operator from a network fact and cites that evidence id", async () => {
    const { data } = await run({
      networkFacts: [{ value: "AS16509 | AMAZON-02, US | 203.0.114.0/24 | US", evidenceId: "network-asn-1" }],
    });
    const aws = data?.infrastructure.find((entry) => entry.name === "Amazon Web Services");
    expect(aws?.confidence).toBe("inferred");
    expect(aws?.evidenceIds).toEqual(["network-asn-1"]);
    expect(aws?.explanation).toMatch(/announcing network/);
  });

  it("infers nothing when no operator is recognised", async () => {
    const { data } = await run({ networkFacts: [{ value: "AS64500 | UNKNOWN-NET | 203.0.114.0/24", evidenceId: "e1" }] });
    expect(data?.infrastructure).toEqual([]);
  });

  it("stays complete and says so when nothing was detected", async () => {
    const { state, data } = await run();
    expect(state.status).toBe("complete");
    expect(state.message).toBe("There was no response to analyse.");
    expect(data?.technologies).toEqual([]);
  });
});

describe("rule tables", () => {
  it("has no rule that fires without a marker", () => {
    for (const rule of [...HEADER_RULES, ...INFRASTRUCTURE_HEADER_RULES]) {
      expect(rule.header.length).toBeGreaterThan(0);
      expect(rule.explanation.length).toBeGreaterThan(0);
    }
    for (const rule of MARKUP_RULES) {
      expect(rule.marker.source.length).toBeGreaterThan(3);
      expect(rule.label.length).toBeGreaterThan(0);
    }
  });

  it("uses no em dash or en dash in any explanation", () => {
    const text = [...HEADER_RULES, ...INFRASTRUCTURE_HEADER_RULES, ...MARKUP_RULES]
      .map((rule) => rule.explanation)
      .join(" ");
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
