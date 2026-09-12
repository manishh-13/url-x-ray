import { describe, expect, it } from "vitest";
import type { Evidence, Investigation, ProviderId, ProviderStatus } from "@/lib/types";
import {
  countEvidence,
  createReportJson,
  createReportSvg,
  escapeXml,
  sanitizeInvestigation,
  sanitizeText,
} from "@/lib/export";

const HOSTILE = `"><script>alert(1)</script>&<foreignObject> '`;

function evidence(id: string, source: Evidence["source"], value: string): Evidence {
  return {
    id,
    source,
    kind: `${source}-row`,
    label: `${source} row`,
    value,
    confidence: "observed",
    observedAt: "2026-09-12T04:00:00.000Z",
  };
}

function providers(overrides: Partial<Record<ProviderId, ProviderStatus>> = {}) {
  const base: ProviderId[] = ["dns", "http", "tls", "network", "technology"];
  const out = {} as Investigation["providers"];
  for (const id of base) out[id] = { status: overrides[id] ?? "complete" };
  return out;
}

function baseInvestigation(): Investigation {
  return {
    id: "inv-42",
    startedAt: "2026-09-12T04:00:00.000Z",
    finishedAt: "2026-09-12T04:00:03.000Z",
    url: {
      href: "https://shop.example.com/cart?ref=1",
      hostname: "shop.example.com",
      scheme: "https",
      port: "",
      pathname: "/cart",
      queryKeys: ["ref"],
      hasQuery: true,
      hasFragment: false,
      display: "shop.example.com/cart",
    },
    providers: providers(),
    dns: {
      resolver: "1.1.1.1 DoH",
      records: [
        { type: "A", name: "shop.example.com", value: "203.0.113.10", ttl: 300 },
        { type: "NS", name: "example.com", value: "ns1.cloudflare.com", ttl: 86400 },
      ],
      addresses: ["203.0.113.10"],
      queryStatus: { A: "NOERROR" },
    },
    http: {
      hops: [
        {
          url: "https://shop.example.com/cart",
          status: 200,
          headers: { server: "nginx" },
          durationMs: 42,
          address: "203.0.113.10",
        },
      ],
      finalUrl: "https://shop.example.com/cart",
      finalStatus: 200,
      redirectCount: 0,
      chainComplete: true,
      headerSignals: [
        { name: "strict-transport-security", title: "HSTS", state: "present", explanation: "present" },
      ],
      durationMs: 42,
    },
    tls: {
      hostname: "shop.example.com",
      issuer: "CN=Example CA R3",
      subject: "CN=shop.example.com",
      sans: ["shop.example.com"],
      validFrom: "2026-06-01T00:00:00.000Z",
      validTo: "2026-12-01T00:00:00.000Z",
      protocol: "TLSv1.3",
      fingerprint256: "AA:BB",
      authorized: true,
      chain: [],
    },
    network: {
      addresses: [
        {
          ip: "203.0.113.10",
          version: 4,
          asn: "AS64500",
          organization: "Example Networks",
          prefix: "203.0.113.0/24",
          country: "US",
          source: "registry lookup",
          sourceUrl: "https://rdap.example.net/ip/203.0.113.10",
        },
      ],
      limited: false,
    },
    technology: {
      technologies: [
        {
          name: "nginx",
          category: "Backend",
          confidence: "observed",
          evidenceIds: ["ev-tech-1"],
          explanation: "server header",
        },
      ],
      infrastructure: [
        {
          name: "Example Edge",
          confidence: "inferred",
          evidenceIds: ["ev-http-1"],
          explanation: "A response header names the platform.",
        },
      ],
      analyzedBytes: 65536,
      truncated: false,
    },
    evidence: [
      evidence("ev-url-1", "url", "https://shop.example.com/cart"),
      evidence("ev-dns-1", "dns", "203.0.113.10"),
      evidence("ev-http-1", "http", "200 OK"),
      evidence("ev-tls-1", "tls", "CN=shop.example.com"),
      evidence("ev-net-1", "network", "AS64500 203.0.113.0/24 203.0.113.10"),
      evidence("ev-tech-1", "technology", "server: nginx"),
    ],
  };
}

