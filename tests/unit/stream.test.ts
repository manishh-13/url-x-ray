import { describe, expect, it } from "vitest";
import { readInvestigationStream } from "@/lib/client/stream";
import type { Investigation, InvestigationEvent, ParsedUrl } from "@/lib/types";

const encoder = new TextEncoder();

function parsedUrl(overrides: Partial<ParsedUrl> = {}): ParsedUrl {
  return {
    href: "https://example.com/path",
    hostname: "example.com",
    scheme: "https",
    port: "",
    pathname: "/path",
    queryKeys: [],
    hasQuery: false,
    hasFragment: false,
    display: "example.com/path",
    ...overrides,
  };
}

function investigation(overrides: Partial<Investigation> = {}): Investigation {
  return {
    id: "inv_1",
    url: parsedUrl(),
    startedAt: "2026-09-12T00:00:00.000Z",
    providers: {
      dns: { status: "pending" },
      http: { status: "pending" },
      tls: { status: "pending" },
      network: { status: "pending" },
      technology: { status: "pending" },
    },
    evidence: [],
    ...overrides,
  };
}

const startEvent: InvestigationEvent = { type: "start", investigation: investigation() };
const updateEvent: InvestigationEvent = { type: "update", investigation: investigation() };
const completeEvent: InvestigationEvent = { type: "complete", investigation: investigation({ finishedAt: "2026-09-12T00:00:02.000Z" }) };

const ndjson = (...events: unknown[]) => events.map((event) => `${JSON.stringify(event)}\n`).join("");

function responseFrom(chunks: Array<string | Uint8Array>, init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(body, init);
}

/** One byte per chunk, the worst case a network can hand the decoder. */
function byteChunks(text: string): Uint8Array[] {
  const bytes = encoder.encode(text);
  return Array.from(bytes, (byte) => new Uint8Array([byte]));
}

async function collect(response: Response, signal?: AbortSignal): Promise<InvestigationEvent[]> {
  const events: InvestigationEvent[] = [];
  await readInvestigationStream(response, (event) => events.push(event), signal);
  return events;
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (cause) {
    return cause as Error;
  }
  throw new Error("expected the stream to reject, but it resolved");
}

