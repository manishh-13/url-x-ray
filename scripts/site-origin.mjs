const DEFAULT_SITE_ORIGIN = "https://manishh-13.github.io";

/** Public metadata needs an origin, never an inspected URL or local preview. */
export function siteOriginFromEnv(env = process.env) {
  const raw = env.PAGES_SITE_ORIGIN ?? DEFAULT_SITE_ORIGIN;
  let url;
  try { url = new URL(raw); } catch { throw new Error("PAGES_SITE_ORIGIN must be an HTTPS origin, such as https://example.org."); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PAGES_SITE_ORIGIN must be an HTTPS origin without credentials, path, query or fragment. Set PAGES_BASE_PATH separately.");
  }
  return url.origin;
}