describe("escaping and sanitising", () => {
  it("escapes every XML significant character", () => {
    expect(escapeXml(HOSTILE)).toBe(
      "&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&lt;foreignObject&gt; &apos;",
    );
  });

  it("strips control characters and lone surrogates", () => {
    expect(sanitizeText("a\u0000b\u0007c")).toBe("a b c");
    expect(sanitizeText("ok\uD800")).toBe("ok");
    expect(sanitizeText("line\nbreak\ttab")).toBe("line break tab");
  });

  it("caps runaway strings", () => {
    expect(sanitizeText("x".repeat(5000), 100)).toHaveLength(100);
  });

  it("drops source links that are not http or https and never invents one", () => {
    const investigation = baseInvestigation();
    investigation.evidence[1].sourceUrl = "javascript:alert(1)";
    investigation.evidence[2].sourceUrl = "https://rdap.example.net/ip/203.0.113.10";
    investigation.network!.addresses[0].sourceUrl = "data:text/html,<script>";
    const sanitized = sanitizeInvestigation(investigation);
    expect(sanitized.evidence[1]).not.toHaveProperty("sourceUrl");
    expect(sanitized.evidence[2].sourceUrl).toBe("https://rdap.example.net/ip/203.0.113.10");
    expect(sanitized.network?.addresses[0]).not.toHaveProperty("sourceUrl");
    const withoutLinks = baseInvestigation();
    withoutLinks.evidence = withoutLinks.evidence.map((row) => ({ ...row, sourceUrl: undefined }));
    withoutLinks.network!.addresses[0].sourceUrl = undefined;
    const json = JSON.parse(createReportJson(withoutLinks));
    expect(JSON.stringify(json)).not.toContain("sourceUrl");
  });
});

