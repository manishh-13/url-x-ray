import type { DnsData, DnsRecord } from "@/lib/types";
import type { PinnedAddress } from "../ip-guard";
import { DNS_QUERY_TYPES, DOH_RESOLVER_LABEL, RECORD_TYPE_NAMES, decodeTxt, type DnsQueryType } from "../doh";
import { classifyIp } from "../ip-guard";
import { describeError, isAbortError, type Provider, type ProviderContext } from "../provider";

const MAX_RECORDS = 60;
const MAX_TXT_CHARS = 300;

export interface RefusedAddress {
  ip: string;
  reason: string;
}

export interface DnsProviderResult {
  /** The snapshot handed to the client. */
  dns: DnsData;
  /** Addresses accepted for connection, already validated as globally routable. */
  routableAddresses: PinnedAddress[];
  /** Resolved addresses that were refused, kept as a finding rather than hidden. */
  refusedAddresses: RefusedAddress[];
}

const normalizeValue = (type: number, data: string): string => {
  if (type === 16) {
    const decoded = decodeTxt(data);
    return decoded.length > MAX_TXT_CHARS ? decoded.slice(0, MAX_TXT_CHARS) + "...[truncated]" : decoded;
  }
  return data.replace(/\.$/, "");
};

/**
 * Public DNS only, one independent question per record type.
 *
 * Each question reports its own RCODE, so an NXDOMAIN for CAA and a timeout for
 * HTTPS are both visible instead of being flattened into a single failure. The
 * provider stays complete when at least one question was answered.
 */
export const dnsProvider: Provider<void, DnsProviderResult> = {
  id: "dns",
  label: "DNS",
  timeoutMs: 6_000,

  async run(context: ProviderContext): Promise<{ status: "complete" | "unavailable"; message?: string; data?: DnsProviderResult }> {
    const { target, evidence } = context;

    if (target.isIpLiteral) {
      const verdict = classifyIp(target.hostname);
      evidence.record({
        source: "dns",
        kind: "skipped",
        label: "No name to resolve",
        value: target.hostname,
        confidence: "observed",
        explanation: "The URL names an IP address directly, so no DNS lookup applies.",
      });
      return {
        status: "complete",
        message: "The URL points at an IP address, so there is no name to resolve.",
        data: {
          dns: {
            resolver: DOH_RESOLVER_LABEL,
            records: [],
            addresses: [target.hostname],
            queryStatus: Object.fromEntries(DNS_QUERY_TYPES.map((type) => [type, "not applicable"])),
          },
          routableAddresses: verdict.ok && verdict.version ? [{ ip: target.hostname, version: verdict.version }] : [],
          refusedAddresses: verdict.ok ? [] : [{ ip: target.hostname, reason: verdict.reason ?? verdict.range }],
        },
      };
    }

    const name = target.hostname;
    const queryStatus: Record<string, string> = {};
    const records: DnsRecord[] = [];
    const routableAddresses: PinnedAddress[] = [];
    const refusedAddresses: RefusedAddress[] = [];
    const seenAddresses = new Set<string>();

    const settled = await Promise.allSettled(
      DNS_QUERY_TYPES.map(async (type) => ({ type, result: await context.deps.doh(name, type, context.signal) })),
    );

    let answered = 0;
    const failedTypes: string[] = [];

    for (let index = 0; index < settled.length; index += 1) {
      const type = DNS_QUERY_TYPES[index] as DnsQueryType;
      const outcome = settled[index];

      if (outcome.status === "rejected") {
        failedTypes.push(type);
        queryStatus[type] = isAbortError(outcome.reason)
          ? "no answer in time"
          : describeError(outcome.reason, "query failed");
        continue;
      }

      answered += 1;
      const { result } = outcome.value;
      const matching = result.answers.filter((answer) => RECORD_TYPE_NAMES[answer.type] === type);
      queryStatus[type] =
        result.status === 0
          ? matching.length > 0
            ? `NOERROR, ${matching.length} record${matching.length === 1 ? "" : "s"}`
            : "NOERROR, no records"
          : result.statusText;

      for (const answer of matching) {
        if (records.length >= MAX_RECORDS) break;
        const value = normalizeValue(answer.type, answer.data);
        records.push({ type, name: answer.name || name, value, ttl: answer.TTL });
        evidence.record({
          source: "dns",
          kind: "record",
          label: `${type} record for ${answer.name || name}`,
          value,
          confidence: "observed",
          explanation: `Answered by ${DOH_RESOLVER_LABEL} with TTL ${answer.TTL}s.`,
        });

        if (type !== "A" && type !== "AAAA") continue;
        const verdict = classifyIp(value);
        const key = verdict.normalized ?? value;
        if (seenAddresses.has(key)) continue;
        seenAddresses.add(key);
        if (verdict.ok && verdict.version) {
          routableAddresses.push({ ip: value, version: verdict.version });
        } else {
          const reason = verdict.reason ?? verdict.range;
          refusedAddresses.push({ ip: value, reason });
          evidence.record({
            source: "dns",
            kind: "refused-address",
            label: `${type} record resolves off the public Internet`,
            value: `${value} (${reason})`,
            confidence: "observed",
            explanation: "This address is not globally routable, so no connection was attempted to it.",
          });
        }
      }
    }

    // The resolver's own CNAME answers arrive alongside A questions; keep them
    // only if the dedicated CNAME question did not already supply them.
    const data: DnsProviderResult = {
      dns: {
        resolver: DOH_RESOLVER_LABEL,
        records,
        addresses: routableAddresses.map((entry) => entry.ip),
        queryStatus,
      },
      routableAddresses,
      refusedAddresses,
    };

    if (answered === 0) {
      return { status: "unavailable", message: "No DNS question was answered.", data };
    }
    if (failedTypes.length > 0) {
      return {
        status: "complete",
        message: `Partial answer: ${failedTypes.join(", ")} did not resolve.`,
        data,
      };
    }
    if (routableAddresses.length === 0) {
      return {
        status: "complete",
        message: refusedAddresses.length > 0
          ? "Every resolved address is outside the public Internet."
          : "The name resolved no public A or AAAA records.",
        data,
      };
    }
    return { status: "complete", data };
  },
};
