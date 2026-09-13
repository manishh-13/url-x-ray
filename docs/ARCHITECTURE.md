# Architecture

URL X-Ray is a Next.js application with two editions built from one codebase. In the local edition a run
is one HTTP request from the browser to the app's own API route, and one stream of events back. In the
hosted browser edition there is no server: the same events are produced in the page. There is no
database, no queue, no background worker, and no persistence between runs.

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

In the hosted edition the left column is the whole picture:

```
browser (static page, no server)                        public Internet
useInvestigation()
  investigateInBrowser()  ---->  parse and validate the URL
                                                        DNS over HTTPS (Cloudflare)
  same start/update/complete     DNS provider            Team Cymru over DoH, RIPEstat fallback
  events, same snapshots         network provider
  http, tls, technology: unavailable, reason "local-only"
  render graph + evidence        the target is never requested
```

## The two editions

| Concern | Local edition | Hosted browser edition |
| --- | --- | --- |
| Entry point | `src/app` in the root Next app, `npm run dev` on `127.0.0.1:3099` | `pages-app`, a second Next app whose pages re-export `src/app/page` and `src/app/layout` |
| Build | `next build`, output in `.next` | `next build pages-app` with `output: "export"`, output in `pages-app/.next` and `pages-app/out` |
| Investigation transport | `POST /api/investigate`, NDJSON response | `investigateInBrowser()` async generator in the page |
| Collectors | DNS, HTTP, TLS, network, technology | DNS and network only, the same provider modules, plus the announcing-network hosting hints derived from them |
| Routes | `/`, `/xray/[hostname]`, `/api/investigate` | `/` and a static 404 only |
| Share links | `/xray/<hostname>` | `/?host=<hostname>`, which waits for confirmation |
| Base path | none | `PAGES_BASE_PATH`, default `/url-x-ray`, validated in `scripts/base-path.mjs` |

Which edition a bundle is depends on two compile-time values set by `pages-app/next.config.mjs`:
`NEXT_PUBLIC_XRAY_EDITION` and `NEXT_PUBLIC_BASE_PATH`, read through `src/lib/edition.ts`. There is no
runtime switch, so a static page cannot be made to claim a capability it does not have, and the local
app is unaffected by the shell's existence.

Cross-origin responses require the target to opt in with CORS. Arbitrary websites do not reliably expose redirect chains, response headers or HTML this way;
certificates are not exposed to page JavaScript at all. That is why those three layers are
`unavailable` with `reason: "local-only"` there.

The DNS and network providers are shared unchanged, which is possible because they reach the network
through `fetch` and use no Node built-in. The HTTP and TLS transports are Node only and are never
imported into the browser bundle: `browser-investigate.ts` takes the dependency type only, and the two
transports it does not need are replaced with throwing functions that cannot connect. The build-time branch in use-investigation.ts removes the local API call from the static bundle.

The static export is the deployable artifact and it is verified before it can be uploaded: no API
route, no dynamic route, no server output, an `index.html` and a `404.html`. `scripts/serve-pages.mjs`
serves it from `127.0.0.1:3100` under the same base path, so a wrong asset prefix is caught locally
rather than after a deploy.

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
| `src/lib/dns-status.ts` | Classifies real DNS provider status text, separating successful empty answers, NXDOMAIN and unavailable queries | yes |
| `src/lib/insights.ts` | Derives a request takeaway, evidence-based next checks, network groups and five short overview findings | yes |
| `src/components/result-summary.tsx` | Displays the request takeaway and opens the relevant evidence layer | yes |
| `src/components/layer-glossary.tsx` | Optional plain-language definitions within each detail panel | yes |
| `src/lib/export.ts` | Creates sanitized JSON and self-contained SVG reports | yes |
| `src/lib/edition.ts` | Compile-time edition and base path, local-only layer messages, share link and shared hostname parsing | yes |
| `src/lib/client/browser-investigate.ts` | The hosted edition's collector: the same events, produced in the page | yes |
| `src/components/edition.tsx` | Edition badge, capability matrix, local-only panels, and the local setup steps | yes |
| `pages-app/` | The static shell: export config and pages that re-export the shared routes | yes |
| `scripts/base-path.mjs` | One validated definition of the hosting base path, shared by the export, the preview server and the Pages tests | yes |
| `scripts/serve-pages.mjs` | Read-only preview of the export on `127.0.0.1:3100` under the base path | yes |

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

- **`start`, `update` and `complete` each carry the whole `Investigation`.** Those events are
  snapshots, not patches, so a client that joins late or drops an intermediate event still renders a
  coherent state. The cost is redundancy on the wire, which is acceptable for a single local run.
  `error` carries only a message and no investigation, so a client keeps the last snapshot it has.
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

`ProviderState` is `pending`, `investigating`, `complete`, or `unavailable`. An unavailable provider leaves the rest of the observation usable. A successful DNS query with no AAAA records is still an answered query; a resolver timeout is unavailable, and NXDOMAIN is a recorded name-not-found answer.

## Readable overview and next checks

The full interpretation and raw evidence remain available. Overview uses `buildOverviewFindings()` to show one short finding for each main layer. `groupNetworkAddresses()` groups only matching ASNs, retaining each address and prefix; unknown ASNs remain separate.

`buildTakeaway()` uses the captured observation, not the current wall clock. A successful HTTP response is described as success for that request, never as overall site health. Unfinished streams stay neutral, a zero-hop request is not a failed redirect chain, and certificate dates are compared with `startedAt`. Suggested checks are labelled separately from observations and link to the corresponding detail panel. Query removal remains visible because it can change the response.

The DNS integration tests run the real provider against an injected resolver and pass its actual output into the interpreter. Summary unit tests cover success, missing data, DNS failure, HTTP errors, certificate validity and interrupted runs. Browser tests cover expansion, glossary controls, next-check links and detailed readability in both themes.

## The graph

`InfrastructureGraph` is a flat list of `GraphNode` and `GraphEdge`. Nodes are keyed by layer, and
edges are typed `resolution`, `request`, `inference`, or `relationship`, so the UI can style a "we
observed this hop" edge differently from a "we think this is behind that" edge. Keeping the graph as
derived data, rather than something providers mutate, means the interpretation layer can be rewritten
without touching collection.

## Constraints that shaped the design

- **The hosted edition is honest about what it cannot see.** Three layers are `unavailable` with
  `reason: "local-only"` and a stated cause, rather than hidden, faked through a proxy, or filled in by
  a third-party scanning service. Adding a proxy would turn a static page into an open request
  forwarder, which is what the local boundary exists to prevent.
- **Local, single-user, private.** No authentication or tenancy. A small global capacity gate protects accidental local overload, but binding to `127.0.0.1` remains the primary boundary. See [SECURITY.md](../SECURITY.md).
- **Live, not archival.** No stored snapshots and no historical corpus, so re-running the same hostname
  is a fresh observation and may legitimately differ from a previous run.
- **No third-party scanning service.** The instrument only reports what it observed itself, plus public
  network metadata lookups. Optional external enrichment is V3 on the roadmap and is not implemented.
