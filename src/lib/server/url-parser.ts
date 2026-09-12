import type { ParsedUrl } from "@/lib/types";
import { LIMITS } from "./limits";
import { classifyIp } from "./ip-guard";
import { displayUrl, queryKeysOf, redactUrl } from "./redact";

export type RejectionCode =
  | "empty"
  | "too_long"
  | "malformed"
  | "unsupported_scheme"
  | "credentials"
  | "missing_host"
  | "nonstandard_port"
  | "single_label_host"
  | "reserved_host"
  | "non_routable_host"
  | "invalid_host";

export interface UrlTarget {
  scheme: "https" | "http";
  hostname: string;
  /** Always explicit, so the socket layer never has to guess. */
  port: number;
  /** Path only. Query and fragment are discarded before any request is made. */
  path: string;
  /** Absolute URL actually requested: no credentials, no query, no fragment. */
  requestUrl: string;
  isIpLiteral: boolean;
}

export type ParseOutcome =
  | { ok: true; url: ParsedUrl; target: UrlTarget }
  | { ok: false; code: RejectionCode; message: string };

/** Schemes a user might paste that must never reach the network layer. */
const REJECTED_SCHEMES = new Set([
  "javascript", "data", "file", "blob", "about", "ftp", "ftps", "sftp", "ws", "wss",
  "mailto", "tel", "gopher", "ldap", "ldaps", "dict", "chrome", "chrome-extension",
  "view-source", "resource", "jar", "smb", "nfs", "telnet", "ssh", "gemini", "ipfs", "ipns",
]);

/**
 * Top level suffixes that never resolve on the public Internet, or that resolve
 * only inside a private network. Matched on the last label and on full names.
 */
const RESERVED_SUFFIXES = [
  "localhost", "local", "localdomain", "internal", "intranet", "private",
  "corp", "home", "home.arpa", "lan", "test", "invalid", "example",
  "onion", "i2p", "alt", "arpa", "dhcp", "domain", "workgroup",
];

const RESERVED_EXACT = new Set([
  "localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback",
  "broadcasthost", "metadata", "metadata.google.internal", "instance-data",
]);

const HOST_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;

const hasExplicitScheme = (raw: string): boolean => {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(raw);
  if (!match) return false;
  const scheme = match[1].toLowerCase();
  return scheme === "http" || scheme === "https" || REJECTED_SCHEMES.has(scheme) || raw.slice(match[0].length).startsWith("//");
};

const reject = (code: RejectionCode, message: string): ParseOutcome => ({ ok: false, code, message });

/**
 * Parse and fully validate a user submitted URL.
 *
 * The returned ParsedUrl is safe to serialize to the client: credentials are
 * gone, query values are replaced by their keys only and the fragment is
 * recorded as a boolean. The returned target carries no query and no fragment
 * at all, so nothing sensitive can leave the process in a request line.
 */
export function parseTargetUrl(raw: string): ParseOutcome {
  const input = (raw ?? "").trim();
  if (!input) return reject("empty", "Enter a URL to investigate.");
  if (input.length > LIMITS.maxUrlChars) {
    return reject("too_long", `That URL is longer than the ${LIMITS.maxUrlChars} character limit.`);
  }
  if (/[\s\u0000-\u001f\u007f]/.test(input)) {
    return reject("malformed", "That URL contains whitespace or control characters.");
  }

  const candidate = hasExplicitScheme(input) ? input : `https://${input}`;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return reject("malformed", "That does not look like a URL.");
  }

  const scheme = parsed.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return reject("unsupported_scheme", `Only http and https can be investigated, not ${scheme}.`);
  }
  if (parsed.username || parsed.password) {
    return reject("credentials", "Remove the username or password from the URL. Credentials are never sent.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname) return reject("missing_host", "That URL has no hostname.");

  const port = parsed.port ? Number(parsed.port) : scheme === "https" ? 443 : 80;
  const standardPort = scheme === "https" ? 443 : 80;
  if (port !== standardPort) {
    return reject("nonstandard_port", `Only the standard port ${standardPort} is investigated, not ${port}.`);
  }

  const hostVerdict = validateHostname(hostname);
  if (!hostVerdict.ok) return reject(hostVerdict.code, hostVerdict.message);

  const path = parsed.pathname || "/";
  const authority = hostname.includes(":") ? `[${hostname}]` : hostname;
  const requestUrl = `${scheme}://${authority}${path}`;
  const queryKeys = queryKeysOf(parsed.search);

  const url: ParsedUrl = {
    href: redactUrl(parsed.toString()),
    hostname,
    scheme,
    port: String(port),
    pathname: path,
    queryKeys,
    hasQuery: parsed.search.length > 1,
    hasFragment: parsed.hash.length > 0,
    display: displayUrl(parsed),
  };

  return {
    ok: true,
    url,
    target: { scheme, hostname, port, path, requestUrl, isIpLiteral: hostVerdict.isIpLiteral },
  };
}

type HostVerdict =
  | { ok: true; isIpLiteral: boolean }
  | { ok: false; code: RejectionCode; message: string };

/**
 * Hostname rules applied before any resolution happens. IP literals are
 * classified directly; names must be multi label and must not sit under a
 * suffix that only exists inside private networks.
 */
export function validateHostname(hostname: string): HostVerdict {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host.length > 253) return { ok: false, code: "invalid_host", message: "That hostname is too long." };

  const looksLikeIp = /^[0-9.]+$/.test(host) || host.includes(":");
  if (looksLikeIp) {
    const verdict = classifyIp(host);
    if (!verdict.ok) {
      return {
        ok: false,
        code: "non_routable_host",
        message: `That address is not on the public Internet (${verdict.reason ?? verdict.range}).`,
      };
    }
    return { ok: true, isIpLiteral: true };
  }

  if (RESERVED_EXACT.has(host)) {
    return { ok: false, code: "reserved_host", message: `${host} is a local name, not a public host.` };
  }
  const labels = host.split(".");
  if (labels.length < 2) {
    return {
      ok: false,
      code: "single_label_host",
      message: "Use a full public hostname, for example example.com.",
    };
  }
  for (const label of labels) {
    if (!label || label.length > 63 || !HOST_LABEL.test(label)) {
      return { ok: false, code: "invalid_host", message: "That hostname has an invalid label." };
    }
  }
  const suffix = labels[labels.length - 1];
  const lastTwo = labels.slice(-2).join(".");
  if (RESERVED_SUFFIXES.includes(suffix) || RESERVED_SUFFIXES.includes(lastTwo)) {
    return {
      ok: false,
      code: "reserved_host",
      message: `.${suffix} names are reserved or private, so there is nothing public to investigate.`,
    };
  }
  return { ok: true, isIpLiteral: false };
}

/**
 * Revalidate a redirect destination against the same rules, resolved relative
 * to the hop it came from. Returned before any socket is opened.
 */
export function parseRedirectTarget(location: string, base: string): ParseOutcome {
  const value = (location ?? "").trim();
  if (!value) return reject("empty", "The redirect had no destination.");
  let absolute: string;
  try {
    absolute = new URL(value, base).toString();
  } catch {
    return reject("malformed", "The redirect destination is not a valid URL.");
  }
  return parseTargetUrl(absolute);
}
