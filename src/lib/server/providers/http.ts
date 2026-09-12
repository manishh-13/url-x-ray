import type { HeaderSignal, HttpData, HttpHop } from "@/lib/types";
import { LIMITS } from "../limits";
import { classifyIp, type PinnedAddress } from "../ip-guard";
import { parseRedirectTarget, type UrlTarget } from "../url-parser";
import { redactUrl, sanitizeResponseHeaders } from "../redact";
import { choosePinnedAddress, resolveHostAddresses } from "../resolve";
import { describeError, isAbortError, type Provider, type ProviderContext } from "../provider";

export interface HttpProviderInput {
  /** Routable addresses for the original hostname, from the DNS provider. */
  addresses: PinnedAddress[];
  /** Non routable answers for the original hostname. Any entry blocks the request. */
  refused: { ip: string; reason: string }[];
  dnsAnswered: boolean;
}

/** Data kept in process for the technology provider. Never sent to a client. */
export interface HttpArtifacts {
  html: string;
  htmlBytes: number;
  htmlTruncated: boolean;
  contentType?: string;
  finalHeaders: Record<string, string>;
  /** Every peer address actually connected to, in hop order. */
  peers: PinnedAddress[];
  hostsVisited: string[];
}

export interface HttpProviderResult {
  http: HttpData;
  artifacts: HttpArtifacts;
}

const SIGNALS: { name: string; title: string; explanation: string }[] = [
  { name: "strict-transport-security", title: "HSTS", explanation: "Tells browsers to use HTTPS for this host in future, so a downgrade to http is refused." },
  { name: "content-security-policy", title: "Content Security Policy", explanation: "Restricts where scripts and other resources may load from." },
  { name: "x-content-type-options", title: "No MIME sniffing", explanation: "Stops browsers guessing a content type that differs from the declared one." },
  { name: "x-frame-options", title: "Framing control", explanation: "Limits which sites may place this page in a frame." },
  { name: "referrer-policy", title: "Referrer policy", explanation: "Controls how much of the current URL is sent to other sites." },
  { name: "permissions-policy", title: "Permissions policy", explanation: "Declares which browser capabilities the page may use." },
  { name: "cross-origin-opener-policy", title: "Cross origin isolation", explanation: "Separates this page's browsing context from other origins." },
];

const isRedirect = (status: number): boolean => status >= 300 && status < 400 && status !== 304;

const headerValue = (headers: Record<string, string>, name: string): string | undefined => headers[name];

export function buildHeaderSignals(headers: Record<string, string> | undefined): HeaderSignal[] {
  return SIGNALS.map((signal) => {
    if (!headers) {
      return { name: signal.name, title: signal.title, state: "unknown" as const, explanation: signal.explanation };
    }
    const value = headerValue(headers, signal.name);
    return {
      name: signal.name,
      title: signal.title,
      state: value === undefined ? ("absent" as const) : ("present" as const),
      explanation: signal.explanation,
      value,
    };
  });
}

/**
 * Follow the redirect chain with a fresh validation and a fresh pin at every
 * hop.
 *
 * Rules enforced here, in order, before any socket is opened for a hop:
 * the destination is re-parsed under the same scheme, port, credential and
 * hostname rules as the original URL; its name is resolved again and every
 * A and AAAA answer must be globally routable, so a name that mixes public and
 * private answers is refused rather than partly accepted; the connection is
 * pinned to one validated address so the address cannot change between the
 * check and the connection; and the address actually connected to is read back
 * from the socket and reported per hop.
 *
 * Query strings and fragments are never part of a request line: the target
 * carries a path only, and any query in a Location header is redacted before it
 * becomes evidence.
 */
