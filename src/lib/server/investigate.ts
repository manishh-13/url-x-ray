import type {
  Investigation,
  InvestigationEvent,
  ProviderId,
  ProviderState,
} from "@/lib/types";
import { LIMITS } from "./limits";
import { createDeps, type BackendDeps } from "./deps";
import { parseTargetUrl } from "./url-parser";
import { EvidenceLedger, runProvider, type ProviderContext } from "./provider";
import { dnsProvider } from "./providers/dns";
import { httpProvider, type HttpArtifacts } from "./providers/http";
import { tlsProvider } from "./providers/tls";
import { networkProvider, type ObservedAddress } from "./providers/network";
import { technologyProvider } from "./providers/technology";

export interface InvestigateOptions {
  url: string;
  /** Aborted when the client disconnects. */
  signal: AbortSignal;
  deps?: Partial<BackendDeps>;
  totalMs?: number;
}

const PENDING: ProviderState = { status: "pending" };

const initialProviders = (): Record<ProviderId, ProviderState> => ({
  dns: { ...PENDING },
  http: { ...PENDING },
  tls: { ...PENDING },
  network: { ...PENDING },
  technology: { ...PENDING },
});

/**
 * Run one investigation and yield a serializable snapshot at every step.
 *
 * Every provider is independent: an unavailable layer never stops another, and
 * the snapshot always states each provider's status so the client never has to
 * infer progress. The whole run is bounded by totalMs, each provider is bounded
 * by its own budget, and a client disconnect aborts all of them.
 */
export async function* investigate(options: InvestigateOptions): AsyncGenerator<InvestigationEvent> {
  const deps = createDeps(options.deps);
  const parsed = parseTargetUrl(options.url);
  if (!parsed.ok) {
    yield { type: "error", message: parsed.message };
    return;
  }

  const totalMs = options.totalMs ?? LIMITS.investigationMs;
  const budget = AbortSignal.any([options.signal, AbortSignal.timeout(totalMs)]);
  const evidence = new EvidenceLedger(deps.now);
  const startedAt = deps.now();

  const investigation: Investigation = {
    id: deps.newId(),
    edition: "local",
    url: parsed.url,
    startedAt: startedAt.toISOString(),
    providers: initialProviders(),
    evidence: [],
  };

  evidence.record({
    source: "url",
    kind: "input",
    label: "URL under investigation",
    value: parsed.url.display,
    confidence: "observed",
    explanation: "The submitted URL after validation. Query values and any fragment were discarded before this point.",
  });
  if (parsed.url.hasQuery) {
    evidence.record({
      source: "url",
      kind: "privacy",
      label: "Query string discarded",
      value: parsed.url.queryKeys.length > 0
        ? `keys only: ${parsed.url.queryKeys.join(", ")}`
        : "present, no readable keys",
      confidence: "observed",
      explanation: "Only the parameter names are kept. No query value is sent, stored or shown.",
    });
  }
  if (parsed.url.hasFragment) {
    evidence.record({
      source: "url",
      kind: "privacy",
      label: "Fragment discarded",
      value: "present",
      confidence: "observed",
      explanation: "A fragment never leaves the browser in a normal request, and it is dropped here as well.",
    });
  }

  const context: ProviderContext = {
    url: parsed.url,
    target: parsed.target,
    signal: budget,
    now: deps.now,
    deps,
    evidence,
  };

  const snapshot = (): Investigation => structuredClone({ ...investigation, evidence: evidence.snapshot() });

  const setState = (id: ProviderId, state: ProviderState) => {
    investigation.providers[id] = state;
  };

  yield { type: "start", investigation: snapshot() };

  // DNS first: every other layer needs a validated address to pin.
  setState("dns", { status: "investigating" });
  yield { type: "update", investigation: snapshot() };

  const dnsRun = await runProvider(dnsProvider, context, undefined);
  setState("dns", dnsRun.state);
  if (dnsRun.data) investigation.dns = dnsRun.data.dns;
  yield { type: "update", investigation: snapshot() };
  // Only a disconnected client ends the stream early. A total budget timeout
  // still finishes the run so the client receives a complete, honest snapshot.
  if (options.signal.aborted) return;

  const routable = dnsRun.data?.routableAddresses ?? [];
  const refused = dnsRun.data?.refusedAddresses ?? [];
  const dnsAnswered = dnsRun.state.status === "complete";

  // HTTP, TLS and network run concurrently. Network is seeded from DNS answers
  // rather than waiting for HTTP, because the HTTP connection is pinned to one
  // of those same answers, so waiting would add latency without adding facts.
  setState("http", { status: "investigating" });
  setState("tls", { status: "investigating" });
  setState("network", { status: "investigating" });
  yield { type: "update", investigation: snapshot() };

  const observed: ObservedAddress[] = routable.map((address) => ({
    ...address,
    observedBy: [parsed.target.isIpLiteral ? "the URL itself" : `DNS ${address.version === 4 ? "A" : "AAAA"} record`],
  }));

  const httpPromise = runProvider(httpProvider, context, { addresses: routable, refused, dnsAnswered });
  const tlsPromise = runProvider(tlsProvider, context, { addresses: routable, refused });
  const networkPromise = runProvider(networkProvider, context, { addresses: observed });

  const httpRun = await httpPromise;
  setState("http", httpRun.state);
  if (httpRun.data) investigation.http = httpRun.data.http;
  yield { type: "update", investigation: snapshot() };

  const tlsRun = await tlsPromise;
  setState("tls", tlsRun.state);
  if (tlsRun.data) investigation.tls = tlsRun.data.tls;
  yield { type: "update", investigation: snapshot() };

  const networkRun = await networkPromise;
  setState("network", networkRun.state);
  if (networkRun.data) investigation.network = networkRun.data.network;
  yield { type: "update", investigation: snapshot() };

  // Technology last: it reads only what HTTP already retrieved plus the network
  // facts it can cite, so it never performs I/O of its own.
  const artifacts: HttpArtifacts = httpRun.data?.artifacts ?? {
    html: "",
    htmlBytes: 0,
    htmlTruncated: false,
    finalHeaders: {},
    peers: [],
    hostsVisited: [parsed.target.hostname],
  };

  setState("technology", { status: "investigating" });
  yield { type: "update", investigation: snapshot() };

  const technologyRun = await runProvider(technologyProvider, context, {
    headers: artifacts.finalHeaders,
    html: artifacts.html,
    htmlBytes: artifacts.htmlBytes,
    htmlTruncated: artifacts.htmlTruncated,
    networkFacts: networkRun.data?.facts ?? [],
  });
  setState("technology", technologyRun.state);
  if (technologyRun.data) investigation.technology = technologyRun.data.technology;

  investigation.finishedAt = deps.now().toISOString();
  yield { type: "complete", investigation: snapshot() };
}
