import { cloudflareDoh, type DohQuery } from "./doh";
import { nodeHttpTransport, type HttpTransport } from "./transport";
import { nodeTlsTransport, type TlsTransport } from "./tls-transport";
import { LIMITS } from "./limits";
import { randomUUID } from "node:crypto";

/** Public metadata APIs this backend is allowed to read. Nothing else. */
export const METADATA_HOSTS = new Set(["stat.ripe.net"]);

const MAX_METADATA_BYTES = 128 * 1024;

export type JsonFetcher = (url: string, signal: AbortSignal) => Promise<unknown>;

/**
 * Fetch JSON from a fixed allowlist of public registry endpoints. The URL is
 * built by this backend, never taken from a response, and the host is checked
 * again here so a future caller cannot turn this into a general fetcher.
 */
export const allowlistJsonFetcher: JsonFetcher = async (url, signal) => {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !METADATA_HOSTS.has(parsed.hostname)) {
    throw new Error("Metadata endpoint is not allowlisted");
  }
  const response = await fetch(parsed, {
    method: "GET",
    headers: { accept: "application/json" },
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.metadataMs)]),
  });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_METADATA_BYTES) throw new Error("Registry response too large");
  return JSON.parse(new TextDecoder().decode(buffer));
};

export interface BackendDeps {
  doh: DohQuery;
  http: HttpTransport;
  tls: TlsTransport;
  json: JsonFetcher;
  now: () => Date;
  newId: () => string;
}

export function createDeps(overrides: Partial<BackendDeps> = {}): BackendDeps {
  return {
    doh: cloudflareDoh,
    http: nodeHttpTransport,
    tls: nodeTlsTransport,
    json: allowlistJsonFetcher,
    now: () => new Date(),
    newId: () => randomUUID(),
    ...overrides,
  };
}
