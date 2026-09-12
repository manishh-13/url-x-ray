import { describe, expect, it } from "vitest";
import type { Evidence, Investigation, ProviderId, ProviderStatus } from "@/lib/types";
import {
  buildInfrastructureGraph,
  interpretInvestigation,
  layerDisplay,
  primaryAddress,
  registrableName,
} from "@/lib/interpretation";

const NODE_IDS = ["url", "dns", "ip", "network", "tls", "http", "infrastructure", "technology"];

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
    id: "inv-1",
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
        { type: "NS", name: "example.com", value: "ns2.cloudflare.com", ttl: 86400 },
      ],
      addresses: ["203.0.113.10"],
      queryStatus: { A: "NOERROR", AAAA: "NOERROR", NS: "NOERROR" },
    },
    http: {
      hops: [
        {
          url: "https://shop.example.com/cart",
          status: 301,
          location: "https://www.shop.example.com/cart",
          headers: { server: "nginx" },
          durationMs: 40,
          address: "203.0.113.10",
        },
        {
          url: "https://www.shop.example.com/cart",
          status: 200,
          headers: { server: "nginx" },
          durationMs: 55,
          address: "203.0.113.10",
        },
      ],
      finalUrl: "https://www.shop.example.com/cart",
      finalStatus: 200,
      redirectCount: 1,
      chainComplete: true,
      headerSignals: [
        {
          name: "strict-transport-security",
          title: "HSTS",
          state: "present",
          explanation: "present",
          value: "max-age=31536000",
        },
        { name: "content-security-policy", title: "CSP", state: "absent", explanation: "absent" },
      ],
      durationMs: 95,
    },
    tls: {
      hostname: "shop.example.com",
      issuer: "CN=Example CA R3, O=Example CA",
      subject: "CN=shop.example.com",
      sans: ["shop.example.com", "*.shop.example.com"],
      validFrom: "2026-06-01T00:00:00.000Z",
      validTo: "2026-12-01T00:00:00.000Z",
      protocol: "TLSv1.3",
      fingerprint256: "AA:BB",
      authorized: true,
      chain: [{ subject: "CN=shop.example.com", issuer: "CN=Example CA R3", validTo: "2026-12-01" }],
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
          ptr: ["edge-1.example-networks.net"],
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
      evidence("ev-http-1", "http", "200 https://www.shop.example.com/cart"),
      evidence("ev-tls-1", "tls", "CN=shop.example.com"),
      evidence("ev-net-1", "network", "AS64500 203.0.113.0/24 203.0.113.10"),
      evidence("ev-tech-1", "technology", "server: nginx"),
    ],
  };
}

function ids(findings: { id: string }[]): string[] {
  return findings.map((finding) => finding.id);
}

function finding(investigation: Investigation, id: string) {
  return interpretInvestigation(investigation).find((item) => item.id === id);
}

