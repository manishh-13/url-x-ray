import { parse as parseIp, isValid as isValidIp } from "ipaddr.js";

export type IpVersion = 4 | 6;

/** An address that has already passed the routability check. */
export interface PinnedAddress {
  ip: string;
  version: IpVersion;
}

export interface IpVerdict {
  ok: boolean;
  /** ipaddr.js range name, kept for evidence and error messages. */
  range: string;
  version?: IpVersion;
  /** Canonical form, so 2606:4700::0:0:1 and 2606:4700::1 compare equal. */
  normalized?: string;
  reason?: string;
}

/**
 * Only ipaddr.js "unicast" is treated as globally routable. Every other range
 * name is a rejection, which means new special use ranges added upstream are
 * denied by default rather than allowed by omission. IPv4 mapped IPv6,
 * 6to4, Teredo, carrier grade NAT, loopback, link local, unique local,
 * multicast, broadcast, unspecified and reserved all carry their own names.
 */
export function classifyIp(candidate: string): IpVerdict {
  const value = (candidate ?? "").trim();
  if (!value) return { ok: false, range: "invalid", reason: "empty address" };
  if (value.includes("%")) return { ok: false, range: "invalid", reason: "zone scoped address" };
  if (!isValidIp(value)) return { ok: false, range: "invalid", reason: "not an IP address" };
  const address = parseIp(value);
  const version: IpVersion = address.kind() === "ipv4" ? 4 : 6;
  const range = address.range();
  if (range !== "unicast") {
    return { ok: false, range, version, normalized: address.toNormalizedString(), reason: `${range} address` };
  }
  // Defence in depth: an IPv6 unicast that carries an embedded IPv4 address is
  // rejected even if a future ipaddr.js labels it unicast.
  if (version === 6 && "isIPv4MappedAddress" in address && address.isIPv4MappedAddress()) {
    return { ok: false, range: "ipv4Mapped", version, reason: "IPv4 mapped IPv6 address" };
  }
  return { ok: true, range, version, normalized: address.toNormalizedString() };
}

export function isGloballyRoutableIp(candidate: string): boolean {
  return classifyIp(candidate).ok;
}

export function ipVersion(candidate: string): IpVersion | undefined {
  return classifyIp(candidate).version;
}

/** Throws rather than returning, for the last check before a socket is opened. */
export function assertGloballyRoutableIp(candidate: string): { ip: string; version: IpVersion } {
  const verdict = classifyIp(candidate);
  if (!verdict.ok || !verdict.version) {
    throw new Error(`Refusing to connect to ${verdict.range} address: ${verdict.reason ?? "not routable"}`);
  }
  return { ip: candidate, version: verdict.version };
}
