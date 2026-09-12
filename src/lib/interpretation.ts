import { dnsNameDoesNotExist, failedDnsQueries } from "./dns-status";
import type {
  Confidence,
  DnsData,
  Evidence,
  Finding,
  HttpData,
  GraphEdge,
  GraphNode,
  InfrastructureGraph,
  Investigation,
  Layer,
  NetworkAddress,
  ProviderId,
  ProviderStatus,
} from "./types";

export interface LayerDisplay {
  id: Layer;
  eyebrow: string;
  title: string;
  blurb: string;
  order: number;
}

const LAYER_LIST: LayerDisplay[] = [
  {
    id: "url",
    eyebrow: "URL",
    title: "Submitted address",
    blurb: "What the URL itself states before anything is looked up.",
    order: 0,
  },
  {
    id: "dns",
    eyebrow: "DNS",
    title: "Name resolution",
    blurb: "Which records the resolver returned for the hostname.",
    order: 1,
  },
  {
    id: "network",
    eyebrow: "NETWORK",
    title: "Address registration",
    blurb: "Which prefix an address sits in and which ASN announces it.",
    order: 2,
  },
  {
    id: "tls",
    eyebrow: "TLS",
    title: "Certificate presented",
    blurb: "The certificate offered for the hostname in the URL.",
    order: 3,
  },
  {
    id: "http",
    eyebrow: "HTTP",
    title: "Request and redirects",
    blurb: "Status codes, redirect chain and response headers.",
    order: 4,
  },
  {
    id: "technology",
    eyebrow: "TECHNOLOGY",
    title: "Response fingerprints",
    blurb: "Signals read from response headers and the initial HTML.",
    order: 5,
  },
  {
    id: "infrastructure",
    eyebrow: "INFERENCE",
    title: "Inferred infrastructure",
    blurb: "Platforms suggested by evidence, never asserted as fact.",
    order: 6,
  },
  {
    id: "history",
    eyebrow: "SCOPE",
    title: "What is not covered",
    blurb: "Limits of this single, one vantage point investigation.",
    order: 7,
  },
];

export const LAYER_DISPLAY: Record<Layer, LayerDisplay> = LAYER_LIST.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<Layer, LayerDisplay>,
);

export function layerDisplay(layer: Layer): LayerDisplay {
  return LAYER_DISPLAY[layer];
}

export function confidenceLabel(confidence: Confidence): string {
  if (confidence === "observed") return "Observed";
  if (confidence === "inferred") return "Inferred";
  return "Unknown";
}

export function statusLabel(status: ProviderStatus): string {
  if (status === "pending") return "Queued";
  if (status === "investigating") return "In progress";
  if (status === "complete") return "Complete";
  return "Unavailable";
}

export function isPending(status: ProviderStatus): boolean {
  return status === "pending" || status === "investigating";
}

const MULTI_LABEL_SUFFIXES = [
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.nz",
  "co.jp",
  "co.in",
  "com.br",
  "com.mx",
  "co.za",
];

function providerState(investigation: Investigation, id: ProviderId): ProviderStatus {
  return investigation.providers?.[id]?.status ?? "pending";
}

function providerMessage(investigation: Investigation, id: ProviderId): string {
  const message = investigation.providers?.[id]?.message;
  return message && message.trim().length > 0 ? message.trim() : "";
}

function evidenceIds(
  investigation: Investigation,
  source: Evidence["source"],
  match?: (evidence: Evidence) => boolean,
): string[] {
  const rows = investigation.evidence ?? [];
  const ids: string[] = [];
  for (const row of rows) {
    if (row.source !== source) continue;
    if (match && !match(row)) continue;
    if (!ids.includes(row.id)) ids.push(row.id);
  }
  return ids;
}

function evidenceIdsMentioning(investigation: Investigation, value: string): string[] {
  if (!value) return [];
  const ids: string[] = [];
  for (const row of investigation.evidence ?? []) {
    if (row.value && row.value.includes(value) && !ids.includes(row.id)) ids.push(row.id);
  }
  return ids;
}