describe("readInvestigationStream", () => {
  it("delivers every event in order from a single chunk", async () => {
    const events = await collect(responseFrom([ndjson(startEvent, updateEvent, completeEvent)]));
    expect(events.map((event) => event.type)).toEqual(["start", "update", "complete"]);
  });

  it("does not depend on chunk boundaries", async () => {
    const text = ndjson(startEvent, updateEvent, completeEvent);
    const events = await collect(responseFrom(byteChunks(text)));
    expect(events.map((event) => event.type)).toEqual(["start", "update", "complete"]);
    expect(events[2]).toEqual(completeEvent);
  });

  it("splits a single event across chunks that break inside the JSON", async () => {
    const text = ndjson(startEvent, completeEvent);
    const middle = Math.floor(text.length / 2);
    const events = await collect(responseFrom([text.slice(0, middle), text.slice(middle)]));
    expect(events.map((event) => event.type)).toEqual(["start", "complete"]);
  });

  it("decodes non-ASCII values split mid codepoint", async () => {
    const hostname = "münchen-café-日本語-🛰.example";
    const event: InvestigationEvent = {
      type: "complete",
      investigation: investigation({ url: parsedUrl({ hostname, display: `${hostname}/pfad`, href: `https://${hostname}/pfad` }) }),
    };
    const bytes = encoder.encode(ndjson(event));
    expect(bytes.byteLength).toBeGreaterThan(ndjson(event).length); // multi-byte sequences are present

    const events = await collect(responseFrom(byteChunks(ndjson(event))));
    expect(events).toHaveLength(1);
    expect((events[0] as { investigation: Investigation }).investigation.url.hostname).toBe(hostname);
  });

  it("flushes a final event that has no terminating newline", async () => {
    const text = `${ndjson(startEvent)}${JSON.stringify(completeEvent)}`;
    const events = await collect(responseFrom([text]));
    expect(events.map((event) => event.type)).toEqual(["start", "complete"]);
  });

  it("skips blank and whitespace-only lines", async () => {
    const text = `\n${ndjson(startEvent)}\n   \n\n${ndjson(completeEvent)}\n\n`;
    const events = await collect(responseFrom([text]));
    expect(events.map((event) => event.type)).toEqual(["start", "complete"]);
  });

  it("ignores event types it does not know", async () => {
    const text = `${ndjson(startEvent, { type: "telemetry", note: "from a newer server" }, completeEvent)}`;
    const events = await collect(responseFrom([text]));
    expect(events.map((event) => event.type)).toEqual(["start", "complete"]);
  });

  it("treats an error event as terminal and does not throw", async () => {
    const message = "That URL resolves to a private address, so it wasn't investigated.";
    const events = await collect(responseFrom([ndjson(startEvent, { type: "error", message })]));
    expect(events).toEqual([startEvent, { type: "error", message }]);
  });

  it("rejects with one presentation-safe message on malformed JSON", async () => {
    const text = `${ndjson(startEvent)}{"type":"update","investigation":\n`;
    const error = await rejection(collect(responseFrom([text])));
    expect(error.message).toBe("The evidence stream was interrupted. Please run the X-ray again.");
    expect(error.message).not.toMatch(/JSON|token|position/i);
  });

  it("rejects when a trailing partial line is all that arrives", async () => {
    const error = await rejection(collect(responseFrom([`${ndjson(startEvent)}{"type":"comp`])));
    expect(error.message).toBe("The evidence stream was interrupted. Please run the X-ray again.");
  });

  it("rejects when the stream ends before a terminal event", async () => {
    const events: InvestigationEvent[] = [];
    const error = await rejection(
      readInvestigationStream(responseFrom([ndjson(startEvent, updateEvent)]), (event) => events.push(event)),
    );
    expect(error.message).toMatch(/ended before every layer arrived/);
    expect(events.map((event) => event.type)).toEqual(["start", "update"]);
  });

  it("rejects when the stream is empty", async () => {
    const error = await rejection(collect(responseFrom([])));
    expect(error.message).toMatch(/ended before every layer arrived/);
  });

  it("rejects a body that exceeds the safe buffer limit", async () => {
    const error = await rejection(collect(responseFrom(["x".repeat(2_000_001)])));
    expect(error.message).toBe("The evidence stream exceeded the safe display limit.");
  });

  it("rejects a response with no body", async () => {
    const error = await rejection(collect(new Response(null, { status: 200 })));
    expect(error.message).toBe("This browser couldn't open the investigation stream.");
  });

  describe("a response that is not ok", () => {
    it("prefers the message field from a JSON body", async () => {
      const response = new Response(JSON.stringify({ message: "That hostname could not be resolved." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
      const error = await rejection(collect(response));
      expect(error.message).toBe("That hostname could not be resolved.");
    });

    it("falls back to the error field", async () => {
      const response = new Response(JSON.stringify({ error: "Only http and https URLs can be investigated." }), { status: 400 });
      const error = await rejection(collect(response));
      expect(error.message).toBe("Only http and https URLs can be investigated.");
    });

    it("does not surface an upstream error page", async () => {
      const response = new Response("<html><body>502 Bad Gateway: upstream 10.0.0.4:8080</body></html>", { status: 502 });
      const error = await rejection(collect(response));
      expect(error.message).toBe("The instrument couldn't start this investigation. Please try again.");
      expect(error.message).not.toMatch(/10\.0\.0\.4|html/i);
    });

    it("ignores a non-string message field", async () => {
      const response = new Response(JSON.stringify({ message: { nested: true } }), { status: 500 });
      const error = await rejection(collect(response));
      expect(error.message).toBe("The instrument couldn't start this investigation. Please try again.");
    });
  });

  describe("abort", () => {
    it("rejects with an AbortError when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const error = await rejection(collect(responseFrom([ndjson(startEvent, completeEvent)]), controller.signal));
      expect(error.name).toBe("AbortError");
      expect(error.message).toBe("Investigation cancelled");
    });

    it("stops mid stream and delivers nothing after the abort", async () => {
      const controller = new AbortController();
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }));
      const events: InvestigationEvent[] = [];

      const promise = readInvestigationStream(response, (event) => {
        events.push(event);
        if (event.type === "start") controller.abort();
      }, controller.signal);

      stream.enqueue(encoder.encode(ndjson(startEvent)));
      const error = await rejection(promise);

      expect(error.name).toBe("AbortError");
      expect(events.map((event) => event.type)).toEqual(["start"]);
    });

    it("rejects when the signal aborts after a complete event but before the stream closes", async () => {
      const controller = new AbortController();
      let stream!: ReadableStreamDefaultController<Uint8Array>;
      const response = new Response(new ReadableStream<Uint8Array>({ start: (c) => { stream = c; } }));

      const promise = readInvestigationStream(response, (event) => {
        if (event.type === "complete") controller.abort();
      }, controller.signal);

      stream.enqueue(encoder.encode(ndjson(startEvent, completeEvent)));
      expect((await rejection(promise)).name).toBe("AbortError");
    });
  });

  it("releases the reader lock on success", async () => {
    const response = responseFrom([ndjson(startEvent, completeEvent)]);
    await collect(response);
    expect(() => response.body?.getReader()).not.toThrow();
  });

  it("releases the reader lock after a failure", async () => {
    const response = responseFrom([`${ndjson(startEvent)}not json\n`]);
    await rejection(collect(response));
    expect(() => response.body?.getReader()).not.toThrow();
  });
});
