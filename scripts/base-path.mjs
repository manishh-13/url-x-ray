/**
 * One definition of a valid hosting base path, shared by the static export
 * config, the preview server and the Pages test config, so a value that builds
 * cannot fail to serve.
 *
 * A base path ends up inside every emitted URL, so it is validated rather than
 * cleaned up: dot and dot dot segments, backslashes, whitespace, a trailing
 * slash and anything outside unreserved URL characters are rejected at the point
 * of use instead of producing a site whose assets 404.
 */
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

export function resolveBasePath(raw, source = "PAGES_BASE_PATH") {
  const value = String(raw ?? "").trim();
  if (value === "" || value === "/") return "";
  const fail = (why) => {
    throw new Error(`${source} ${why}. Use "" for the domain root or a path such as "/url-x-ray", received ${JSON.stringify(raw)}.`);
  };
  if (!value.startsWith("/")) fail("must start with a slash");
  if (value.endsWith("/")) fail("must not end with a slash");
  for (const segment of value.slice(1).split("/")) {
    if (segment === "." || segment === "..") fail("must not contain a dot or dot dot segment");
    if (!SEGMENT.test(segment)) fail("may contain letters, digits, dot, underscore, tilde and hyphen only");
  }
  return value;
}

export const DEFAULT_BASE_PATH = "/url-x-ray";

export const basePathFromEnv = (env = process.env) =>
  resolveBasePath(env.PAGES_BASE_PATH ?? DEFAULT_BASE_PATH);
