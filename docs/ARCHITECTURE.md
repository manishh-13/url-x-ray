# Architecture

URL X-Ray is a single Next.js application. A run is one HTTP request from the browser to the app's own
API route, and one stream of events back. There is no database, no queue, no background worker, and no
persistence between runs.

```
browser                         server                        public Internet
-------                         ------                        ---------------
useInvestigation()
  POST /api/investigate  ---->  parse and validate the URL
                                                              DNS over HTTPS
  <---- {"type":"start"}        run providers                  HTTP(S) request
  <---- {"type":"update"} x N   emit after each layer          TLS handshake
  <---- {"type":"complete"}     finish                         network metadata lookup
readInvestigationStream()
  render graph + evidence
```

## Module layout

| Path | Role | Present today |
| --- | --- | --- |
| `src/lib/types.ts` | The shared contract: `Investigation`, per-provider data shapes, `Evidence`, `InvestigationEvent`, `InfrastructureGraph` | yes |
| `src/lib/client/stream.ts` | NDJSON decoder for the investigation stream | yes |
| `src/lib/client/use-investigation.ts` | React hook owning run state, cancellation, and generation tracking | yes |
| `src/components/primitives.tsx` | Presentation primitives: layer names, confidence badge, dialog, X-Ray mark | yes |
| `src/app/` | Page routes and the streaming investigation route | yes |
| `src/lib/server/` | Guarded collection, provider orchestration, public network metadata, and evidence ledger | yes |
| `src/lib/interpretation.ts` | Turns provider data into findings and graph relationships | yes |
| `src/lib/export.ts` | Creates sanitized JSON and self-contained SVG reports | yes |

## The event stream

The API route responds with `application/x-ndjson`: one JSON object per line, newline terminated. The
event union is defined in `src/lib/types.ts`:

```ts
type InvestigationEvent =
  | { type: "start";    investigation: Investigation }
  | { type: "update";   investigation: Investigation }
  | { type: "complete"; investigation: Investigation }
  | { type: "error";    message: string }
```

Design points that the decoder depends on, and that any server implementation must honour:

- **Every event carries the whole `Investigation`.** Events are snapshots, not patches, so a client
  that joins late or drops an intermediate event still renders a coherent state. The cost is
  redundancy on the wire, which is acceptable for a single local run.
- **`complete` and `error` are terminal.** If the stream ends without either, the decoder treats the
  run as truncated and surfaces a message saying so while keeping the evidence already collected.
- **`error.message` is presentation text.** It is written to be shown to a person: no stack traces, no
  internal identifiers, no upstream response bodies.
- **Unknown `type` values are ignored, not fatal.** This lets a newer server add an event type without
  breaking an older client.

### Decoder guarantees

`readInvestigationStream(response, onEvent, signal)` in `src/lib/client/stream.ts`:

1. Rejects a non-`ok` response, preferring `message` then `error` from a JSON body, and falling back to
   a generic message when the body is not JSON. An upstream error page is never treated as evidence.
2. Buffers across reads, so an event split across any number of chunks, including a multi-byte UTF-8
   sequence split mid-codepoint, decodes correctly (`TextDecoder` with `{ stream: true }`).
3. Flushes a trailing line that has no terminating newline.
4. Skips blank lines.
5. Throws a single presentation-safe message on malformed JSON.
6. Caps the buffer at 2 MB to bound client memory.
7. On abort, cancels the reader and throws an `AbortError`; the reader is always cancelled and its lock
   released in a `finally` block.

`tests/unit/stream.test.ts` covers each of these.

## Run state on the client

`useInvestigation()` holds `investigation`, `running`, and `error`, and exposes `run`, `cancel`, and
`reset`.

- Each `run` increments a generation counter and aborts the previous `AbortController`. Events from a
  superseded run are dropped, so a slow earlier investigation cannot overwrite a newer one.
- `cancel` and a failed run both rewrite any provider still `pending` or `investigating` to
  `unavailable` with an explanation, so the UI never leaves a layer spinning forever.
- The request is sent with `cache: "no-store"` and `credentials: "omit"`.

## The evidence model

Providers do not return conclusions. They return data plus `Evidence` records, each with a stable
`id`, the `source` that produced it, a `confidence` of `observed` / `inferred` / `unknown`, an
`observedAt` timestamp, and optionally the `sourceUrl` it came from.

Anything interpretive, a `Finding`, a `Technology`, an `InfrastructureGuess`, or a `GraphNode`, carries
`evidenceIds` pointing back at those records. This is what makes the UI auditable: every rendered
claim can be expanded to the raw observation behind it, and an inference with no supporting evidence is
a bug, not a display choice.

`ProviderState` is `pending`, `investigating`, `complete`, or `unavailable`. `unavailable` is a normal
outcome, not an error: a host with no AAAA record or an unreachable port is information, and the graph
renders it as such rather than failing the run.

## The graph

`InfrastructureGraph` is a flat list of `GraphNode` and `GraphEdge`. Nodes are keyed by layer, and
edges are typed `resolution`, `request`, `inference`, or `relationship`, so the UI can style a "we
observed this hop" edge differently from a "we think this is behind that" edge. Keeping the graph as
derived data, rather than something providers mutate, means the interpretation layer can be rewritten
without touching collection.

## Constraints that shaped the design

- **Local, single-user, private.** No authentication or tenancy. A small global capacity gate protects accidental local overload, but binding to `127.0.0.1` remains the primary boundary. See [SECURITY.md](../SECURITY.md).
- **Live, not archival.** No stored snapshots and no historical corpus, so re-running the same hostname
  is a fresh observation and may legitimately differ from a previous run.
- **No third-party scanning service.** The instrument only reports what it observed itself, plus public
  network metadata lookups. Optional external enrichment is V3 on the roadmap and is not implemented.
