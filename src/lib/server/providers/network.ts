import type { NetworkAddress, NetworkData } from "@/lib/types";
import { LIMITS } from "../limits";
import { parse as parseIp } from "ipaddr.js";
import { RECORD_TYPE_NAMES, decodeTxt, reverseName4, reverseNibbles6 } from "../doh";
import type { PinnedAddress } from "../ip-guard";
import { describeError, type Provider, type ProviderContext } from "../provider";

export interface ObservedAddress extends PinnedAddress {
  /** Where this address was seen, for example "DNS A record" or "HTTP hop 1". */
  observedBy: string[];
}

export interface NetworkProviderInput {
  addresses: ObservedAddress[];
}

export interface NetworkProviderResult {
  network: NetworkData;
  /** ASN records with the evidence id that carries them, for citation. */
  facts: { value: string; evidenceId: string }[];
}

const CYMRU_SOURCE = "Team Cymru IP to ASN mapping (DNS TXT)";
const CYMRU_SOURCE_URL = "https://team-cymru.com/community-services/ip-asn-mapping/";
const RIPE_SOURCE = "RIPEstat public API";

export const ASN_CAVEAT =
  "An ASN describes the network that announces this address on the public Internet. It is not a statement about where the content is hosted, who owns the site, or which country the operator is in.";

interface CymruOrigin {
  asns: string[];
  prefix?: string;
  country?: string;
  registry?: string;
}

/** "13335 | 1.1.1.0/24 | US | arin | 2010-07-14" */
export function parseCymruOrigin(txt: string): CymruOrigin | undefined {
  const fields = txt.split("|").map((field) => field.trim());
  if (fields.length < 2) return undefined;
  const asns = fields[0].split(/\s+/).filter((value) => /^\d+$/.test(value));
  if (asns.length === 0) return undefined;
  return { asns, prefix: fields[1] || undefined, country: fields[2] || undefined, registry: fields[3] || undefined };
}

/** "13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US" */
export function parseCymruAsName(txt: string): string | undefined {
  const fields = txt.split("|").map((field) => field.trim());
  if (fields.length < 5) return undefined;
  return fields[4] || undefined;
}

const ptrName = (address: ObservedAddress): string =>
  address.version === 4
    ? reverseName4(address.ip)
    : `${reverseNibbles6(parseIp(address.ip).toNormalizedString())}.ip6.arpa`;

const cymruName = (address: ObservedAddress): string =>
  address.version === 4
    ? `${reverseName4(address.ip).replace(".in-addr.arpa", "")}.origin.asn.cymru.com`
    : `${reverseNibbles6(parseIp(address.ip).toNormalizedString())}.origin6.asn.cymru.com`;

/**
 * Network affiliation for addresses this investigation actually observed.
 *
 * Sources are public and named on every record: Team Cymru over DNS TXT first,
 * RIPEstat as a fallback. Nothing is guessed. The number of external questions
 * is bounded per investigation, and no address is queried that was not seen in
 * a DNS answer, an HTTP hop or the TLS handshake.
 */
