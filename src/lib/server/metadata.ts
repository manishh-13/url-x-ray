import { LIMITS } from "./limits";
import { classifyIp } from "./ip-guard";
import { readBoundedJson } from "./bounded-json";

/** Browser-safe registry transport. Only these two public RIPEstat APIs are used. */
export const METADATA_HOSTS = new Set(["stat.ripe.net"]);
export type JsonFetcher = (url: string, signal: AbortSignal) => Promise<unknown>;

export const allowlistJsonFetcher: JsonFetcher = async (url, signal) => {
  const parsed = new URL(url);
  const resource = parsed.searchParams.get("resource") ?? "";
  const addressLookup = parsed.pathname === "/data/network-info/data.json" && classifyIp(resource).ok;
  const asnLookup = parsed.pathname === "/data/as-overview/data.json" && /^AS\d{1,10}$/.test(resource);
  if (parsed.protocol !== "https:" || !METADATA_HOSTS.has(parsed.hostname)
    || parsed.username || parsed.password || parsed.port || parsed.hash
    || [...parsed.searchParams.keys()].some((key) => key !== "resource")
    || parsed.searchParams.getAll("resource").length !== 1 || (!addressLookup && !asnLookup)) {
    throw new Error("Metadata endpoint is not allowlisted");
  }
  const response = await fetch(parsed, {
    method: "GET",
    headers: { accept: "application/json" },
    mode: "cors",
    redirect: "error",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.any([signal, AbortSignal.timeout(LIMITS.metadataMs)]),
  });
  if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
  return readBoundedJson(response, 128 * 1024, "Registry");
};