describe("interpretInvestigation story", () => {
  it("tells the layered story from URL to inference", () => {
    const findings = interpretInvestigation(baseInvestigation());
    const list = ids(findings);
    expect(list).toContain("finding-url-target");
    expect(list).toContain("finding-dns-addresses");
    expect(list).toContain("finding-dns-nameservers");
    expect(list).toContain("finding-network-203-0-113-10");
    expect(list).toContain("finding-tls-certificate");
    expect(list).toContain("finding-http-outcome");
    expect(list).toContain("finding-http-redirects");
    expect(list).toContain("finding-http-peer");
    expect(list).toContain("finding-technology-stack");
    expect(list).toContain("finding-infrastructure-example-edge");
    expect(list).toContain("finding-history-none");
    const orders = findings.map((item) => layerDisplay(item.layer).order);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("names the parsed hostname and records query keys without values", () => {
    const target = finding(baseInvestigation(), "finding-url-target");
    expect(target?.confidence).toBe("observed");
    expect(target?.description).toContain("shop.example.com");
    expect(target?.description).toContain("ref");
    expect(target?.description).toContain("values are not stored");
  });

  it("reports the actual connected peer and its agreement with DNS", () => {
    const peer = finding(baseInvestigation(), "finding-http-peer");
    expect(peer?.title).toBe("Connected to 203.0.113.10");
    expect(peer?.description).toContain("one of the addresses this resolver returned");
  });

  it("flags a peer that was not in the DNS answers without guessing why", () => {
    const investigation = baseInvestigation();
    investigation.dns!.addresses = ["198.51.100.7"];
    const peer = finding(investigation, "finding-http-peer");
    expect(peer?.description).toContain("was not among the addresses recorded here");
    expect(peer?.description).toContain("unknown");
  });

  it("ties the address to its prefix and ASN without claiming content ownership", () => {
    const net = finding(baseInvestigation(), "finding-network-203-0-113-10");
    expect(net?.confidence).toBe("observed");
    expect(net?.description).toContain("203.0.113.0/24");
    expect(net?.description).toContain("AS64500");
    expect(net?.description).toContain("does not establish who owns or operates the content");
  });

  it("never turns registry country into a server location", () => {
    const findings = interpretInvestigation(baseInvestigation());
    const location = findings.find((item) => item.id === "finding-network-location-unknown");
    expect(location?.confidence).toBe("unknown");
    expect(location?.title).toBe("Server location not determined");
    expect(location?.description).toContain("administrative data");
    for (const item of findings) {
      expect(item.description).not.toMatch(/hosted in the (?:US|United States)/i);
      expect(item.description).not.toMatch(/located in/i);
    }
  });

  it("describes the certificate for the original hostname without security claims", () => {
    const cert = finding(baseInvestigation(), "finding-tls-certificate");
    expect(cert?.description).toContain("original hostname shop.example.com");
    expect(cert?.description).toContain("Example CA R3");
    expect(cert?.description).toContain("says nothing about who the operator is");
  });

  it("does not call an absent header a vulnerability", () => {
    const headers = finding(baseInvestigation(), "finding-http-headers");
    expect(headers?.title).toBe("1 of 2 checked headers present");
    expect(headers?.description).toContain("not a vulnerability finding");
    expect(headers?.description).toContain("not proof the site is safe");
  });

  it("states that JavaScript was not executed and absence is not proof", () => {
    const tech = finding(baseInvestigation(), "finding-technology-static-only");
    expect(tech?.confidence).toBe("observed");
    expect(tech?.description).toContain("JavaScript was not executed");
    expect(tech?.description).toContain("absence of a technology is not evidence it is missing");
  });

  it("keeps infrastructure inferences marked inferred", () => {
    const infra = finding(baseInvestigation(), "finding-infrastructure-example-edge");
    expect(infra?.confidence).toBe("inferred");
    expect(infra?.layer).toBe("infrastructure");
    expect(infra?.description).toContain("not a confirmation from the provider");
  });

  it("records the no history and single vantage point limits", () => {
    const history = finding(baseInvestigation(), "finding-history-none");
    expect(history?.description).toContain("No lookup history is retained");
    expect(history?.description).toContain("no port scan or traceroute");
  });

  it("only cites evidence ids that exist on the investigation", () => {
    const investigation = baseInvestigation();
    investigation.technology!.infrastructure[0].evidenceIds = ["ev-http-1", "ev-missing"];
    investigation.technology!.technologies[0].evidenceIds = ["ev-ghost"];
    const known = new Set(investigation.evidence.map((row) => row.id));
    for (const item of interpretInvestigation(investigation)) {
      for (const id of item.evidenceIds) expect(known.has(id)).toBe(true);
      expect(new Set(item.evidenceIds).size).toBe(item.evidenceIds.length);
    }
  });

  it("gives every finding a stable id and no duplicates", () => {
    const first = ids(interpretInvestigation(baseInvestigation()));
    const second = ids(interpretInvestigation(baseInvestigation()));
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(first.length);
  });
});

describe("DNS provider versus serving edge", () => {
  it("does not turn Cloudflare nameservers into a Cloudflare edge", () => {
    const investigation = baseInvestigation();
    investigation.technology!.infrastructure = [];
    const findings = interpretInvestigation(investigation);
    const ns = findings.find((item) => item.id === "finding-dns-nameservers");
    expect(ns?.description).toContain("cloudflare.com");
    expect(ns?.description).toContain("does not show who serves the HTTP response");
    const unconfirmed = findings.find((item) => item.id === "finding-infrastructure-unconfirmed");
    expect(unconfirmed?.confidence).toBe("unknown");
    expect(unconfirmed?.description).toContain("not who terminates the HTTP connection");
    for (const item of findings) {
      expect(item.description).not.toMatch(/served by Cloudflare/i);
      expect(item.description).not.toMatch(/behind Cloudflare/i);
    }
  });

  it("does not read AWS address registration as a hosted origin", () => {
    const investigation = baseInvestigation();
    investigation.technology!.infrastructure = [];
    investigation.network!.addresses[0].organization = "Amazon.com, Inc.";
    investigation.network!.addresses[0].asn = "AS16509";
    const findings = interpretInvestigation(investigation);
    const net = findings.find((item) => item.id === "finding-network-203-0-113-10");
    expect(net?.description).toContain("Amazon.com, Inc.");
    expect(net?.description).toContain("not a measurement of where the machine is");
    const unconfirmed = findings.find((item) => item.id === "finding-infrastructure-unconfirmed");
    expect(unconfirmed?.description).toContain("not the operator of the site or its origin");
    for (const item of findings) {
      expect(item.description).not.toMatch(/hosted on AWS/i);
      expect(item.description).not.toMatch(/runs on Amazon/i);
    }
  });

  it("derives nameserver operators from the record value, not a brand list", () => {
    expect(registrableName("ns1.cloudflare.com")).toBe("cloudflare.com");
    expect(registrableName("a.dns.example.co.uk")).toBe("example.co.uk");
    expect(registrableName("example.com")).toBe("example.com");
  });
});

describe("partial and failed investigations", () => {
  it("reports NXDOMAIN honestly and attributes nothing downstream", () => {
    const investigation = baseInvestigation();
    investigation.dns = {
      resolver: "1.1.1.1 DoH",
      records: [],
      addresses: [],
      queryStatus: { A: "NXDOMAIN", AAAA: "NXDOMAIN" },
    };
    delete investigation.http;
    delete investigation.tls;
    delete investigation.network;
    delete investigation.technology;
    investigation.providers.http = { status: "unavailable", message: "no address to connect to" };
    investigation.providers.tls = { status: "unavailable" };
    investigation.providers.network = { status: "unavailable" };
    investigation.providers.technology = { status: "unavailable" };
    const findings = interpretInvestigation(investigation);
    const list = ids(findings);
    expect(list).toContain("finding-dns-nxdomain");
    expect(list).toContain("finding-http-unavailable");
    expect(list).toContain("finding-tls-unavailable");
    expect(list).toContain("finding-network-unavailable");
    expect(list).toContain("finding-technology-unavailable");
    expect(findings.find((item) => item.id === "finding-dns-nxdomain")?.confidence).toBe("observed");
    expect(findings.find((item) => item.id === "finding-network-unavailable")?.description).toContain(
      "No address was available to look up",
    );
    const graph = buildInfrastructureGraph(investigation);
    expect(graph.edges.map((edge) => edge.id)).toEqual(["url-dns"]);
  });

  it("marks pending providers unknown rather than absent", () => {
    const investigation = baseInvestigation();
    delete investigation.dns;
    delete investigation.http;
    delete investigation.tls;
    delete investigation.network;
    delete investigation.technology;
    investigation.providers = providers({
      dns: "investigating",
      http: "pending",
      tls: "pending",
      network: "pending",
      technology: "pending",
    });
    const findings = interpretInvestigation(investigation);
    const list = ids(findings);
    expect(list).toContain("finding-dns-pending");
    expect(list).toContain("finding-http-pending");
    expect(list).toContain("finding-tls-pending");
    expect(list).toContain("finding-network-pending");
    expect(list).toContain("finding-technology-pending");
    for (const item of findings) {
      if (item.layer === "url" || item.layer === "history") continue;
      expect(item.confidence).toBe("unknown");
    }
    expect(buildInfrastructureGraph(investigation).edges).toHaveLength(0);
  });

  it("reports partial DNS answers as unknown for the failed types", () => {
    const investigation = baseInvestigation();
    investigation.dns!.queryStatus = { A: "NOERROR", AAAA: "SERVFAIL" };
    const partial = finding(investigation, "finding-dns-partial");
    expect(partial?.confidence).toBe("unknown");
    expect(partial?.description).toContain("AAAA (SERVFAIL)");
    expect(partial?.description).toContain("unknown for this run rather than absent");
  });

  it("handles a DNS answer with records but no address", () => {
    const investigation = baseInvestigation();
    investigation.dns!.addresses = [];
    investigation.dns!.records = [
      { type: "MX", name: "example.com", value: "10 mail.example.com", ttl: 300 },
    ];
    const noAddress = finding(investigation, "finding-dns-no-address");
    expect(noAddress?.confidence).toBe("unknown");
    expect(noAddress?.description).toContain("no A or AAAA answer");
  });

  it("handles a redirect chain that never finished", () => {
    const investigation = baseInvestigation();
    investigation.http!.chainComplete = false;
    investigation.http!.stoppedReason = "the redirect limit was reached";
    const incomplete = finding(investigation, "finding-http-chain-incomplete");
    expect(incomplete?.confidence).toBe("unknown");
    expect(incomplete?.description).toContain("the redirect limit was reached");
    expect(incomplete?.description).toContain("final destination of this URL is unknown");
  });

  it("explains a plaintext URL rather than inventing a TLS failure", () => {
    const investigation = baseInvestigation();
    investigation.url.scheme = "http";
    investigation.url.href = "http://shop.example.com/cart";
    delete investigation.tls;
    investigation.providers.tls = { status: "unavailable" };
    const tls = finding(investigation, "finding-tls-not-applicable");
    expect(tls?.confidence).toBe("unknown");
    expect(tls?.description).toContain("no certificate was requested");
    expect(buildInfrastructureGraph(investigation).nodes.find((n) => n.id === "tls")?.label).toBe(
      "not applicable",
    );
  });

  it("flags a certificate that does not cover the hostname and a failed chain", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=other.example.net";
    investigation.tls!.sans = ["other.example.net"];
    investigation.tls!.authorized = false;
    investigation.tls!.authorizationError = "ERR_TLS_CERT_ALTNAME_INVALID";
    const findings = interpretInvestigation(investigation);
    const coverage = findings.find((item) => item.id === "finding-tls-name-coverage");
    expect(coverage?.description).toContain("shop.example.com does not appear");
    const failed = findings.find((item) => item.id === "finding-tls-not-authorized");
    expect(failed?.description).toContain("ERR_TLS_CERT_ALTNAME_INVALID");
    expect(failed?.description).toContain("not a statement that the site is malicious");
  });

  it("accepts a wildcard certificate as covering the hostname", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=*.example.com";
    investigation.tls!.sans = ["*.example.com"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });

  it("reports truncated HTML analysis", () => {
    const investigation = baseInvestigation();
    investigation.technology!.truncated = true;
    investigation.technology!.analyzedBytes = 4096;
    const tech = finding(investigation, "finding-technology-static-only");
    expect(tech?.description).toContain("4096 bytes");
    expect(tech?.description).toContain("truncated");
  });

  it("says unknown when no technology pattern matched", () => {
    const investigation = baseInvestigation();
    investigation.technology!.technologies = [];
    investigation.technology!.infrastructure = [];
    const none = finding(investigation, "finding-technology-none");
    expect(none?.confidence).toBe("unknown");
    expect(none?.description).toContain("unknown, not a plain or custom stack");
  });
});

describe("buildInfrastructureGraph", () => {
  it("uses the stable node id set with expected layers", () => {
    const graph = buildInfrastructureGraph(baseInvestigation());
    expect(graph.nodes.map((node) => node.id)).toEqual([
      "url",
      "dns",
      "ip",
      "network",
      "tls",
      "http",
      "technology",
      "infrastructure",
    ]);
    expect(new Set(graph.nodes.map((n) => n.id))).toEqual(new Set(NODE_IDS));
    expect(graph.nodes.find((n) => n.id === "ip")?.layer).toBe("network");
    expect(graph.nodes.find((n) => n.id === "infrastructure")?.confidence).toBe("inferred");
  });

  it("builds semantically correct edges for a complete investigation", () => {
    const graph = buildInfrastructureGraph(baseInvestigation());
    const byId = new Map(graph.edges.map((edge) => [edge.id, edge]));
    expect(byId.get("url-dns")).toMatchObject({ from: "url", to: "dns", kind: "resolution" });
    expect(byId.get("dns-ip")).toMatchObject({ from: "dns", to: "ip", label: "resolves to" });
    expect(byId.get("url-http")).toMatchObject({ from: "url", to: "http", kind: "request" });
    expect(byId.get("url-tls")).toMatchObject({ from: "url", to: "tls", label: "presents" });
    expect(byId.get("http-ip")).toMatchObject({ from: "http", to: "ip", label: "connected peer" });
    expect(byId.get("ip-network")).toMatchObject({ from: "ip", to: "network", label: "announced in" });
    expect(byId.get("http-technology")).toMatchObject({ from: "http", to: "technology" });
    expect(byId.get("infer-http-infrastructure")).toMatchObject({
      to: "infrastructure",
      kind: "inference",
    });
    for (const edge of graph.edges) {
      expect(NODE_IDS).toContain(edge.from);
      expect(NODE_IDS).toContain(edge.to);
    }
  });

  it("omits dns to ip when the address did not come from DNS", () => {
    const investigation = baseInvestigation();
    investigation.dns!.addresses = [];
    investigation.dns!.records = [
      { type: "NS", name: "example.com", value: "ns1.cloudflare.com", ttl: 3600 },
    ];
    const graph = buildInfrastructureGraph(investigation);
    const edgeIds = graph.edges.map((edge) => edge.id);
    expect(edgeIds).not.toContain("dns-ip");
    expect(edgeIds).toContain("http-ip");
    expect(graph.nodes.find((node) => node.id === "ip")?.label).toBe("203.0.113.10");
    expect(graph.nodes.find((node) => node.id === "ip")?.detail).toContain("peer of the HTTP");
  });

  it("omits ip to network when registration is for a different address", () => {
    const investigation = baseInvestigation();
    investigation.network!.addresses[0].ip = "198.51.100.9";
    const graph = buildInfrastructureGraph(investigation);
    expect(graph.edges.map((edge) => edge.id)).not.toContain("ip-network");
  });

  it("counts only real relationships, never unknown placeholders", () => {
    const investigation = baseInvestigation();
    delete investigation.network;
    delete investigation.tls;
    investigation.providers.network = { status: "unavailable" };
    investigation.providers.tls = { status: "unavailable" };
    const graph = buildInfrastructureGraph(investigation);
    const edgeIds = graph.edges.map((edge) => edge.id);
    expect(edgeIds).not.toContain("ip-network");
    expect(edgeIds).not.toContain("url-tls");
    expect(graph.nodes).toHaveLength(8);
    const unknownNodes = graph.nodes.filter((node) => node.confidence === "unknown");
    expect(unknownNodes.map((node) => node.id).sort()).toEqual(["network", "tls"]);
    for (const node of unknownNodes) {
      expect(node.label).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it("keeps the graph free of invented values when everything is unknown", () => {
    const investigation = baseInvestigation();
    delete investigation.dns;
    delete investigation.http;
    delete investigation.tls;
    delete investigation.network;
    delete investigation.technology;
    investigation.evidence = [];
    investigation.providers = providers({
      dns: "unavailable",
      http: "unavailable",
      tls: "unavailable",
      network: "unavailable",
      technology: "unavailable",
    });
    const graph = buildInfrastructureGraph(investigation);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes.filter((node) => node.id !== "url").every((node) => node.confidence === "unknown")).toBe(
      true,
    );
    expect(graph.nodes.find((node) => node.id === "ip")?.label).toBe("unknown");
    expect(graph.nodes.find((node) => node.id === "network")?.label).toBe("unknown");
    expect(graph.nodes.every((node) => node.evidenceIds.length === 0)).toBe(true);
  });

  it("resolves the primary address in DNS, HTTP, registration order", () => {
    const investigation = baseInvestigation();
    expect(primaryAddress(investigation)).toMatchObject({ ip: "203.0.113.10", origin: "dns" });
    investigation.dns!.addresses = [];
    expect(primaryAddress(investigation)).toMatchObject({ origin: "http" });
    investigation.http!.hops = investigation.http!.hops.map((hop) => ({ ...hop, address: undefined }));
    expect(primaryAddress(investigation)).toMatchObject({ origin: "network" });
  });

  it("only attaches evidence ids that exist", () => {
    const investigation = baseInvestigation();
    investigation.technology!.infrastructure[0].evidenceIds = ["ev-http-1", "ev-nope"];
    const graph = buildInfrastructureGraph(investigation);
    const infra = graph.nodes.find((node) => node.id === "infrastructure");
    expect(infra?.evidenceIds).toContain("ev-http-1");
    expect(infra?.evidenceIds).not.toContain("ev-nope");
    expect(graph.edges.map((edge) => edge.id)).toContain("infer-http-infrastructure");
  });
});

describe("certificate name coverage with real provider SAN shapes", () => {
  it("accepts a SAN list carrying the DNS: type prefix", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=edge.example.net";
    investigation.tls!.sans = ["DNS:shop.example.com", "DNS:www.shop.example.com"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });

  it("accepts a prefixed wildcard SAN as covering the hostname", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=*.example.com";
    investigation.tls!.sans = ["DNS:*.example.com", "DNS:example.com"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });

  it("accepts an IP Address SAN for an IP literal URL", () => {
    const investigation = baseInvestigation();
    investigation.url.hostname = "203.0.113.10";
    investigation.tls!.hostname = "203.0.113.10";
    investigation.tls!.subject = "CN=edge.example.net";
    investigation.tls!.sans = ["IP Address:203.0.113.10", "DNS:edge.example.net"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });

  it("still flags a real mismatch and lists the SAN names without their prefixes", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=other.example.net";
    investigation.tls!.sans = ["DNS:other.example.net", "DNS:*.other.example.net"];
    const coverage = finding(investigation, "finding-tls-name-coverage");
    expect(coverage?.description).toContain("shop.example.com does not appear");
    expect(coverage?.description).toContain("other.example.net, *.other.example.net");
    expect(coverage?.description).not.toContain("DNS:");
  });

  it("prefers the SAN list over the common name when SANs are present", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=shop.example.com";
    investigation.tls!.sans = ["DNS:other.example.net"];
    const coverage = finding(investigation, "finding-tls-name-coverage");
    expect(coverage?.description).toContain("1 name");
    expect(coverage?.description).toContain("other.example.net");
  });

  it("falls back to the common name when the certificate carries no SAN", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=shop.example.com, O=Example";
    investigation.tls!.sans = [];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
    investigation.tls!.subject = "CN=other.example.net";
    expect(finding(investigation, "finding-tls-name-coverage")?.description).toContain(
      "other.example.net",
    );
  });
});

describe("DNS status wording", () => {
  it("pluralizes addresses correctly", () => {
    const investigation = baseInvestigation();
    investigation.dns!.addresses = ["203.0.113.10", "203.0.113.11"];
    expect(finding(investigation, "finding-dns-addresses")?.title).toBe(
      "2 addresses returned for shop.example.com",
    );
    expect(buildInfrastructureGraph(investigation).nodes.find((node) => node.id === "dns")?.label).toBe(
      "2 addresses",
    );
    investigation.dns!.addresses = ["203.0.113.10"];
    expect(finding(investigation, "finding-dns-addresses")?.title).toBe(
      "1 address returned for shop.example.com",
    );
  });

  it("does not report an answered question with a record count as a failure", () => {
    const investigation = baseInvestigation();
    investigation.dns!.queryStatus = {
      A: "NOERROR, 2 records",
      AAAA: "NOERROR, no records",
      TXT: "NXDOMAIN",
    };
    expect(finding(investigation, "finding-dns-partial")).toBeUndefined();
  });

  it("does not report skipped queries on an IP literal as a failure", () => {
    const investigation = baseInvestigation();
    investigation.dns!.queryStatus = { A: "not applicable", AAAA: "not applicable" };
    expect(finding(investigation, "finding-dns-partial")).toBeUndefined();
  });

  it("does not call the hostname absent when only an optional type is NXDOMAIN", () => {
    const investigation = baseInvestigation();
    investigation.dns!.addresses = [];
    investigation.dns!.records = [
      { type: "MX", name: "example.com", value: "10 mail.example.com", ttl: 300 },
    ];
    investigation.dns!.queryStatus = {
      A: "NOERROR, no records",
      AAAA: "NOERROR, no records",
      TXT: "NXDOMAIN",
      NS: "NXDOMAIN",
    };
    expect(finding(investigation, "finding-dns-nxdomain")).toBeUndefined();
    expect(finding(investigation, "finding-dns-no-address")).toBeDefined();
  });
});

describe("SAN types that are not names", () => {
  it("never treats an email SAN as covering the hostname, falling back to the common name", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=shop.example.com";
    investigation.tls!.sans = ["email:example.com"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
    investigation.tls!.subject = "CN=other.example.net";
    const coverage = finding(investigation, "finding-tls-name-coverage");
    expect(coverage?.description).toContain("shop.example.com does not appear");
    expect(coverage?.description).toContain("other.example.net");
  });

  it("never treats a URI SAN as covering the hostname", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=edge.example.net";
    investigation.tls!.sans = ["URI:shop.example.com", "URI:https://shop.example.com/"];
    const coverage = finding(investigation, "finding-tls-name-coverage");
    expect(coverage?.description).toContain("shop.example.com does not appear");
    expect(coverage?.description).toContain("edge.example.net");
  });

  it("ignores othername and DirName entries while honouring the DNS entries beside them", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=edge.example.net";
    investigation.tls!.sans = [
      "othername:shop.example.com",
      "DirName:CN=shop.example.com",
      "DNS:shop.example.com",
    ];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });

  it("flags a mismatch when the DNS SAN misses even though the common name matches", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=shop.example.com";
    investigation.tls!.sans = ["DNS:other.example.net", "email:hostmaster@example.net"];
    const coverage = finding(investigation, "finding-tls-name-coverage");
    expect(coverage?.description).toContain("shop.example.com does not appear");
    expect(coverage?.description).toContain("1 name");
    expect(coverage?.description).toContain("other.example.net");
    expect(coverage?.description).not.toContain("hostmaster");
  });

  it("uses the common name when the SAN list is blank or empty", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "CN=shop.example.com";
    investigation.tls!.sans = ["", "   "];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
    investigation.tls!.subject = "CN=other.example.net";
    expect(finding(investigation, "finding-tls-name-coverage")?.description).toContain(
      "other.example.net",
    );
  });

  it("says nothing about coverage when neither a name SAN nor a common name exists", () => {
    const investigation = baseInvestigation();
    investigation.tls!.subject = "O=Example";
    investigation.tls!.sans = ["email:hostmaster@example.net"];
    expect(finding(investigation, "finding-tls-name-coverage")).toBeUndefined();
  });
});

