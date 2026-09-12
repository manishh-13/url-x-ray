import { CAPACITY } from "./limits";

export interface GateDecision {
  ok: boolean;
  /** Reason to show the client. Never mentions other clients or internals. */
  message?: string;
  retryAfterSeconds?: number;
  release: () => void;
}

/**
 * Process wide capacity limit.
 *
 * The cap is global on purpose: a client supplied address such as
 * X-Forwarded-For can be set by anyone, so keying limits on it would create a
 * bypass rather than a control. Nothing is persisted and nothing about a caller
 * is stored; the state is two counters that reset with the process.
 */
export class ConcurrencyGate {
  private active = 0;
  private timestamps: number[] = [];

  constructor(
    private readonly maxConcurrent: number = CAPACITY.maxConcurrent,
    private readonly maxPerWindow: number = CAPACITY.maxPerWindow,
    private readonly windowMs: number = CAPACITY.windowMs,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  acquire(): GateDecision {
    const now = this.clock();
    this.timestamps = this.timestamps.filter((entry) => now - entry < this.windowMs);

    if (this.active >= this.maxConcurrent) {
      return {
        ok: false,
        message: "The instrument is busy with other investigations. Please try again in a moment.",
        retryAfterSeconds: 5,
        release: () => undefined,
      };
    }
    if (this.timestamps.length >= this.maxPerWindow) {
      const oldest = this.timestamps[0] ?? now;
      const waitMs = Math.max(this.windowMs - (now - oldest), 1_000);
      return {
        ok: false,
        message: "This instrument has reached its investigation limit for the moment. Please try again shortly.",
        retryAfterSeconds: Math.ceil(waitMs / 1_000),
        release: () => undefined,
      };
    }

    this.active += 1;
    this.timestamps.push(now);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.active = Math.max(this.active - 1, 0);
      },
    };
  }

  get inFlight(): number {
    return this.active;
  }
}

/** The single instance used by the route. Tests construct their own. */
export const investigationGate = new ConcurrencyGate();
