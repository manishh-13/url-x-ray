import { LIMITS } from "./limits";

export const REDACTED = "[redacted]";

/**
 * Header names whose values are never returned to the client. Cookies and
 * credentials are the obvious ones; the rest can carry tokens in practice.
 */
const SENSITIVE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "cookie",
  "cookie2",
  "authorization",
  "proxy-authorization",
  "www-authenticate",
  "proxy-authenticate",
  "authentication-info",
  "proxy-authentication-info",
  "x-amz-security-token",
  "x-amz-credential",
  "x-goog-authenticated-user-email",
  "x-goog-authenticated-user-id",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "x-session-token",
  "x-subject-token",
]);

/** Headers whose values are URLs, so their query strings need redacting too. */
const URL_VALUED_HEADERS = new Set([
  "location",
  "content-location",
  "refresh",
  "link",
  "x-pjax-url",
  "x-redirect-to",
]);

export function isSensitiveHeader(name: string): boolean {
  return SENSITIVE_HEADERS.has(name.toLowerCase());
}

/** Keys of a query string, deduplicated and bounded. Values are never kept. */
export function queryKeysOf(search: string): string[] {
  if (!search || search === "?") return [];
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const keys: string[] = [];
  for (const key of params.keys()) {
    if (!keys.includes(key)) keys.push(key);
    if (keys.length >= LIMITS.maxQueryKeys) break;
  }
  return keys;
}

/** "?token=abc&id=7" becomes "?token=[redacted]&id=[redacted]". */
export function redactSearch(search: string): string {
  const keys = queryKeysOf(search);
  // A bare "?" carries nothing; anything else with no readable key is still hidden.
  if (keys.length === 0) return search.length > 1 ? "?" + REDACTED : "";
  return "?" + keys.map((key) => `${key}=${REDACTED}`).join("&");
}

/**
 * Make any absolute or relative URL safe to show and to store as evidence:
 * credentials removed, query values redacted, fragment dropped entirely.
 * Unparseable input is reported as such rather than echoed back.
 */
export function redactUrl(raw: string, base?: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  let parsed: URL;
  try {
    parsed = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return "[unparseable url]";
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  const search = redactSearch(parsed.search);
  parsed.search = "";
  return parsed.toString() + search;
}

/**
 * Redact query strings inside free text such as Link or Refresh headers,
 * where the URL is embedded in other syntax and cannot be parsed as a whole.
 */
export function redactUrlsInText(text: string): string {
  return text.replace(/[^\s<>"';,]*\?[^\s<>"';,]*/g, (token) => {
    const hashIndex = token.indexOf("#");
    const withoutFragment = hashIndex >= 0 ? token.slice(0, hashIndex) : token;
    const mark = withoutFragment.indexOf("?");
    if (mark < 0) return withoutFragment;
    return withoutFragment.slice(0, mark) + redactSearch(withoutFragment.slice(mark));
  });
}

/** Display form: scheme kept, default port hidden, query values redacted. */
export function displayUrl(parsed: URL): string {
  const port = parsed.port ? ":" + parsed.port : "";
  return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}${redactSearch(parsed.search)}`;
}

export function truncate(value: string, max: number = LIMITS.maxHeaderValueChars): string {
  return value.length <= max ? value : value.slice(0, max) + "...[truncated]";
}

/**
 * Response headers filtered for the client: sensitive values dropped, URL
 * valued headers redacted, sizes bounded, ordering stable.
 */
export function sanitizeResponseHeaders(
  raw: Record<string, string | string[] | undefined>,
  requestUrl?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  let kept = 0;
  for (const name of Object.keys(raw).sort()) {
    if (kept >= LIMITS.maxHeadersPerHop) break;
    const lower = name.toLowerCase();
    if (isSensitiveHeader(lower)) continue;
    const value = raw[name];
    if (value === undefined) continue;
    const joined = Array.isArray(value) ? value.join(", ") : String(value);
    const redacted = !URL_VALUED_HEADERS.has(lower)
      ? joined
      : lower === "location" || lower === "content-location"
        ? redactUrl(joined, requestUrl)
        : redactUrlsInText(joined);
    out[lower] = truncate(redacted);
    kept += 1;
  }
  return out;
}