function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function list(values: string[], max: number): string {
  const shown = values.slice(0, max);
  const rest = values.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function plural(count: number, word: string): string {
  if (count === 1) return `${count} ${word}`;
  const suffix = /(?:s|x|z|ch|sh)$/i.test(word) ? "es" : "s";
  return `${count} ${word}${suffix}`;
}

/**
 * True only when a response actually arrived. The HTTP provider still reports a
 * snapshot when nothing was received (no hops, final status 0), and that shape
 * is an unavailable layer, not an observed status or a failed redirect chain.
 */
function httpResponseCaptured(http: HttpData | undefined): boolean {
  if (!http) return false;
  if ((http.hops ?? []).length > 0) return true;
  return (http.finalStatus ?? 0) > 0;
}

function recordsOfType(dns: DnsData | undefined, type: string) {
  return (dns?.records ?? []).filter((record) => record.type.toUpperCase() === type);
}

export function registrableName(hostname: string): string {
  const clean = hostname.replace(/\.$/, "").toLowerCase();
  const labels = clean.split(".").filter(Boolean);
  if (labels.length <= 2) return clean;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_LABEL_SUFFIXES.includes(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/** The SAN types a client checks for name coverage: "DNS:host", "IP Address:1.2.3.4". */
const COVERAGE_SAN_PREFIX = /^(?:dns|ip address|ip)\s*:\s*(.+)$/i;

/** SAN types that are never a hostname, so they can never cover the requested name. */
const NON_NAME_SAN_PREFIX = /^(?:uri|url|email|othername|dirname|registered id|rid|x400address)\s*:/i;

/**
 * The hostname or address an entry covers, or "" when the entry is not a name a
 * client would match. An entry with no type prefix is already a bare name, which
 * keeps hand written fixtures and IPv6 literals working.
 */
function sanName(raw: string): string {
  const entry = raw.trim();
  const covered = COVERAGE_SAN_PREFIX.exec(entry);
  if (covered) return covered[1].trim();
  if (NON_NAME_SAN_PREFIX.test(entry)) return "";
  return entry;
}

function nameMatchesCertificate(hostname: string, names: string[]): boolean {
  const target = hostname.replace(/\.$/, "").toLowerCase();
  return names.some((raw) => {
    const name = sanName(raw).replace(/\.$/, "").toLowerCase();
    if (!name) return false;
    if (name === target) return true;
    if (!name.startsWith("*.")) return false;
    const suffix = name.slice(1);
    if (!target.endsWith(suffix)) return false;
    const head = target.slice(0, target.length - suffix.length);
    return head.length > 0 && !head.includes(".");
  });
}

/**
 * Names a client would check, SANs first. When any subjectAltName is present the
 * common name is not a name a client will accept, so it is left out rather than
 * padding the list; the CN is only used when the certificate carries no SAN.
 */
function certificateNames(subject: string, sans: string[]): string[] {
  const fromSans = sans.map(sanName).filter(Boolean);
  if (fromSans.length > 0) return Array.from(new Set(fromSans));
  const fromSubject = /cn\s*=\s*([^,/]+)/i.exec(subject ?? "");
  const cn = fromSubject ? fromSubject[1].trim() : "";
  return cn ? [cn] : [];
}

export function shortName(dn: string): string {
  const cn = /cn\s*=\s*([^,/]+)/i.exec(dn ?? "");
  if (cn) return cn[1].trim();
  const o = /(?:^|,)\s*o\s*=\s*([^,/]+)/i.exec(dn ?? "");
  if (o) return o[1].trim();
  return (dn ?? "").trim();
}

export interface PrimaryAddress {
  ip: string;
  origin: "dns" | "http" | "network";
  detail: string;
}

export function primaryAddress(investigation: Investigation): PrimaryAddress | undefined {
  const dnsAddresses = investigation.dns?.addresses ?? [];
  if (dnsAddresses.length > 0) {
    return {
      ip: dnsAddresses[0],
      origin: "dns",
      detail:
        dnsAddresses.length > 1
          ? `first of ${plural(dnsAddresses.length, "DNS answer")}`
          : "single DNS answer",
    };
  }
  const hops = investigation.http?.hops ?? [];
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const address = hops[index].address;
    if (address) return { ip: address, origin: "http", detail: "peer of the HTTP connection" };
  }
  const registered = investigation.network?.addresses ?? [];
  if (registered.length > 0) {
    return { ip: registered[0].ip, origin: "network", detail: "from address registration lookup" };
  }
  return undefined;
}

function networkFor(
  investigation: Investigation,
  ip: string | undefined,
): NetworkAddress | undefined {
  if (!ip) return investigation.network?.addresses?.[0];
  return (
    (investigation.network?.addresses ?? []).find((address) => address.ip === ip) ??
    investigation.network?.addresses?.[0]
  );
}

function connectedPeer(investigation: Investigation): string | undefined {
  const hops = investigation.http?.hops ?? [];
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (hops[index].address) return hops[index].address;
  }
  return undefined;
}

function knownEvidenceIds(investigation: Investigation, ids: string[]): string[] {
  const known = new Set((investigation.evidence ?? []).map((row) => row.id));
  return Array.from(new Set(ids)).filter((id) => known.has(id));
}

function push(findings: Finding[], finding: Finding, investigation: Investigation): void {
  findings.push({
    ...finding,
    evidenceIds: knownEvidenceIds(investigation, finding.evidenceIds),
  });
}

export function interpretInvestigation(investigation: Investigation): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => push(findings, finding, investigation);
  const url = investigation.url;
  const hostname = url?.hostname ?? "";

  const queryNote = url?.hasQuery
    ? `${plural(url.queryKeys.length, "query parameter name")} recorded (${list(url.queryKeys, 4)}); parameter values are not stored`
    : "no query string";
  add({
    id: "finding-url-target",
    layer: "url",
    title: `Target hostname ${hostname || "not parsed"}`,
    description: hostname
      ? `The submitted URL parses to hostname ${hostname} over ${String(url.scheme).toUpperCase()}${
          url.port ? ` on port ${url.port}` : ""
        }, path ${url.pathname || "/"}, ${queryNote}. Everything below is attributed to this hostname and nothing else.`
      : "The submitted URL could not be parsed into a hostname, so no layer below can be attributed to a name.",
    confidence: hostname ? "observed" : "unknown",
    evidenceIds: evidenceIds(investigation, "url"),
  });

  const dnsStatus = providerState(investigation, "dns");
  const dns = investigation.dns;
  const dnsEvidence = evidenceIds(investigation, "dns");
  if (!dns) {
    add({
      id: isPending(dnsStatus) ? "finding-dns-pending" : "finding-dns-unavailable",
      layer: "dns",
      title: isPending(dnsStatus) ? "DNS lookup still running" : "DNS answers unavailable",
      description: isPending(dnsStatus)
        ? `The resolver query for ${hostname} has not returned yet, so addresses and record types are still unknown.`
        : `No DNS answers were captured for ${hostname}${
            providerMessage(investigation, "dns") ? `: ${providerMessage(investigation, "dns")}` : ""
          }. Records may still exist; this run simply has none to show.`,
      confidence: "unknown",
      evidenceIds: dnsEvidence,
    });
  } else {
    const addresses = dns.addresses ?? [];
    const cnames = recordsOfType(dns, "CNAME");
    const nameservers = recordsOfType(dns, "NS");
    const failed = failedDnsQueries(dns);

    if (addresses.length > 0) {
      add({
        id: "finding-dns-addresses",
        layer: "dns",
        title: `${plural(addresses.length, "address")} returned for ${hostname}`,
        description: `Resolver ${dns.resolver || "used for this run"} returned ${list(addresses, 4)}. ${
          addresses.length > 1
            ? "Multiple answers usually mean a pool or an anycast set, so a different client can be handed a different address."
            : "A single answer is what this resolver returned at this moment and can change with TTL."
        }`,
        confidence: "observed",
        evidenceIds: dnsEvidence,
      });
    } else if (dnsNameDoesNotExist(dns)) {
      add({
        id: "finding-dns-nxdomain",
        layer: "dns",
        title: `NXDOMAIN for ${hostname}`,
        description: `The resolver reported NXDOMAIN: this name does not exist in DNS right now. With no address there is nothing to connect to, so any HTTP or TLS evidence in this report would have to come from another name and none is attributed here.`,
        confidence: "observed",
        evidenceIds: dnsEvidence,
      });
    } else {
      add({
        id: "finding-dns-no-address",
        layer: "dns",
        title: "No address record returned",
        description: `${hostname} returned ${plural(dns.records?.length ?? 0, "record")} but no A or AAAA answer, so the address for this name is unknown from DNS in this run.`,
        confidence: "unknown",
        evidenceIds: dnsEvidence,
      });
    }

    if (cnames.length > 0) {
      add({
        id: "finding-dns-cname",
        layer: "dns",
        title: "Name is an alias",
        description: `${hostname} is a CNAME to ${list(
          cnames.map((record) => record.value),
          3,
        )}. The alias target is where the address answer actually comes from.`,
        confidence: "observed",
        evidenceIds: dnsEvidence,
      });
    }

    if (nameservers.length > 0) {
      const operators = Array.from(
        new Set(nameservers.map((record) => registrableName(record.value))),
      );
      add({
        id: "finding-dns-nameservers",
        layer: "dns",
        title: "Authoritative nameservers",
        description: `The zone is served by ${list(
          nameservers.map((record) => record.value),
          4,
        )} (name${operators.length === 1 ? "" : "s"} under ${list(operators, 3)}). Running authoritative DNS answers the name only. It does not show who serves the HTTP response, and a nameserver operator is not automatically the edge in front of the site.`,
        confidence: "observed",
        evidenceIds: dnsEvidence,
      });
    }

    if (failed.length > 0) {
      add({
        id: "finding-dns-partial",
        layer: "dns",
        title: "Some DNS queries did not complete",
        description: `These query types did not return a clean answer: ${failed
          .map((type) => `${type} (${dns.queryStatus[type]})`)
          .join(", ")}. Those record types are unknown for this run rather than absent.`,
        confidence: "unknown",
        evidenceIds: dnsEvidence,
      });
    }
  }

  const httpStatus = providerState(investigation, "http");
  const http = investigation.http;
  const httpEvidence = evidenceIds(investigation, "http");
  if (!http || !httpResponseCaptured(http)) {
    const stopped = [providerMessage(investigation, "http"), http?.stoppedReason ?? ""].find(
      (reason) => reason.length > 0,
    );
    add({
      id: isPending(httpStatus) ? "finding-http-pending" : "finding-http-unavailable",
      layer: "http",
      title: isPending(httpStatus) ? "HTTP request still running" : "No HTTP response captured",
      description: isPending(httpStatus)
        ? "The request has not returned yet, so status code, redirects and headers are still unknown."
        : `No response was recorded for ${url?.href ?? hostname}${
            stopped ? `: ${stopped}` : ""
          }. Whether the site serves content is unknown from this run.`,
      confidence: "unknown",
      evidenceIds: httpEvidence,
    });
  } else {
    add({
      id: "finding-http-outcome",
      layer: "http",
      title: `Final response ${http.finalStatus || "unknown"}`,
      description: `The request ended at ${http.finalUrl || "an unrecorded URL"} with status ${
        http.finalStatus
      } after ${plural(http.redirectCount ?? 0, "redirect")}${
        http.durationMs ? `, measured in ${http.durationMs} ms from this vantage point` : ""
      }.`,
      confidence: "observed",
      evidenceIds: httpEvidence,
    });

    if ((http.redirectCount ?? 0) > 0 && (http.hops ?? []).length > 0) {
      add({
        id: "finding-http-redirects",
        layer: "http",
        title: "Redirect chain",
        description: `${http.hops
          .map((hop) => `${hop.status} ${hop.url}${hop.location ? ` to ${hop.location}` : ""}`)
          .join("; ")}. Each step is a response this run actually received, in the order received.`,
        confidence: "observed",
        evidenceIds: httpEvidence,
      });
    }

    if (http.chainComplete === false) {
      add({
        id: "finding-http-chain-incomplete",
        layer: "http",
        title: "Redirect chain did not finish",
        description: `Following stopped${
          http.stoppedReason ? ` because ${http.stoppedReason}` : ""
        }, so the final destination of this URL is unknown. The hops listed were still observed.`,
        confidence: "unknown",
        evidenceIds: httpEvidence,
      });
    }

    const peer = connectedPeer(investigation);
    if (peer) {
      const dnsAddresses = investigation.dns?.addresses ?? [];
      const matched = dnsAddresses.includes(peer);
      add({
        id: "finding-http-peer",
        layer: "http",
        title: `Connected to ${peer}`,
        description: matched
          ? `The response came from ${peer}, which is one of the addresses this resolver returned, so the DNS answer and the connection agree.`
          : dnsAddresses.length > 0
            ? `The response came from ${peer}, which was not among the addresses recorded here (${list(
                dnsAddresses,
                3,
              )}). That happens with anycast, a pool larger than one answer, or a different resolver view; which of those applies is unknown.`
            : `The response came from ${peer}. This is the peer the connection actually reached, recorded from the socket rather than inferred.`,
        confidence: "observed",
        evidenceIds: evidenceIdsMentioning(investigation, peer).concat(httpEvidence).slice(0, 8),
      });
    }

    const signals = http.headerSignals ?? [];
    if (signals.length > 0) {
      const present = signals.filter((signal) => signal.state === "present");
      const absent = signals.filter((signal) => signal.state === "absent");
      const unknownSignals = signals.filter((signal) => signal.state === "unknown");
      add({
        id: "finding-http-headers",
        layer: "http",
        title: `${present.length} of ${signals.length} checked headers present`,
        description: `Present: ${present.length > 0 ? list(present.map((s) => s.name), 5) : "none"}. Absent: ${
          absent.length > 0 ? list(absent.map((s) => s.name), 5) : "none"
        }.${
          unknownSignals.length > 0
            ? ` Not determined: ${list(unknownSignals.map((s) => s.name), 5)}.`
            : ""
        } These are configuration observations on one response. A missing header is not a vulnerability finding and a present header is not proof the site is safe.`,
        confidence: "observed",
        evidenceIds: httpEvidence,
      });
    }
  }

  const tlsStatus = providerState(investigation, "tls");
  const tls = investigation.tls;
  const tlsEvidence = evidenceIds(investigation, "tls");
  if (!tls) {
    const plaintext = url?.scheme === "http";
    add({
      id: plaintext
        ? "finding-tls-not-applicable"
        : isPending(tlsStatus)
          ? "finding-tls-pending"
          : "finding-tls-unavailable",
      layer: "tls",
      title: plaintext
        ? "No TLS handshake for this URL"
        : isPending(tlsStatus)
          ? "TLS handshake still running"
          : "No certificate captured",
      description: plaintext
        ? `The URL uses http://, so no certificate was requested or presented. Whether the host would answer on 443 was not tested.`
        : isPending(tlsStatus)
          ? `The handshake with ${hostname} has not completed, so issuer and validity are still unknown.`
          : `No certificate was captured for ${hostname}${
              providerMessage(investigation, "tls") ? `: ${providerMessage(investigation, "tls")}` : ""
            }. A certificate may still be served; this run has none to show.`,
      confidence: "unknown",
      evidenceIds: tlsEvidence,
    });
  } else {
    const requested = hostname || tls.hostname;
    add({
      id: "finding-tls-certificate",
      layer: "tls",
      title: `Certificate presented for ${tls.hostname || requested}`,
      description: `The handshake for the original hostname ${requested} returned a certificate with subject ${
        shortName(tls.subject) || "not recorded"
      }, issued by ${shortName(tls.issuer) || "an unrecorded issuer"}, valid ${
        tls.validFrom || "unknown"
      } to ${tls.validTo || "unknown"} over ${tls.protocol || "an unrecorded protocol"}${
        (tls.sans ?? []).length > 0 ? `, covering ${plural(tls.sans.length, "name")}` : ""
      }. A certificate shows the issuer was satisfied that the operator controls the name. It says nothing about who the operator is or how they handle data.`,
      confidence: "observed",
      evidenceIds: tlsEvidence,
    });

    const names = certificateNames(tls.subject, tls.sans ?? []);
    if (requested && names.length > 0 && !nameMatchesCertificate(requested, names)) {
      add({
        id: "finding-tls-name-coverage",
        layer: "tls",
        title: "Certificate does not list the requested hostname",
        description: `${requested} does not appear in the subject or the ${plural(
          names.length,
          "name",
        )} on the presented certificate (${list(names, 4)}). Clients treat that as a name mismatch.`,
        confidence: "observed",
        evidenceIds: tlsEvidence,
      });
    }

    if (tls.authorized === false) {
      add({
        id: "finding-tls-not-authorized",
        layer: "tls",
        title: "Chain validation failed",
        description: `The TLS client rejected the chain${
          tls.authorizationError ? `: ${tls.authorizationError}` : ""
        }. That is a trust result for this client and store, not a statement that the site is malicious.`,
        confidence: "observed",
        evidenceIds: tlsEvidence,
      });
    }
  }

  const networkStatus = providerState(investigation, "network");
  const network = investigation.network;
  const primary = primaryAddress(investigation);
  const networkEvidence = evidenceIds(investigation, "network");
  const registered = network?.addresses ?? [];
  if (registered.length === 0) {
    const reason = !primary
      ? "No address was available to look up, so registration is unknown."
      : isPending(networkStatus)
        ? `Registration lookup for ${primary.ip} has not returned yet.`
        : `No registration record was captured for ${primary.ip}${
            providerMessage(investigation, "network")
              ? `: ${providerMessage(investigation, "network")}`
              : ""
          }.`;
    add({
      id: isPending(networkStatus) ? "finding-network-pending" : "finding-network-unavailable",
      layer: "network",
      title: "Address registration unknown",
      description: `${reason} Prefix, ASN and the announcing organisation are therefore unknown rather than absent.`,
      confidence: "unknown",
      evidenceIds: networkEvidence,
    });
  } else {
    for (const address of registered.slice(0, 4)) {
      const parts: string[] = [];
      if (address.prefix) parts.push(`inside prefix ${address.prefix}`);
      if (address.asn) parts.push(`announced by ${address.asn}`);
      if (address.organization) parts.push(`registered to ${address.organization}`);
      if (address.ptr && address.ptr.length > 0) parts.push(`reverse name ${list(address.ptr, 2)}`);
      const known = parts.length > 0;
      add({
        id: `finding-network-${slug(address.ip)}`,
        layer: "network",
        title: known
          ? `${address.ip} sits in ${address.prefix ?? address.asn ?? "a registered block"}`
          : `${address.ip} registration not resolved`,
        description: known
          ? `IPv${address.version} address ${address.ip} is ${list(
              parts,
              4,
            )}, per ${address.source || "the registration source used"}. Registration says who is responsible for the address block and who announces it. It does not establish who owns or operates the content served from it, and it is not a measurement of where the machine is.`
          : `IPv${address.version} address ${address.ip} returned no prefix or ASN detail from ${
              address.source || "the registration source used"
            }, so its network affiliation is unknown.`,
        confidence: known ? "observed" : "unknown",
        evidenceIds: evidenceIdsMentioning(investigation, address.ip)
          .concat(networkEvidence)
          .slice(0, 8),
      });
    }

    const withCountry = registered.find((address) => address.country);
    if (withCountry) {
      add({
        id: "finding-network-location-unknown",
        layer: "network",
        title: "Server location not determined",
        description: `The registry lists country ${withCountry.country} for ${withCountry.ip} as administrative data about the address block holder. This report performs no latency, anycast or geolocation measurement, so the physical location of the responding server is unknown and the registry country must not be read as one.`,
        confidence: "unknown",
        evidenceIds: networkEvidence,
      });
    }

    if (network?.limited) {
      add({
        id: "finding-network-limited",
        layer: "network",
        title: "Registration data was limited",
        description:
          "The registration lookup returned a reduced answer for this run, so some prefix or ASN detail may be missing rather than nonexistent.",
        confidence: "unknown",
        evidenceIds: networkEvidence,
      });
    }
  }

  const techStatus = providerState(investigation, "technology");
  const technology = investigation.technology;
  const techEvidence = evidenceIds(investigation, "technology");
  if (!technology) {
    add({
      id: isPending(techStatus) ? "finding-technology-pending" : "finding-technology-unavailable",
      layer: "technology",
      title: isPending(techStatus)
        ? "Response analysis still running"
        : "No response analysis available",
      description: isPending(techStatus)
        ? "Headers and initial HTML have not been analysed yet, so no technology signal is known."
        : `No response body or headers were analysed${
            providerMessage(investigation, "technology")
              ? `: ${providerMessage(investigation, "technology")}`
              : ""
          }, so the stack is unknown.`,
      confidence: "unknown",
      evidenceIds: techEvidence,
    });
  } else {
    const technologies = technology.technologies ?? [];
    if (technologies.length > 0) {
      const observed = technologies.filter((item) => item.confidence === "observed");
      add({
        id: "finding-technology-stack",
        layer: "technology",
        title: `${plural(technologies.length, "technology signal")} in the response`,
        description: `${technologies
          .slice(0, 8)
          .map((item) => `${item.name} (${item.category}, ${item.confidence})`)
          .join("; ")}${
          technologies.length > 8 ? `; and ${technologies.length - 8} more` : ""
        }. Each name comes from a header or markup pattern in the response, listed with the evidence that produced it.`,
        confidence: observed.length === technologies.length ? "observed" : "inferred",
        evidenceIds: Array.from(
          new Set(technologies.flatMap((item) => item.evidenceIds ?? []).concat(techEvidence)),
        ).slice(0, 12),
      });
    } else {
      add({
        id: "finding-technology-none",
        layer: "technology",
        title: "No technology signal matched",
        description: `The analysed response carried no pattern this tool recognises. That means unknown, not a plain or custom stack.`,
        confidence: "unknown",
        evidenceIds: techEvidence,
      });
    }

    add({
      id: "finding-technology-static-only",
      layer: "technology",
      title: "Static response only, no JavaScript executed",
      description: `Detection read ${technology.analyzedBytes ?? 0} bytes of the initial response${
        technology.truncated ? " and the body was truncated at that limit" : ""
      }. JavaScript was not executed and no subresources were fetched, so anything loaded at runtime is invisible here and absence of a technology is not evidence it is missing.`,
      confidence: "observed",
      evidenceIds: techEvidence,
    });
  }

  const guesses = technology?.infrastructure ?? [];
  if (guesses.length > 0) {
    for (const guess of guesses) {
      add({
        id: `finding-infrastructure-${slug(guess.name)}`,
        layer: "infrastructure",
        title: `${guess.name} inferred`,
        description: `${guess.explanation} This is an inference from response evidence, not a confirmation from the provider, and it can be wrong when a platform is proxied by another.`,
        confidence: "inferred",
        evidenceIds: Array.from(new Set(guess.evidenceIds ?? [])),
      });
    }
  } else {
    const nsOperators = Array.from(
      new Set(recordsOfType(investigation.dns, "NS").map((record) => registrableName(record.value))),
    );
    const orgs = Array.from(
      new Set(registered.map((address) => address.organization).filter(Boolean) as string[]),
    );
    const notes: string[] = [];
    if (nsOperators.length > 0) {
      notes.push(
        `Authoritative DNS runs under ${list(nsOperators, 2)}, which shows who answers the name and not who terminates the HTTP connection`,
      );
    }
    if (orgs.length > 0) {
      notes.push(
        `the address is registered to ${list(orgs, 2)}, which identifies the network holding the address block and not the operator of the site or its origin`,
      );
    }
    add({
      id: "finding-infrastructure-unconfirmed",
      layer: "infrastructure",
      title: "Edge and hosting platform unconfirmed",
      description: `No platform could be inferred from the evidence collected.${
        notes.length > 0 ? ` ${notes.join("; ")}.` : ""
      } Who serves and who hosts is unknown from this run.`,
      confidence: "unknown",
      evidenceIds: techEvidence.concat(networkEvidence).slice(0, 8),
    });
  }

  add({
    id: "finding-history-none",
    layer: "history",
    title: "One run, one vantage point, no saved history",
    description: `This report covers a single investigation started at ${
      investigation.startedAt ?? "an unrecorded time"
    } from one network location. No lookup history is retained or compared, no port scan or traceroute was performed, and no source outside the evidence list contributed to it.`,
    confidence: "observed",
    evidenceIds: [],
  });

  return findings.sort(
    (a, b) => layerDisplay(a.layer).order - layerDisplay(b.layer).order,
  );
}

