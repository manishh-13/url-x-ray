import { RECORD_TYPE_NAMES, type DohQuery } from "./doh";
import { classifyIp, type PinnedAddress } from "./ip-guard";

export interface AddressResolution {
  /** Addresses that passed the routability check. */
  addresses: PinnedAddress[];
  /** Addresses that failed it, with the range that caused the refusal. */
  refused: { ip: string; reason: string }[];
  /** True when at least one question was answered, regardless of records found. */
  answered: boolean;
}

/**
 * Resolve A and AAAA for a hostname and classify every answer.
 *
 * Callers must refuse the host outright when refused is non empty. Accepting the
 * routable subset would let a name that answers with both a public and a private
 * address steer a connection inward on a later lookup.
 */
export async function resolveHostAddresses(
  hostname: string,
  doh: DohQuery,
  signal: AbortSignal,
): Promise<AddressResolution> {
  const addresses: PinnedAddress[] = [];
  const refused: { ip: string; reason: string }[] = [];
  const seen = new Set<string>();
  let answered = false;

  const results = await Promise.allSettled([
    doh(hostname, "A", signal),
    doh(hostname, "AAAA", signal),
  ]);

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    answered = true;
    for (const answer of result.value.answers) {
      const type = RECORD_TYPE_NAMES[answer.type];
      if (type !== "A" && type !== "AAAA") continue;
      const verdict = classifyIp(answer.data);
      const key = verdict.normalized ?? answer.data;
      if (seen.has(key)) continue;
      seen.add(key);
      if (verdict.ok && verdict.version) addresses.push({ ip: answer.data, version: verdict.version });
      else refused.push({ ip: answer.data, reason: verdict.reason ?? verdict.range });
    }
  }

  return { addresses, refused, answered };
}

/** Prefer IPv4 for reachability, but never invent an address. */
export function choosePinnedAddress(addresses: PinnedAddress[]): PinnedAddress | undefined {
  return addresses.find((entry) => entry.version === 4) ?? addresses[0];
}