describe("createReportSvg", () => {
  it("renders a self contained dark poster with the brand and hostname", () => {
    const svg = createReportSvg(baseInvestigation());
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="1440"');
    expect(svg).toContain('height="1000"');
    expect(svg).toContain("#0b0b0c");
    expect(svg).toContain("#e4eea2");
    expect(svg).toContain("URL X-RAY");
    expect(svg).toContain("shop.example.com");
    expect(svg).toContain("2026-09-12T04:00:03.000Z");
  });

  it("carries the legend, evidence counts and honesty footer", () => {
    const svg = createReportSvg(baseInvestigation());
    expect(svg).toContain("OBSERVED");
    expect(svg).toContain("INFERRED");
    expect(svg).toContain("UNKNOWN");
    expect(svg).toContain("6 evidence rows");
    expect(svg).toContain("8 nodes");
    expect(svg).toContain("not determined here, never absent");
    expect(svg).toContain("No JavaScript executed");
    expect(svg).toContain("not a server location");
    expect(svg).toContain("SEMANTIC RELATIONSHIPS, NOT A NETWORK PATH");
  });

  it("uses no remote resources, no foreignObject and safe font fallbacks", () => {
    const svg = createReportSvg(baseInvestigation());
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("xlink:href");
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("url(http");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toMatch(/(?:xlink:)?href=/);
    expect(svg.match(/="https?:\/\/[^"]*"/g)).toEqual(['="http://www.w3.org/2000/svg"']);
    expect(svg).toContain("monospace");
    expect(svg).toContain("sans-serif");
  });

  it("escapes untrusted hostname, headers and inference text", () => {
    const investigation = baseInvestigation();
    investigation.url.hostname = HOSTILE;
    investigation.url.pathname = `/${HOSTILE}`;
    investigation.id = HOSTILE;
    investigation.dns!.resolver = HOSTILE;
    investigation.tls!.issuer = `CN=${HOSTILE}`;
    investigation.technology!.infrastructure[0].name = HOSTILE;
    investigation.technology!.technologies[0].name = HOSTILE;
    investigation.http!.finalUrl = `https://x/${HOSTILE}`;
    const svg = createReportSvg(investigation);
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("</script>");
    expect(svg).not.toContain("<foreignObject>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp;");
    const openTags = (svg.match(/</g) ?? []).length;
    const closeTags = (svg.match(/>/g) ?? []).length;
    expect(openTags).toBe(closeTags);
  });

  it("survives an empty and a fully pending investigation", () => {
    const empty: Investigation = {
      id: "inv-empty",
      startedAt: "2026-09-12T04:00:00.000Z",
      url: {
        href: "https://a.example",
        hostname: "a.example",
        scheme: "https",
        port: "",
        pathname: "/",
        queryKeys: [],
        hasQuery: false,
        hasFragment: false,
        display: "a.example",
      },
      providers: providers({
        dns: "pending",
        http: "pending",
        tls: "pending",
        network: "pending",
        technology: "pending",
      }),
      evidence: [],
    };
    const svg = createReportSvg(empty);
    expect(svg).toContain("0 evidence rows");
    expect(svg).toContain("unknown layers:");
    expect(svg).not.toMatch(/\b\d+\.\d+\.\d+\.\d+\b/);
    expect(svg).not.toContain("undefined");
    expect(svg).not.toContain("NaN");
  });

  it("draws one line per graph edge and no line for an absent relationship", () => {
    const investigation = baseInvestigation();
    const full = createReportSvg(investigation);
    expect(full).toContain("connected peer");
    expect(full).toContain("resolves to");
    delete investigation.network;
    investigation.providers.network = { status: "unavailable" };
    const reduced = createReportSvg(investigation);
    expect(reduced).not.toContain("announced in");
    expect(reduced).toContain("no registration captured");
  });
});

describe("createReportJson", () => {
  it("emits parsable JSON with sanitized investigation, findings and graph", () => {
    const report = JSON.parse(createReportJson(baseInvestigation()));
    expect(report.tool).toBe("URL X-RAY");
    expect(report.generatedAt).toBe("2026-09-12T04:00:03.000Z");
    expect(report.investigation.url.hostname).toBe("shop.example.com");
    expect(report.investigation.evidence).toHaveLength(6);
    expect(report.graph.nodeCount).toBe(8);
    expect(report.graph.edgeCount).toBe(report.graph.edges.length);
    expect(report.graph.nodes.map((node: { id: string }) => node.id)).toContain("infrastructure");
    expect(report.findings.length).toBeGreaterThan(8);
    expect(report.evidenceCounts).toEqual(countEvidence(baseInvestigation()));
  });

  it("keeps every finding evidence id resolvable inside the report", () => {
    const report = JSON.parse(createReportJson(baseInvestigation()));
    const known = new Set(report.investigation.evidence.map((row: { id: string }) => row.id));
    for (const finding of report.findings) {
      for (const id of finding.evidenceIds) expect(known.has(id)).toBe(true);
    }
    for (const node of report.graph.nodes) {
      for (const id of node.evidenceIds) expect(known.has(id)).toBe(true);
    }
  });

  it("states scope limitations including no history and no executed JavaScript", () => {
    const report = JSON.parse(createReportJson(baseInvestigation()));
    const scope = report.scope.limitations.join(" ");
    expect(scope).toContain("No lookup history is saved");
    expect(scope).toContain("JavaScript was not executed");
    expect(scope).toContain("no traceroute");
    expect(scope).toContain("not a measurement of where the responding server is");
    expect(scope).toContain("Unknown means not determined by this run");
    expect(report.scope.confidenceMeaning.inferred).toContain("guess");
    expect(report.investigation.technology.javascriptExecuted).toBe(false);
    expect(report.graph.note).toContain("not a network path");
  });

  it("renames the registry country field so it cannot read as a location", () => {
    const report = JSON.parse(createReportJson(baseInvestigation()));
    const address = report.investigation.network.addresses[0];
    expect(address.registryCountry).toBe("US");
    expect(address).not.toHaveProperty("country");
  });

  it("does not leak query parameter values", () => {
    const investigation = baseInvestigation();
    investigation.url.href = "https://shop.example.com/cart?ref=secret-token";
    investigation.url.display = "shop.example.com/cart";
    const report = JSON.parse(createReportJson(investigation));
    expect(report.investigation.url.queryKeys).toEqual(["ref"]);
    expect(JSON.stringify(report.findings)).not.toContain("secret-token");
  });

  it("is stable across calls for the same investigation", () => {
    expect(createReportJson(baseInvestigation())).toBe(createReportJson(baseInvestigation()));
  });

  it("keeps hostile text as data, not markup", () => {
    const investigation = baseInvestigation();
    investigation.url.hostname = HOSTILE;
    const report = JSON.parse(createReportJson(investigation));
    expect(report.investigation.url.hostname).toBe(HOSTILE.replace(/\s+/g, " "));
    expect(typeof report.investigation.url.hostname).toBe("string");
  });
});
