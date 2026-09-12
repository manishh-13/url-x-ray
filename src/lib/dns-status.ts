import type { DnsData } from "./types";

/**
 * How one DNS question ended, judged from the string the provider recorded.
 *
 * The provider writes a human readable status per question ("NOERROR, 2
 * records", "NXDOMAIN", "not applicable", "no answer in time"), so the
 * interpreter needs a parse rather than a substring test: NOERROR with a record
 * count is an answer, NXDOMAIN is an answer that the name does not exist, and
 * only a transport or resolver problem is genuinely unavailable.
 */
export type DnsQueryOutcome = "success" | "nxdomain" | "not-applicable" | "unavailable";

/** "NOERROR", "OK", "NOERROR, no records", "NOERROR, 2 records". */
const SUCCESS_PATTERN = /^(?:noerror|ok)(?:\s*,\s*(?:no records|\d+\s+records?))?$/i;

/** "NXDOMAIN", optionally carrying the same record clause. */
const NXDOMAIN_PATTERN = /^nxdomain(?:\s*,\s*(?:no records|\d+\s+records?))?$/i;

/** Recorded for every question when the URL already names an IP address. */
const NOT_APPLICABLE_PATTERN = /^not[\s-]applicable$/i;

const ADDRESS_QUERY_TYPES = new Set(["A", "AAAA"]);

/**
 * Classify one recorded query status. A missing or blank status is treated as
 * "not-applicable": nothing was recorded, which is not evidence of failure.
 */
export function dnsQueryOutcome(value: string | undefined): DnsQueryOutcome {
  const text = (value ?? "").trim();
  if (text.length === 0) return "not-applicable";
  if (NOT_APPLICABLE_PATTERN.test(text)) return "not-applicable";
  if (SUCCESS_PATTERN.test(text)) return "success";
  if (NXDOMAIN_PATTERN.test(text)) return "nxdomain";
  return "unavailable";
}

/**
 * Query types whose answer is genuinely unknown for this run, in recorded order.
 *
 * A blank status is skipped explicitly: an absent recording is not a failure,
 * whatever a future classification of the empty string decides.
 */
export function failedDnsQueries(dns: DnsData | undefined): string[] {
  const status = dns?.queryStatus ?? {};
  return Object.keys(status).filter((key) => {
    const value = status[key];
    if ((value ?? "").trim().length === 0) return false;
    return dnsQueryOutcome(value) === "unavailable";
  });
}

/**
 * True only when the name itself does not exist: no address was returned and an
 * actual A or AAAA question came back NXDOMAIN. An NXDOMAIN for an optional
 * type such as TXT, CAA or NS says nothing about the hostname.
 */
export function dnsNameDoesNotExist(dns: DnsData | undefined): boolean {
  if (!dns) return false;
  if ((dns.addresses ?? []).length > 0) return false;
  const status = dns.queryStatus ?? {};
  return Object.keys(status).some(
    (key) =>
      ADDRESS_QUERY_TYPES.has(key.trim().toUpperCase()) &&
      dnsQueryOutcome(status[key]) === "nxdomain",
  );
}
