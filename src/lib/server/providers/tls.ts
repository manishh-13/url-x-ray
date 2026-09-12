import type { CertificateLink, TlsData } from "@/lib/types";
import { LIMITS } from "../limits";
import { classifyIp, type PinnedAddress } from "../ip-guard";
import { choosePinnedAddress } from "../resolve";
import { daysUntil } from "../certificate";
import { describeError, isAbortError, type Provider, type ProviderContext } from "../provider";

export interface TlsProviderInput {
  addresses: PinnedAddress[];
  refused: { ip: string; reason: string }[];
}

export interface TlsProviderResult {
  tls: TlsData;
  /** The address the handshake used, so the network provider can cite it. */
  peer?: PinnedAddress;
}

/**
 * An independent handshake to the original hostname, separate from the HTTP
 * chain, so a certificate can be described even when the site redirects away
 * immediately or refuses the request.
 *
 * The handshake uses the submitted hostname in SNI against a pinned public
 * address, has its own strict timeout, and closes as soon as the certificate is
 * read. No application data is written. A certificate that fails verification is
 * still described, clearly marked as not authorized with the reason, which is a
 * report about the certificate and not a relaxation of the HTTP layer: the HTTP
 * provider keeps Node's default verification for everything it fetches.
 */
export const tlsProvider: Provider<TlsProviderInput, TlsProviderResult> = {
  id: "tls",
  label: "TLS",
  timeoutMs: LIMITS.provider.tls,

  async run(context: ProviderContext, input: TlsProviderInput) {
    const { target, evidence } = context;

    if (target.scheme !== "https") {
      return {
        status: "unavailable" as const,
        message: "This URL is plain http, so there is no certificate to inspect.",
      };
    }
    if (input.refused.length > 0) {
      return {
        status: "unavailable" as const,
        message: `${target.hostname} resolves to a ${input.refused[0].reason}, so no handshake was attempted.`,
      };
    }
    const pin = choosePinnedAddress(input.addresses);
    if (!pin) {
      return {
        status: "unavailable" as const,
        message: "No public address was available for a handshake.",
      };
    }

    let result;
    try {
      result = await context.deps.tls(
        {
          hostname: target.hostname,
          port: 443,
          pinnedIp: pin.ip,
          ipVersion: pin.version,
          timeoutMs: LIMITS.tlsHandshakeMs,
        },
        context.signal,
      );
    } catch (error) {
      return {
        status: "unavailable" as const,
        message: isAbortError(error)
          ? "The handshake was stopped before it finished."
          : describeError(error, "The handshake could not be completed."),
      };
    }

    const leaf = result.chain[0];
    if (!leaf) {
      return { status: "unavailable" as const, message: "The peer completed a handshake without presenting a certificate." };
    }

    const chain: CertificateLink[] = result.chain.map((node) => ({
      subject: node.subject || node.subjectCommonName,
      issuer: node.issuer || node.issuerCommonName,
      validTo: node.validTo,
    }));

    const tls: TlsData = {
      hostname: target.hostname,
      issuer: leaf.issuer || leaf.issuerCommonName,
      subject: leaf.subject || leaf.subjectCommonName,
      sans: leaf.sans,
      validFrom: leaf.validFrom,
      validTo: leaf.validTo,
      protocol: result.protocol ?? "unknown",
      fingerprint256: leaf.fingerprint256,
      authorized: result.authorized,
      authorizationError: result.authorizationError,
      chain,
    };

    const handshakeAddress = result.peerAddress ?? pin.ip;
    evidence.record({
      source: "tls",
      kind: "handshake",
      label: `Handshake with ${target.hostname}`,
      value: `${result.protocol ?? "unknown protocol"} via ${handshakeAddress}`,
      confidence: "observed",
      explanation: "A handshake to a pinned public address using the original hostname in SNI. No application data was sent.",
    });
    evidence.record({
      source: "tls",
      kind: "certificate",
      label: "Certificate subject",
      value: tls.subject,
      confidence: "observed",
      explanation: "Read from the certificate the peer presented.",
    });
    evidence.record({
      source: "tls",
      kind: "certificate",
      label: "Certificate issuer",
      value: tls.issuer,
      confidence: "observed",
      explanation: "The authority that signed this certificate.",
    });
    const remaining = daysUntil(tls.validTo, context.now());
    evidence.record({
      source: "tls",
      kind: "validity",
      label: "Certificate validity",
      value: `${tls.validFrom} to ${tls.validTo}${remaining === undefined ? "" : ` (${remaining} days left)`}`,
      confidence: "observed",
    });
    if (tls.fingerprint256) {
      evidence.record({
        source: "tls",
        kind: "fingerprint",
        label: "SHA-256 fingerprint",
        value: tls.fingerprint256,
        confidence: "observed",
      });
    }
    if (!tls.authorized) {
      evidence.record({
        source: "tls",
        kind: "authorization",
        label: "Certificate did not verify",
        value: tls.authorizationError ?? "unverified",
        confidence: "observed",
        explanation: "The certificate was read for description only. Verification failed against the submitted hostname.",
      });
    }

    const peerVerdict = classifyIp(handshakeAddress);
    return {
      status: "complete" as const,
      message: tls.authorized
        ? result.chain.length === 1
          ? "The peer sent only the leaf certificate, so the chain shown is incomplete."
          : undefined
        : `The certificate did not verify: ${tls.authorizationError ?? "unverified"}.`,
      data: {
        tls,
        peer: peerVerdict.ok && peerVerdict.version ? { ip: handshakeAddress, version: peerVerdict.version } : undefined,
      },
    };
  },
};
