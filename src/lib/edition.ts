import type { Investigation, Layer } from "./types";
import { parseTargetUrl } from "./server/url-parser";

/** Set at build time. The static shell cannot enable the local API at runtime. */
export const IS_BROWSER_EDITION = process.env.NEXT_PUBLIC_XRAY_EDITION === "browser";
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const REPOSITORY_URL = "https://github.com/manishh-13/url-x-ray";
export const DOWNLOAD_URL = `${REPOSITORY_URL}/archive/refs/heads/main.zip`;

export const LOCAL_ONLY_MESSAGES = {
  http: "Run the local app to inspect redirects, status codes and response headers. Browser cross-origin rules prevent reliable inspection of arbitrary websites here.",
  tls: "Run the local app to inspect the certificate and its validation. Browsers do not expose another website's TLS certificate to this page.",
  technology: "Run the local app to inspect technologies in response headers and HTML. This edition does not fetch the website's response.",
} as const;

export function isLocalOnly(investigation: Investigation, layer: Layer): boolean {
  return (layer === "http" || layer === "tls" || layer === "technology")
    && investigation.providers[layer].reason === "local-only";
}

/** A share link starts a new run, never a saved result or a target request. */
export function createShareUrl(origin: string, investigation: Investigation, basePath = BASE_PATH): string {
  const hostname = investigation.url.hostname;
  if (investigation.edition === "browser" || hostname.includes(":")) {
    const url = new URL(`${basePath}/`, origin);
    url.searchParams.set("host", hostname);
    return url.href;
  }
  return new URL(`${basePath}/xray/${encodeURIComponent(hostname)}`, origin).href;
}

/** Accept hostname-only shared entries, never credentials, paths or URL values. */
export function readSharedHostname(search: string): string | undefined {
  const value = new URLSearchParams(search).get("host");
  if (!value || value.length > 253 || /[\s/?#@\\]/.test(value)) return undefined;
  const authority = value.includes(":") && !value.startsWith("[") ? `[${value}]` : value;
  const parsed = parseTargetUrl(`https://${authority}/`);
  return parsed.ok ? parsed.url.hostname : undefined;
}