export const networkProvider: Provider<NetworkProviderInput, NetworkProviderResult> = {
  id: "network",
  label: "Network",
  timeoutMs: LIMITS.provider.network,

  async run(context: ProviderContext, input: NetworkProviderInput) {
    const { evidence, deps, signal } = context;
    const limited = input.addresses.length > LIMITS.maxNetworkAddresses;
    const selected = input.addresses.slice(0, LIMITS.maxNetworkAddresses);

    if (selected.length === 0) {
      return {
        status: "unavailable" as const,
        message: "No public address was observed, so there is no network to describe.",
      };
    }

    const asnNames = new Map<string, string>();
    let ptrBudget = LIMITS.maxPtrQueries;
    const failures: string[] = [];

    const describe = async (address: ObservedAddress): Promise<NetworkAddress> => {
      const record: NetworkAddress = {
        ip: address.ip,
        version: address.version,
        source: CYMRU_SOURCE,
        sourceUrl: CYMRU_SOURCE_URL,
      };

      try {
        const origin = await deps.doh(cymruName(address), "TXT", signal);
        const txt = origin.answers.find((answer) => RECORD_TYPE_NAMES[answer.type] === "TXT");
        const parsed = txt ? parseCymruOrigin(decodeTxt(txt.data)) : undefined;
        if (parsed) {
          record.asn = parsed.asns.map((asn) => `AS${asn}`).join(", ");
          record.prefix = parsed.prefix;
          record.country = parsed.country;
          const primary = parsed.asns[0];
          if (primary) {
            const cached = asnNames.get(primary);
            if (cached !== undefined) {
              record.organization = cached;
            } else {
              try {
                const name = await deps.doh(`AS${primary}.asn.cymru.com`, "TXT", signal);
                const nameTxt = name.answers.find((answer) => RECORD_TYPE_NAMES[answer.type] === "TXT");
                const organization = nameTxt ? parseCymruAsName(decodeTxt(nameTxt.data)) : undefined;
                if (organization) {
                  asnNames.set(primary, organization);
                  record.organization = organization;
                }
              } catch {
                // The ASN number is still useful without a name.
              }
            }
          }
        }
      } catch (error) {
        failures.push(describeError(error, "the ASN lookup failed"));
      }

      if (!record.asn) {
        try {
          const info = (await deps.json(
            `https://stat.ripe.net/data/network-info/data.json?resource=${encodeURIComponent(address.ip)}`,
            signal,
          )) as { data?: { prefix?: string; asns?: string[] } };
          const asns = info.data?.asns ?? [];
          if (asns.length > 0) {
            record.asn = asns.map((asn) => `AS${asn}`).join(", ");
            record.prefix = info.data?.prefix;
            record.source = RIPE_SOURCE;
            record.sourceUrl = `https://stat.ripe.net/data/network-info/data.json?resource=${address.ip}`;
            try {
              const overview = (await deps.json(
                `https://stat.ripe.net/data/as-overview/data.json?resource=AS${encodeURIComponent(asns[0])}`,
                signal,
              )) as { data?: { holder?: string } };
              if (overview.data?.holder) record.organization = overview.data.holder;
            } catch {
              // Holder name is optional.
            }
          }
        } catch (error) {
          failures.push(describeError(error, "the registry lookup failed"));
        }
      }

      if (ptrBudget > 0) {
        ptrBudget -= 1;
        try {
          const ptr = await deps.doh(ptrName(address), "PTR", signal);
          const names = ptr.answers
            .filter((answer) => RECORD_TYPE_NAMES[answer.type] === "PTR")
            .map((answer) => answer.data.replace(/\.$/, ""));
          if (names.length > 0) record.ptr = names;
        } catch {
          // A missing PTR is normal and is not reported as a failure.
        }
      }

      return record;
    };

    const settled = await Promise.allSettled(selected.map(describe));
    const addresses: NetworkAddress[] = [];
    const facts: { value: string; evidenceId: string }[] = [];

    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      const observed = selected[index];
      if (outcome.status !== "fulfilled") {
        failures.push(describeError(outcome.reason, "an address lookup failed"));
        continue;
      }
      const record = outcome.value;
      addresses.push(record);

      evidence.record({
        source: "network",
        kind: "address",
        label: `Address observed by ${observed.observedBy.join(", ")}`,
        value: record.ip,
        confidence: "observed",
      });
      if (record.asn) {
        const factValue = [record.asn, record.organization, record.prefix, record.country].filter(Boolean).join(" | ");
        const factId = evidence.record({
          source: "network",
          kind: "asn",
          label: `Announcing network for ${record.ip}`,
          value: factValue,
          confidence: "observed",
          sourceUrl: record.sourceUrl,
          explanation: `${record.source}. ${ASN_CAVEAT}`,
        });
        facts.push({ value: factValue, evidenceId: factId });
      }
      if (record.ptr?.length) {
        evidence.record({
          source: "network",
          kind: "ptr",
          label: `Reverse DNS for ${record.ip}`,
          value: record.ptr.join(", "),
          confidence: "observed",
          explanation: "A PTR record is set by the address holder and is not verified against forward DNS.",
        });
      }
    }

    if (addresses.length === 0) {
      return {
        status: "unavailable" as const,
        message: failures[0] ?? "No network metadata was available for the observed addresses.",
      };
    }

    const described = addresses.filter((address) => Boolean(address.asn)).length;
    return {
      status: "complete" as const,
      message: described === addresses.length
        ? limited
          ? `Showing the first ${LIMITS.maxNetworkAddresses} observed addresses.`
          : undefined
        : `Network metadata was found for ${described} of ${addresses.length} observed addresses.`,
      data: { network: { addresses, limited }, facts },
    };
  },
};