describe("HTTP layer when nothing was received", () => {
  /** Exactly what httpProvider returns when no hop completed: no hops, status 0. */
  function noResponseInvestigation(): Investigation {
    const investigation = baseInvestigation();
    investigation.http = {
      hops: [],
      finalUrl: "https://shop.example.com/cart",
      finalStatus: 0,
      redirectCount: 0,
      chainComplete: false,
      stoppedReason: "shop.example.com could not be resolved, so no connection was attempted.",
      headerSignals: [
        {
          name: "strict-transport-security",
          title: "HSTS",
          state: "unknown",
          explanation: "not determined",
        },
        { name: "content-security-policy", title: "CSP", state: "unknown", explanation: "not determined" },
      ],
      durationMs: 12,
    };
    investigation.providers.http = {
      status: "unavailable",
      message: "shop.example.com could not be resolved, so no connection was attempted.",
    };
    return investigation;
  }

  it("reports the layer unavailable with the recorded reason", () => {
    const investigation = noResponseInvestigation();
    const list = ids(interpretInvestigation(investigation));
    expect(list).toContain("finding-http-unavailable");
    expect(list).not.toContain("finding-http-outcome");
    expect(list).not.toContain("finding-http-chain-incomplete");
    expect(list).not.toContain("finding-http-redirects");
    expect(list).not.toContain("finding-http-headers");
    const unavailable = finding(investigation, "finding-http-unavailable");
    expect(unavailable?.confidence).toBe("unknown");
    expect(unavailable?.description).toContain("could not be resolved");
  });

  it("uses the stopped reason when the provider recorded no message", () => {
    const investigation = noResponseInvestigation();
    investigation.providers.http = { status: "unavailable" };
    expect(finding(investigation, "finding-http-unavailable")?.description).toContain(
      "no connection was attempted",
    );
  });

  it("never invents an observed status 0 or a request edge in the graph", () => {
    const graph = buildInfrastructureGraph(noResponseInvestigation());
    const node = graph.nodes.find((item) => item.id === "http");
    expect(node?.label).toBe("unknown");
    expect(node?.detail).toBe("no response captured");
    expect(node?.confidence).toBe("unknown");
    expect(graph.edges.map((edge) => edge.id)).not.toContain("url-http");
    expect(graph.edges.map((edge) => edge.id)).not.toContain("http-technology");
  });

  it("still reports a real response that stopped mid chain as an incomplete chain", () => {
    const investigation = baseInvestigation();
    investigation.http!.chainComplete = false;
    investigation.http!.stoppedReason = "the redirect limit was reached";
    const list = ids(interpretInvestigation(investigation));
    expect(list).toContain("finding-http-outcome");
    expect(list).toContain("finding-http-chain-incomplete");
    expect(list).not.toContain("finding-http-unavailable");
  });
});
