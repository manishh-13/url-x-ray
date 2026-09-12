import type { Confidence, Evidence, ParsedUrl, ProviderId, ProviderState } from "@/lib/types";
import type { UrlTarget } from "./url-parser";
import type { BackendDeps } from "./deps";

export interface EvidenceInput {
  source: ProviderId | "url";
  kind: string;
  label: string;
  value: string;
  confidence?: Confidence;
  sourceUrl?: string;
  explanation?: string;
}

/**
 * Collects evidence with stable ids so technology and infrastructure claims can
 * cite them. Every record carries its source and the moment it was observed;
 * nothing is added that was not actually seen in a response.
 */
export class EvidenceLedger {
  private readonly items: Evidence[] = [];
  private readonly counters = new Map<string, number>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly clock: () => Date) {}

  record(input: EvidenceInput): string {
    const key = `${input.source}|${input.kind}|${input.label}|${input.value}`;
    const existing = this.byKey.get(key);
    if (existing) return existing;

    const prefix = `${input.source}-${input.kind}`;
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    const id = `${prefix}-${next}`;

    this.items.push({
      id,
      source: input.source,
      kind: input.kind,
      label: input.label,
      value: input.value,
      confidence: input.confidence ?? "observed",
      observedAt: this.clock().toISOString(),
      sourceUrl: input.sourceUrl,
      explanation: input.explanation,
    });
    this.byKey.set(key, id);
    return id;
  }

  /** Existing id for an already recorded fact, without creating one. */
  find(source: ProviderId | "url", kind: string, label: string, value: string): string | undefined {
    return this.byKey.get(`${source}|${kind}|${label}|${value}`);
  }

  snapshot(): Evidence[] {
    return this.items.map((item) => ({ ...item }));
  }

  get size(): number {
    return this.items.length;
  }
}

export interface ProviderContext {
  url: ParsedUrl;
  target: UrlTarget;
  /** Aborted on client disconnect, on the total budget, or on the provider budget. */
  signal: AbortSignal;
  now: () => Date;
  deps: BackendDeps;
  evidence: EvidenceLedger;
}

export interface ProviderOutcome<TData> {
  status: "complete" | "unavailable";
  message?: string;
  data?: TData;
}

export interface Provider<TInput, TData> {
  id: ProviderId;
  label: string;
  timeoutMs: number;
  /** Must resolve, not throw, for expected failures. Throwing is handled too. */
  run(context: ProviderContext, input: TInput): Promise<ProviderOutcome<TData>>;
}

export interface ProviderRun<TData> {
  state: ProviderState;
  data?: TData;
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") return true;
    return /cancelled|aborted/i.test(error.message);
  }
  return false;
}

/** Never leak internal detail or user input into a message shown to a client. */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Run one provider under its own budget on top of the investigation signal.
 * Failure is always partial: an unavailable provider never stops the others.
 */
export async function runProvider<TInput, TData>(
  provider: Provider<TInput, TData>,
  context: ProviderContext,
  input: TInput,
): Promise<ProviderRun<TData>> {
  const startedAt = Date.now();
  const timeout = AbortSignal.timeout(provider.timeoutMs);
  const scoped: ProviderContext = {
    ...context,
    signal: AbortSignal.any([context.signal, timeout]),
  };
  try {
    const outcome = await provider.run(scoped, input);
    return {
      state: {
        status: outcome.status,
        message: outcome.message,
        durationMs: Date.now() - startedAt,
      },
      data: outcome.data,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (context.signal.aborted) {
      return {
        state: { status: "unavailable", message: "Investigation stopped before this layer finished.", durationMs },
      };
    }
    if (timeout.aborted) {
      return {
        state: {
          status: "unavailable",
          message: `${provider.label} did not answer within ${provider.timeoutMs}ms.`,
          durationMs,
        },
      };
    }
    return {
      state: {
        status: "unavailable",
        message: describeError(error, `${provider.label} could not be read.`),
        durationMs,
      },
    };
  }
}