function clip(value: string, max: number): string {
  const text = (value ?? "").trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
}

export function buildInfrastructureGraph(investigation: Investigation): InfrastructureGraph {
  const url = investigation.url;
  const hostname = url?.hostname ?? "";
  const dns = investigation.dns;
  const http = investigation.http;
  const tls = investigation.tls;
  const technology = investigation.technology;
  const primary = primaryAddress(investigation);
  const registration = networkFor(investigation, primary?.ip);
  const peer = connectedPeer(investigation);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  nodes.push({
    id: "url",
    layer: "url",
    eyebrow: "URL",
    label: hostname || "unparsed URL",
    detail: hostname
      ? `${String(url.scheme).toUpperCase()} ${clip(url.pathname || "/", 28)}`
      : "no hostname parsed",
    confidence: hostname ? "observed" : "unknown",
    status: "complete",
    evidenceIds: evidenceIds(investigation, "url"),
  });

  const dnsStatus = providerState(investigation, "dns");
  const dnsAddresses = dns?.addresses ?? [];
  const dnsRecordCount = dns?.records?.length ?? 0;
  const dnsKnown = Boolean(dns) && (dnsRecordCount > 0 || dnsAddresses.length > 0 || dnsNameDoesNotExist(dns));
  nodes.push({
    id: "dns",
    layer: "dns",
    eyebrow: "DNS",
    label: !dns
      ? isPending(dnsStatus)
        ? "lookup pending"
        : "unknown"
      : dnsAddresses.length > 0
        ? `${plural(dnsAddresses.length, "address")}`
        : dnsNameDoesNotExist(dns)
          ? "NXDOMAIN"
          : dnsRecordCount > 0
            ? `${plural(dnsRecordCount, "record")}, no address`
            : "no records",
    detail: dns?.resolver ? `via ${clip(dns.resolver, 26)}` : statusLabel(dnsStatus),
    confidence: dnsKnown ? "observed" : "unknown",
    status: dnsStatus,
    evidenceIds: evidenceIds(investigation, "dns"),
  });

  const ipFromDns = Boolean(primary && primary.origin === "dns");
  nodes.push({
    id: "ip",
    layer: "network",
    eyebrow: "ADDRESS",
    label: primary?.ip ?? "unknown",
    detail: primary ? primary.detail : dns && dnsNameDoesNotExist(dns) ? "no address exists" : "not resolved",
    confidence: primary ? "observed" : "unknown",
    status: primary?.origin === "http" ? providerState(investigation, "http") : dnsStatus,
    evidenceIds: primary ? evidenceIdsMentioning(investigation, primary.ip) : [],
  });

  const networkStatus = providerState(investigation, "network");
  const networkKnown = Boolean(registration && (registration.asn || registration.prefix || registration.organization));
  nodes.push({
    id: "network",
    layer: "network",
    eyebrow: "ASN / PREFIX",
    label: networkKnown
      ? clip(registration?.asn || registration?.organization || "", 24) || "unknown"
      : isPending(networkStatus)
        ? "lookup pending"
        : "unknown",
    detail: networkKnown
      ? clip(
          [registration?.prefix, registration?.organization]
            .filter(Boolean)
            .join(" | ") || "registered block",
          30,
        )
      : "no registration captured",
    confidence: networkKnown ? "observed" : "unknown",
    status: networkStatus,
    evidenceIds: evidenceIds(investigation, "network"),
  });

  const tlsStatus = providerState(investigation, "tls");
  nodes.push({
    id: "tls",
    layer: "tls",
    eyebrow: "TLS",
    label: tls
      ? clip(shortName(tls.issuer) || "certificate", 24)
      : url?.scheme === "http"
        ? "not applicable"
        : isPending(tlsStatus)
          ? "handshake pending"
          : "unknown",
    detail: tls
      ? `${tls.protocol || "protocol unknown"}${tls.validTo ? ` to ${clip(tls.validTo, 12)}` : ""}`
      : url?.scheme === "http"
        ? "plaintext URL"
        : "no certificate captured",
    confidence: tls ? "observed" : "unknown",
    status: tlsStatus,
    evidenceIds: evidenceIds(investigation, "tls"),
  });

  const httpStatus = providerState(investigation, "http");
  const httpAnswered = httpResponseCaptured(http);
  nodes.push({
    id: "http",
    layer: "http",
    eyebrow: "HTTP",
    label: httpAnswered
      ? `${http!.finalStatus}${(http!.redirectCount ?? 0) > 0 ? ` after ${http!.redirectCount}` : ""}`
      : isPending(httpStatus)
        ? "request pending"
        : "unknown",
    detail: httpAnswered
      ? clip(http!.finalUrl || "final URL not recorded", 32)
      : "no response captured",
    confidence: httpAnswered ? "observed" : "unknown",
    status: httpStatus,
    evidenceIds: evidenceIds(investigation, "http"),
  });

  const techStatus = providerState(investigation, "technology");
  const technologies = technology?.technologies ?? [];
  nodes.push({
    id: "technology",
    layer: "technology",
    eyebrow: "TECHNOLOGY",
    label: technology
      ? technologies.length > 0
        ? `${plural(technologies.length, "signal")}`
        : "no signal matched"
      : isPending(techStatus)
        ? "analysis pending"
        : "unknown",
    detail:
      technologies.length > 0
        ? clip(technologies.map((item) => item.name).join(", "), 34)
        : technology
          ? "static response only"
          : "no response analysed",
    confidence: technology && technologies.length > 0 ? "observed" : "unknown",
    status: techStatus,
    evidenceIds: Array.from(
      new Set(
        technologies
          .flatMap((item) => item.evidenceIds ?? [])
          .concat(evidenceIds(investigation, "technology")),
      ),
    ),
  });

  const guesses = technology?.infrastructure ?? [];
  nodes.push({
    id: "infrastructure",
    layer: "infrastructure",
    eyebrow: "INFERENCE",
    label:
      guesses.length > 0 ? clip(guesses.map((guess) => guess.name).join(", "), 26) : "unconfirmed",
    detail:
      guesses.length > 0
        ? `inferred from ${plural(
            Array.from(new Set(guesses.flatMap((guess) => guess.evidenceIds ?? []))).length,
            "evidence row",
          )}`
        : "no platform inferable",
    confidence: guesses.length > 0 ? "inferred" : "unknown",
    status: techStatus,
    evidenceIds: Array.from(new Set(guesses.flatMap((guess) => guess.evidenceIds ?? []))),
  });

  if (dnsKnown) {
    edges.push({
      id: "url-dns",
      from: "url",
      to: "dns",
      label: "looked up",
      kind: "resolution",
    });
  }

  if (primary && ipFromDns) {
    edges.push({
      id: "dns-ip",
      from: "dns",
      to: "ip",
      label: "resolves to",
      kind: "resolution",
    });
  }

  if (httpAnswered) {
    edges.push({ id: "url-http", from: "url", to: "http", label: "requested", kind: "request" });
  }

  if (tls) {
    edges.push({ id: "url-tls", from: "url", to: "tls", label: "presents", kind: "request" });
  }

  if (peer && primary && peer === primary.ip) {
    edges.push({
      id: "http-ip",
      from: "http",
      to: "ip",
      label: "connected peer",
      kind: "relationship",
    });
  }

  if (primary && networkKnown && registration && registration.ip === primary.ip) {
    edges.push({
      id: "ip-network",
      from: "ip",
      to: "network",
      label: registration.prefix ? "announced in" : "registered to",
      kind: "relationship",
    });
  }

  if (technologies.length > 0 && httpAnswered) {
    edges.push({
      id: "http-technology",
      from: "http",
      to: "technology",
      label: "response evidence",
      kind: "relationship",
    });
  }

  if (guesses.length > 0) {
    const evidenceById = new Map((investigation.evidence ?? []).map((row) => [row.id, row]));
    const sources = new Set<string>();
    for (const guess of guesses) {
      for (const id of guess.evidenceIds ?? []) {
        const row = evidenceById.get(id);
        if (!row) continue;
        if (row.source === "url") continue;
        sources.add(row.source);
      }
    }
    if (sources.size === 0 && technologies.length > 0) sources.add("technology");
    for (const source of Array.from(sources).sort()) {
      edges.push({
        id: `infer-${source}-infrastructure`,
        from: source,
        to: "infrastructure",
        label: "suggests",
        kind: "inference",
      });
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    nodes: nodes.map((node) => ({
      ...node,
      evidenceIds: knownEvidenceIds(investigation, node.evidenceIds),
    })),
    edges: edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
  };
}
