import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import { LIMITS } from "./limits";
import { assertGloballyRoutableIp, type IpVersion } from "./ip-guard";

export interface PinnedRequest {
  scheme: "https" | "http";
  hostname: string;
  port: number;
  /** Path only. Callers strip query and fragment before they get here. */
  path: string;
  /** The exact address the socket must connect to. */
  pinnedIp: string;
  ipVersion: IpVersion;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export interface PinnedResponse {
  status: number;
  statusMessage: string;
  httpVersion: string;
  /** As received. Sanitizing happens above this layer. */
  rawHeaders: Record<string, string | string[] | undefined>;
  /** The address the socket actually connected to, read back from the socket. */
  peerAddress?: string;
  peerPort?: number;
  /** HTML kept for structural analysis only. Never serialized to a client. */
  bodyText: string;
  bodyBytes: number;
  bodyTruncated: boolean;
  bodyRead: boolean;
  durationMs: number;
  tlsProtocol?: string;
  tlsCipher?: string;
  tlsAuthorized?: boolean;
}

export type HttpTransport = (request: PinnedRequest, signal: AbortSignal) => Promise<PinnedResponse>;

const USER_AGENT = "url-x-ray/0.1 (public metadata reader; GET only)";

const isHtml = (contentType: string | undefined): boolean => {
  if (!contentType) return false;
  const type = contentType.split(";")[0].trim().toLowerCase();
  return type === "text/html" || type === "application/xhtml+xml";
};

/**
 * Perform exactly one GET against a pinned address.
 *
 * The hostname stays in the request options so TLS certificate identity and the
 * Host header are correct, while a fixed lookup function forces the socket onto
 * the address that was already validated as globally routable. That closes the
 * gap between resolution and connection, so a name that answers differently on
 * a second lookup cannot move the connection to a private address.
 *
 * No cookies, no Authorization, no Referer, no proxy, no redirect following and
 * no subresource fetching happen here.
 */
export const nodeHttpTransport: HttpTransport = (request, signal) => {
  assertGloballyRoutableIp(request.pinnedIp);
  const timeoutMs = request.timeoutMs ?? LIMITS.httpHopMs;
  const maxBodyBytes = request.maxBodyBytes ?? LIMITS.maxHtmlBytes;
  const startedAt = Date.now();

  return new Promise<PinnedResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Investigation cancelled"));
      return;
    }
    const secure = request.scheme === "https";
    const agent = secure
      ? new https.Agent({ keepAlive: false, maxSockets: 1 })
      : new http.Agent({ keepAlive: false, maxSockets: 1 });

    const options: https.RequestOptions = {
      protocol: `${request.scheme}:`,
      host: request.hostname,
      servername: secure ? request.hostname : undefined,
      port: request.port,
      path: request.path,
      method: "GET",
      agent,
      family: request.ipVersion,
      setHost: true,
      // TLS verification stays at Node defaults for application traffic.
      rejectUnauthorized: true,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-encoding": "identity",
        "user-agent": USER_AGENT,
        connection: "close",
      },
      lookup: pinnedLookup(request.pinnedIp, request.ipVersion),
    };

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      agent.destroy();
      fn();
    };

    const clientRequest = (secure ? https : http).request(options);

    const fail = (message: string) => {
      clientRequest.destroy();
      finish(() => reject(new Error(message)));
    };

    const timer = setTimeout(() => fail(`Timed out after ${timeoutMs}ms`), timeoutMs);
    const onAbort = () => fail("Investigation cancelled");
    signal.addEventListener("abort", onAbort, { once: true });

    clientRequest.on("error", (error: Error) => fail(error.message));

    clientRequest.on("socket", (socket) => {
      socket.setTimeout(timeoutMs, () => fail(`Socket idle for ${timeoutMs}ms`));
    });

    clientRequest.on("response", (response) => {
      const socket = response.socket;
      const peerAddress = socket?.remoteAddress;
      const peerPort = socket?.remotePort;
      const tlsSocket = socket as unknown as {
        getProtocol?: () => string | null;
        getCipher?: () => { name: string } | null;
        authorized?: boolean;
      };

      const base = {
        status: response.statusCode ?? 0,
        statusMessage: response.statusMessage ?? "",
        httpVersion: response.httpVersion,
        rawHeaders: response.headers as Record<string, string | string[] | undefined>,
        peerAddress,
        peerPort,
        tlsProtocol: secure ? (tlsSocket.getProtocol?.() ?? undefined) : undefined,
        tlsCipher: secure ? (tlsSocket.getCipher?.()?.name ?? undefined) : undefined,
        tlsAuthorized: secure ? tlsSocket.authorized : undefined,
      };

      const status = base.status;
      const wantBody = status >= 200 && status < 300 && isHtml(
        Array.isArray(response.headers["content-type"])
          ? response.headers["content-type"][0]
          : response.headers["content-type"],
      );

      if (!wantBody) {
        response.destroy();
        finish(() => resolve({
          ...base,
          bodyText: "",
          bodyBytes: 0,
          bodyTruncated: false,
          bodyRead: false,
          durationMs: Date.now() - startedAt,
        }));
        return;
      }

      const chunks: Buffer[] = [];
      let received = 0;
      let truncated = false;

      response.on("data", (chunk: Buffer) => {
        if (settled) return;
        const remaining = maxBodyBytes - received;
        if (remaining <= 0) {
          truncated = true;
          response.destroy();
          return;
        }
        if (chunk.length > remaining) {
          chunks.push(chunk.subarray(0, remaining));
          received += remaining;
          truncated = true;
          response.destroy();
          return;
        }
        chunks.push(chunk);
        received += chunk.length;
      });

      const done = () => finish(() => resolve({
        ...base,
        bodyText: Buffer.concat(chunks).toString("utf8"),
        bodyBytes: received,
        bodyTruncated: truncated,
        bodyRead: true,
        durationMs: Date.now() - startedAt,
      }));

      response.on("end", done);
      response.on("close", done);
      response.on("error", (error: Error) => {
        if (truncated) done();
        else fail(error.message);
      });
    });

    clientRequest.end();
  });
};

/**
 * A dns.lookup replacement that always answers with one pre validated address.
 * Exported so tests can assert the socket layer never resolves a name itself.
 */
export function pinnedLookup(ip: string, version: IpVersion) {
  return (
    _hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ): void => {
    const all = Boolean((options as { all?: boolean } | undefined)?.all);
    if (all) callback(null, [{ address: ip, family: version }]);
    else callback(null, ip, version);
  };
}
