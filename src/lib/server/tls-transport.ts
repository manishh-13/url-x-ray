import tls from "node:tls";
import { LIMITS } from "./limits";
import { assertGloballyRoutableIp, type IpVersion } from "./ip-guard";
import { flattenCertificateChain, type CertificateNode, type RawPeerCertificate } from "./certificate";

export interface TlsProbeRequest {
  /** The name presented in SNI and checked against the certificate. */
  hostname: string;
  port: number;
  /** Pre validated public address the handshake connects to. */
  pinnedIp: string;
  /** Kept for the guard contract and for tests; the host is already a literal. */
  ipVersion: IpVersion;
  timeoutMs?: number;
}

export interface TlsProbeResult {
  authorized: boolean;
  authorizationError?: string;
  protocol?: string;
  cipher?: string;
  alpnProtocol?: string;
  peerAddress?: string;
  chain: CertificateNode[];
  durationMs: number;
}

export type TlsTransport = (request: TlsProbeRequest, signal: AbortSignal) => Promise<TlsProbeResult>;

/**
 * Handshake with the original hostname in SNI against a pinned public address,
 * then close without sending a single application byte.
 *
 * Verification is deliberately not enforced at the socket level so that an
 * expired, misissued or mismatched certificate can still be described instead
 * of collapsing into one opaque error. The verdict is reported honestly through
 * authorized and authorizationError, and the HTTP path keeps Node's default
 * verification, so nothing about application traffic is weakened here.
 */
export const nodeTlsTransport: TlsTransport = (request, signal) => {
  assertGloballyRoutableIp(request.pinnedIp);
  const timeoutMs = request.timeoutMs ?? LIMITS.tlsHandshakeMs;
  const startedAt = Date.now();

  return new Promise<TlsProbeResult>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Investigation cancelled"));
      return;
    }
    const socket = tls.connect({
      host: request.pinnedIp,
      port: request.port,
      servername: request.hostname,
      rejectUnauthorized: false,
      ALPNProtocols: ["h2", "http/1.1"],
      // No session resumption state is kept, and no data is written.
      session: undefined,
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      socket.destroy();
      fn();
    };
    const fail = (message: string) => finish(() => reject(new Error(message)));
    const timer = setTimeout(() => fail(`TLS handshake timed out after ${timeoutMs}ms`), timeoutMs);
    const onAbort = () => fail("Investigation cancelled");
    signal.addEventListener("abort", onAbort, { once: true });

    socket.setTimeout(timeoutMs, () => fail(`TLS socket idle for ${timeoutMs}ms`));
    socket.on("error", (error: Error) => fail(error.message));
    socket.on("close", () => fail("The peer closed the connection before the handshake finished"));

    socket.on("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true) as unknown as RawPeerCertificate | null;
      finish(() => resolve({
        authorized: socket.authorized,
        authorizationError: socket.authorized ? undefined : String(socket.authorizationError ?? "unverified"),
        protocol: socket.getProtocol() ?? undefined,
        cipher: socket.getCipher()?.name,
        alpnProtocol: typeof socket.alpnProtocol === "string" ? socket.alpnProtocol : undefined,
        peerAddress: socket.remoteAddress,
        chain: flattenCertificateChain(certificate),
        durationMs: Date.now() - startedAt,
      }));
    });
  });
};
