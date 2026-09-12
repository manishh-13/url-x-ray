import { LIMITS } from "./limits";

/** The subset of Node's PeerCertificate this tool reads. */
export interface RawPeerCertificate {
  subject?: Record<string, string | string[]> | null;
  issuer?: Record<string, string | string[]> | null;
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  fingerprint256?: string;
  serialNumber?: string;
  bits?: number;
  asn1Curve?: string;
  nistCurve?: string;
  pubkey?: unknown;
  issuerCertificate?: RawPeerCertificate | null;
}

export interface CertificateNode {
  subject: string;
  subjectCommonName: string;
  issuer: string;
  issuerCommonName: string;
  validFrom: string;
  validTo: string;
  fingerprint256: string;
  serialNumber: string;
  sans: string[];
  selfSigned: boolean;
}

const DN_ORDER = ["CN", "O", "OU", "L", "ST", "C"];

/** Format an X.509 name as a stable, readable string. */
export function formatDistinguishedName(name: Record<string, string | string[]> | null | undefined): string {
  if (!name) return "";
  const parts: string[] = [];
  for (const key of DN_ORDER) {
    const value = name[key];
    if (value === undefined) continue;
    const flat = Array.isArray(value) ? value.join(" + ") : value;
    if (flat) parts.push(`${key}=${flat}`);
  }
  return parts.join(", ");
}

export function commonNameOf(name: Record<string, string | string[]> | null | undefined): string {
  const value = name?.CN;
  if (value === undefined) return "";
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

/** "DNS:a.example, DNS:b.example, IP Address:203.0.113.1" split into entries. */
export function parseSubjectAltNames(subjectaltname: string | undefined): string[] {
  if (!subjectaltname) return [];
  const seen: string[] = [];
  for (const raw of subjectaltname.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    if (!seen.includes(entry)) seen.push(entry);
    if (seen.length >= 64) break;
  }
  return seen;
}

function toNode(certificate: RawPeerCertificate): CertificateNode {
  const subject = formatDistinguishedName(certificate.subject);
  const issuer = formatDistinguishedName(certificate.issuer);
  return {
    subject,
    subjectCommonName: commonNameOf(certificate.subject),
    issuer,
    issuerCommonName: commonNameOf(certificate.issuer),
    validFrom: certificate.valid_from ?? "",
    validTo: certificate.valid_to ?? "",
    fingerprint256: certificate.fingerprint256 ?? "",
    serialNumber: certificate.serialNumber ?? "",
    sans: parseSubjectAltNames(certificate.subjectaltname),
    selfSigned: Boolean(subject) && subject === issuer,
  };
}

/**
 * Unroll a certificate chain into plain, serializable records.
 *
 * The walk is bounded by depth and guarded against cycles by fingerprint and by
 * object identity, because a self signed root points at itself and a hostile
 * peer can present a loop.
 */
export function flattenCertificateChain(
  leaf: RawPeerCertificate | null | undefined,
  maxDepth = LIMITS.maxChainDepth,
): CertificateNode[] {
  const chain: CertificateNode[] = [];
  if (!leaf || Object.keys(leaf).length === 0) return chain;

  const seenObjects = new Set<RawPeerCertificate>();
  const seenFingerprints = new Set<string>();
  let current: RawPeerCertificate | null | undefined = leaf;

  while (current && chain.length < maxDepth) {
    if (seenObjects.has(current)) break;
    seenObjects.add(current);
    const node = toNode(current);
    if (node.fingerprint256) {
      if (seenFingerprints.has(node.fingerprint256)) break;
      seenFingerprints.add(node.fingerprint256);
    }
    chain.push(node);
    const next: RawPeerCertificate | null | undefined = current.issuerCertificate;
    if (!next || next === current) break;
    current = next;
  }
  return chain;
}

/** Days until expiry, negative when already expired. Undefined when unparseable. */
export function daysUntil(validTo: string, now: Date): number | undefined {
  const expiry = Date.parse(validTo);
  if (Number.isNaN(expiry)) return undefined;
  return Math.floor((expiry - now.getTime()) / 86_400_000);
}