export const httpProvider: Provider<HttpProviderInput, HttpProviderResult> = {
  id: "http",
  label: "HTTP",
  timeoutMs: LIMITS.provider.http,

  async run(context: ProviderContext, input: HttpProviderInput) {
    const { evidence, target } = context;
    const startedAt = Date.now();
    const hops: HttpHop[] = [];
    const peers: PinnedAddress[] = [];
    const hostsVisited: string[] = [target.hostname];
    const visited = new Set<string>([target.requestUrl]);

    let currentTarget: UrlTarget = target;
    let candidates = input.addresses;
    let refused = input.refused;
    let stoppedReason: string | undefined;
    let chainComplete = false;
    let artifacts: HttpArtifacts = {
      html: "",
      htmlBytes: 0,
      htmlTruncated: false,
      finalHeaders: {},
      peers,
      hostsVisited,
    };

    evidence.record({
      source: "http",
      kind: "privacy",
      label: "Request privacy",
      value: "GET only, no cookies, no credentials, no referrer, no query string, no fragment",
      confidence: "observed",
      explanation:
        "The query string and fragment of the submitted URL are discarded before any request is made, so they never appear in a request line, a log or a referrer.",
    });

    for (let attempt = 0; attempt <= LIMITS.maxRedirects; attempt += 1) {
      if (context.signal.aborted) {
        stoppedReason = "Investigation stopped.";
        break;
      }
      if (refused.length > 0) {
        stoppedReason = `${currentTarget.hostname} resolves to a ${refused[0].reason}, so no connection was attempted.`;
        evidence.record({
          source: "http",
          kind: "blocked",
          label: "Connection refused before any network I/O",
          value: `${currentTarget.hostname} -> ${refused[0].ip} (${refused[0].reason})`,
          confidence: "observed",
          explanation: "A host whose name resolves outside the public Internet is never contacted.",
        });
        break;
      }

      const pin = choosePinnedAddress(candidates);
      if (!pin) {
        stoppedReason = input.dnsAnswered
          ? `${currentTarget.hostname} has no public A or AAAA record, so there is nothing to connect to.`
          : `${currentTarget.hostname} could not be resolved, so no connection was attempted.`;
        break;
      }

      let response;
      try {
        response = await context.deps.http(
          {
            scheme: currentTarget.scheme,
            hostname: currentTarget.hostname,
            port: currentTarget.port,
            path: currentTarget.path,
            pinnedIp: pin.ip,
            ipVersion: pin.version,
            timeoutMs: LIMITS.httpHopMs,
            maxBodyBytes: LIMITS.maxHtmlBytes,
          },
          context.signal,
        );
      } catch (error) {
        stoppedReason = isAbortError(error)
          ? "The request was stopped before a response arrived."
          : describeError(error, "The request failed.");
        break;
      }

      const peerVerdict = response.peerAddress ? classifyIp(response.peerAddress) : undefined;
      if (peerVerdict && !peerVerdict.ok) {
        stoppedReason = `The connection landed on a ${peerVerdict.range} address, so the response was discarded.`;
        break;
      }

      const headers = sanitizeResponseHeaders(response.rawHeaders, currentTarget.requestUrl);
      const location = headers.location;
      const address = response.peerAddress ?? pin.ip;
      if (peerVerdict?.version) peers.push({ ip: address, version: peerVerdict.version });
      else peers.push(pin);

      hops.push({
        url: currentTarget.requestUrl,
        status: response.status,
        location,
        headers,
        durationMs: response.durationMs,
        address,
      });

      evidence.record({
        source: "http",
        kind: "hop",
        label: `HTTP ${response.status} from ${currentTarget.hostname}`,
        value: `${currentTarget.requestUrl} via ${address}`,
        confidence: "observed",
        explanation: `HTTP/${response.httpVersion} response from the address this hop actually connected to.`,
      });

      const pinNormalized = classifyIp(pin.ip).normalized;
      if (response.peerAddress && peerVerdict?.normalized !== pinNormalized) {
        evidence.record({
          source: "http",
          kind: "peer-mismatch",
          label: "Connected address differs from the pinned answer",
          value: `pinned ${pin.ip}, connected ${response.peerAddress}`,
          confidence: "observed",
          explanation: "DNS answers and the socket can disagree; the connected address is what this hop observed.",
        });
      }

      if (response.tlsProtocol) {
        evidence.record({
          source: "http",
          kind: "transport",
          label: `Transport for ${currentTarget.hostname}`,
          value: `${response.tlsProtocol}${response.tlsCipher ? ` (${response.tlsCipher})` : ""}`,
          confidence: "observed",
          explanation: "Negotiated by the verified application connection for this hop.",
        });
      }

      if (!isRedirect(response.status) || !location) {
        chainComplete = true;
        artifacts = {
          html: response.bodyRead ? response.bodyText : "",
          htmlBytes: response.bodyBytes,
          htmlTruncated: response.bodyTruncated,
          contentType: headers["content-type"],
          finalHeaders: headers,
          peers,
          hostsVisited,
        };
        break;
      }

      if (attempt === LIMITS.maxRedirects) {
        stoppedReason = `Stopped after ${LIMITS.maxRedirects} redirects.`;
        break;
      }

      const rawLocation = response.rawHeaders.location;
      const locationValue = Array.isArray(rawLocation) ? rawLocation[0] : rawLocation;
      const next = parseRedirectTarget(String(locationValue ?? ""), currentTarget.requestUrl);
      if (!next.ok) {
        stoppedReason = `Redirect refused before any connection: ${next.message}`;
        evidence.record({
          source: "http",
          kind: "blocked",
          label: "Redirect destination refused",
          value: `${redactUrl(String(locationValue ?? ""), currentTarget.requestUrl)} (${next.code})`,
          confidence: "observed",
          explanation: "The destination was rejected by the same rules as the submitted URL, before any request was made.",
        });
        break;
      }

      if (visited.has(next.target.requestUrl)) {
        stoppedReason = "The redirect chain returns to a URL it already visited.";
        break;
      }
      visited.add(next.target.requestUrl);

      if (next.target.hostname !== currentTarget.hostname) {
        if (!hostsVisited.includes(next.target.hostname)) hostsVisited.push(next.target.hostname);
        if (next.target.isIpLiteral) {
          const verdict = classifyIp(next.target.hostname);
          candidates = verdict.ok && verdict.version ? [{ ip: next.target.hostname, version: verdict.version }] : [];
          refused = verdict.ok ? [] : [{ ip: next.target.hostname, reason: verdict.reason ?? verdict.range }];
        } else {
          const resolution = await resolveHostAddresses(next.target.hostname, context.deps.doh, context.signal);
          candidates = resolution.addresses;
          refused = resolution.refused;
          if (!resolution.answered) {
            stoppedReason = `${next.target.hostname} could not be resolved, so the redirect was not followed.`;
            break;
          }
        }
      }
      currentTarget = next.target;
    }

    const last = hops[hops.length - 1];
    const http: HttpData = {
      hops,
      finalUrl: last?.url ?? target.requestUrl,
      finalStatus: last?.status ?? 0,
      redirectCount: Math.max(hops.length - 1, 0),
      chainComplete,
      stoppedReason,
      headerSignals: buildHeaderSignals(chainComplete ? artifacts.finalHeaders : undefined),
      durationMs: Date.now() - startedAt,
    };

    if (hops.length === 0) {
      return {
        status: "unavailable" as const,
        message: stoppedReason ?? "No response was received.",
        data: { http, artifacts },
      };
    }
    return {
      status: "complete" as const,
      message: stoppedReason,
      data: { http, artifacts },
    };
  },
};
