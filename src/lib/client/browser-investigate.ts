import type { Investigation, InvestigationEvent, ProviderState } from "../types";
import { LOCAL_ONLY_MESSAGES } from "../edition";
import type { BackendDeps } from "../server/deps";
import { cloudflareDoh } from "../server/doh";
import { allowlistJsonFetcher } from "../server/metadata";
import { LIMITS } from "../server/limits";
import { EvidenceLedger, runProvider, type ProviderContext } from "../server/provider";
import { dnsProvider } from "../server/providers/dns";
import { networkProvider } from "../server/providers/network";
import { inferNetworkInfrastructure } from "../network-hints";
import { parseTargetUrl } from "../server/url-parser";

export type BrowserDeps = Pick<BackendDeps, "doh" | "json" | "now" | "newId">;

export interface BrowserInvestigateOptions {
  url: string;
  signal: AbortSignal;
  deps?: Partial<BrowserDeps>;
  totalMs?: number;
}

const localOnly = (id: keyof typeof LOCAL_ONLY_MESSAGES): ProviderState => ({
  status: "unavailable", reason: "local-only", message: LOCAL_ONLY_MESSAGES[id],
});

/** This is not a CORS proxy: there is no transport for a user-chosen destination. */
const noDirectRequests = async (): Promise<never> => {
  throw new Error("Direct website requests are available only in the local app.");
};

/**
 * Collect real public DNS and network metadata directly in the visitor's browser.
 * Providers below are browser-safe; the Node dependency factory is type-only.
 * Snapshots use the same contract as the local NDJSON stream, without an API call.
 */
export async function* investigateInBrowser(options: BrowserInvestigateOptions): AsyncGenerator<InvestigationEvent> {
  if (options.signal.aborted) return;
  const parsed = parseTargetUrl(options.url);
  if (!parsed.ok) {
    yield { type: "error", message: parsed.message };
    return;
  }
  const deps: BackendDeps = {
    doh: cloudflareDoh,
    json: allowlistJsonFetcher,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    ...options.deps,
    http: noDirectRequests,
    tls: noDirectRequests,
  };
  const budget = AbortSignal.any([options.signal, AbortSignal.timeout(options.totalMs ?? LIMITS.investigationMs)]);
  const evidence = new EvidenceLedger(deps.now);
  const investigation: Investigation = {
    id: deps.newId(),
    edition: "browser",
    url: parsed.url,
    startedAt: deps.now().toISOString(),
    providers: {
      dns: { status: "pending" },
      network: { status: "pending" },
      http: localOnly("http"),
      tls: localOnly("tls"),
      technology: localOnly("technology"),
    },
    evidence: [],
  };
  evidence.record({
    source: "url", kind: "input", label: "URL under investigation", value: parsed.url.display,
    explanation: "Parsed in this browser. The path stays in the browser and any report you export. The target website is not requested.",
  });
  if (parsed.url.hasQuery || parsed.url.hasFragment) {
    evidence.record({
      source: "url", kind: "privacy", label: "Query values and fragment discarded",
      value: parsed.url.queryKeys.length ? `query keys only: ${parsed.url.queryKeys.join(", ")}` : "private URL components removed",
      explanation: "No query values or fragment are sent to lookup providers or included in the observation. Only the hostname and observed public IP addresses are looked up.",
    });
  }
  const context: ProviderContext = { url: parsed.url, target: parsed.target, signal: budget, now: deps.now, deps, evidence };
  const snapshot = (): Investigation => structuredClone({ ...investigation, evidence: evidence.snapshot() });

  yield { type: "start", investigation: snapshot() };
  investigation.providers.dns = { status: "investigating" };
  yield { type: "update", investigation: snapshot() };
  const dnsRun = await runProvider(dnsProvider, context, undefined);
  if (options.signal.aborted) return;
  investigation.providers.dns = dnsRun.state;
  if (dnsRun.data) investigation.dns = dnsRun.data.dns;
  yield { type: "update", investigation: snapshot() };

  investigation.providers.network = { status: "investigating" };
  yield { type: "update", investigation: snapshot() };
  const networkRun = await runProvider(networkProvider, context, {
    addresses: (dnsRun.data?.routableAddresses ?? []).map((address) => ({
      ...address,
      observedBy: [parsed.target.isIpLiteral ? "the URL itself" : `DNS ${address.version === 4 ? "A" : "AAAA"} record`],
    })),
  });
  if (options.signal.aborted) return;
  investigation.providers.network = networkRun.state;
  if (networkRun.data) investigation.network = networkRun.data.network;
  investigation.technology = {
    technologies: [],
    infrastructure: inferNetworkInfrastructure(networkRun.data?.facts ?? []),
    analyzedBytes: 0,
    truncated: false,
  };
  investigation.finishedAt = deps.now().toISOString();
  yield { type: "complete", investigation: snapshot() };
}
