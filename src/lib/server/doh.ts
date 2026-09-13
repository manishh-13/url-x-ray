import { LIMITS } from "./limits";
import { readBoundedJson } from "./bounded-json";

/** Fixed, trusted resolver endpoint. User input never chooses the resolver. */
export const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";
export const DOH_RESOLVER_LABEL = "Cloudflare DNS over HTTPS (1.1.1.1)";

/** Public record types this tool asks for, each as an independent question. */
export const DNS_QUERY_TYPES = ["A", "AAAA", "CNAME", "NS", "MX", "TXT", "CAA", "HTTPS", "SVCB"] as const;
export type DnsQueryType = (typeof DNS_QUERY_TYPES)[number];

export const RECORD_TYPE_NAMES: Record<number, string> = {
  1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT",
  28: "AAAA", 33: "SRV", 35: "NAPTR", 43: "DS", 46: "RRSIG", 47: "NSEC",
  48: "DNSKEY", 50: "NSEC3", 52: "TLSA", 64: "SVCB", 65: "HTTPS", 257: "CAA",
};

const RCODE_NAMES: Record<number, string> = {
  0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED",
};

export interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

export interface DohResult {
  /** DNS RCODE. 0 is NOERROR; 3 is NXDOMAIN and is an honest answer, not a failure. */
  status: number;
  statusText: string;
  answers: DohAnswer[];
  comment?: string;
}

/** Injection seam: every provider takes a DohQuery rather than calling out itself. */
export type DohQuery = (name: string, type: string, signal: AbortSignal) => Promise<DohResult>;

const MAX_DOH_BYTES = 64 * 1024;

function combine(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

/**
 * One DoH question over the JSON API. No proxy is consulted, no cookies or
 * credentials are attached, and the response size is bounded.
 */
export const cloudflareDoh: DohQuery = async (name, type, signal) => {
  const endpoint = new URL(DOH_ENDPOINT);
  endpoint.searchParams.set("name", name);
  endpoint.searchParams.set("type", type);

  const response = await fetch(endpoint, {
    method: "GET",
    mode: "cors",
    headers: { accept: "application/dns-json" },
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: combine(signal, LIMITS.dohMs),
  });
  if (!response.ok) throw new Error(`Resolver returned HTTP ${response.status}`);

  return normalizeDohPayload(await readBoundedJson(response, MAX_DOH_BYTES, "Resolver"));
};

export function normalizeDohPayload(payload: unknown): DohResult {
  const record = (payload ?? {}) as Record<string, unknown>;
  const status = typeof record.Status === "number" ? record.Status : -1;
  const rawAnswers = Array.isArray(record.Answer) ? record.Answer : [];
  const answers: DohAnswer[] = [];
  for (const entry of rawAnswers) {
    const item = (entry ?? {}) as Record<string, unknown>;
    if (typeof item.data !== "string" || typeof item.type !== "number") continue;
    answers.push({
      name: typeof item.name === "string" ? item.name.replace(/\.$/, "") : "",
      type: item.type,
      TTL: typeof item.TTL === "number" ? item.TTL : 0,
      data: item.data,
    });
  }
  return {
    status,
    statusText: RCODE_NAMES[status] ?? `RCODE ${status}`,
    answers,
    comment: typeof record.Comment === "string" ? record.Comment : undefined,
  };
}

/** TXT answers come quoted and can be split into chunks; join them faithfully. */
export function decodeTxt(data: string): string {
  const chunks = data.match(/"(?:[^"\\]|\\.)*"/g);
  if (!chunks) return data.trim();
  return chunks.map((chunk) => chunk.slice(1, -1).replace(/\\"/g, '"')).join("");
}

/** 1.2.3.4 becomes 4.3.2.1.in-addr.arpa. */
export function reverseName4(ip: string): string {
  return ip.split(".").reverse().join(".") + ".in-addr.arpa";
}

/** IPv6 becomes the nibble form used by ip6.arpa and by Team Cymru origin6. */
export function reverseNibbles6(expanded: string): string {
  const hex = expanded.split(":").map((group) => group.padStart(4, "0")).join("");
  return hex.split("").reverse().join(".");
}
