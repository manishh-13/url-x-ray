import type { InvestigationEvent } from "@/lib/types";
import { investigate } from "@/lib/server/investigate";
import { guardInvestigateRequest } from "@/lib/server/request-guard";
import { investigationGate } from "@/lib/server/gate";
import { LIMITS } from "@/lib/server/limits";

/** Node APIs are required for socket pinning and TLS inspection. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NDJSON_HEADERS: Record<string, string> = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store, no-transform",
  "x-content-type-options": "nosniff",
  "x-accel-buffering": "no",
};

const jsonError = (status: number, message: string, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify({ message }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

/**
 * Stream one investigation as newline delimited JSON.
 *
 * Nothing about the request is logged or persisted: the URL exists only inside
 * this request's scope. Capacity is enforced globally before any work starts,
 * and the run is aborted as soon as the client disconnects.
 */
export async function POST(request: Request): Promise<Response> {
  const guarded = await guardInvestigateRequest(request);
  if (!guarded.ok) return jsonError(guarded.status, guarded.message);

  const lease = investigationGate.acquire();
  if (!lease.ok) {
    return jsonError(429, lease.message ?? "Too many investigations in flight.", {
      "retry-after": String(lease.retryAfterSeconds ?? 5),
    });
  }

  const target = guarded.value.url;
  const controller = new AbortController();
  const onDisconnect = () => controller.abort();
  request.signal.addEventListener("abort", onDisconnect, { once: true });

  const encoder = new TextEncoder();
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    request.signal.removeEventListener("abort", onDisconnect);
    lease.release();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(sink) {
      const write = (event: InvestigationEvent) => {
        sink.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        for await (const event of investigate({
          url: target,
          signal: controller.signal,
          totalMs: LIMITS.investigationMs,
        })) {
          if (controller.signal.aborted) break;
          write(event);
        }
      } catch {
        if (!controller.signal.aborted) {
          try {
            write({ type: "error", message: "The investigation could not be completed. Please try again." });
          } catch {
            // The client is already gone.
          }
        }
      } finally {
        release();
        try {
          sink.close();
        } catch {
          // Already closed by a disconnect.
        }
      }
    },
    cancel() {
      controller.abort();
      release();
    },
  });

  return new Response(stream, { status: 200, headers: NDJSON_HEADERS });
}

export function GET(): Response {
  return jsonError(405, "Use POST to start an investigation.", { allow: "POST" });
}
