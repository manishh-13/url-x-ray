# URL X-Ray

An evidence-first, interactive map of the public Internet infrastructure behind a URL.

A small project for curious people and anyone investigating a public URL. Paste an address to see its DNS records, redirects, response headers, certificate and network connections come together.

Start with **What happened**, a short takeaway about the observation. When the evidence shows a problem, **What to check next** points to the relevant details. Overview keeps the story to five findings; **Show all findings** opens the full explanation, and every layer has an optional plain-language glossary.

Observed facts and inferred platform hints stay labelled, with the collected evidence a click away. Light mode is the default; a softer dark theme is available for the current visit.

> **MIT licensed.** Free to use, fork and modify. The hosted edition runs entirely in your browser. The full local app adds the certificate, redirect, header and technology checks. See [LICENSE](LICENSE).

![The light-theme browser edition investigating example.com and exploring DNS and network evidence](docs/xray-sequence.gif)

Recorded from the live browser edition. [Try URL X-Ray](https://manishh-13.github.io/url-x-ray/).

## Two editions of the same instrument

The interface, the evidence model and the DNS and network collection code are shared. What differs is
whether the app can open a connection to the site being inspected.

| Layer | Hosted browser edition | Full local app |
| --- | --- | --- |
| URL parsing, validation and the public boundary check | yes | yes |
| DNS records over DNS over HTTPS (A, AAAA, CNAME, NS, MX, TXT, CAA, HTTPS, SVCB) | yes, live | yes, live |
| IP and network: ASN, announcing organisation, prefix, registry country | yes, live | yes, live |
| Reverse DNS (PTR) for the observed addresses | yes, live | yes, live |
| Network affiliation hints, labelled as inferred (not proof of hosting) | yes | yes |
| Redirect chain, final status and response headers | no | yes |
| TLS certificate: issuer, validity, names, chain | no | yes |
| Response technologies from headers and HTML | no | yes |
| Findings, graph, evidence panel, JSON, SVG and PNG export | yes, for the layers above | yes |

Cross-origin response inspection depends on the target opting in with CORS, a browser permission. Arbitrary websites do not reliably expose their redirect chains, headers or HTML this way. Certificates are not exposed to page JavaScript at all. The hosted edition says so in
place, with the reason, instead of showing an empty panel, and it never requests the site you are
inspecting: it asks a public resolver about the name and a public registry about the addresses that came
back, and nothing else leaves the browser. The URL path stays in the browser and in any report exported
from it.

The hosted edition relies on free third-party lookups (Cloudflare DNS over HTTPS, Team Cymru, RIPEstat)
and GitHub Pages. Public-repository Pages hosting is free today and needs no payment method, but service policies and usage limits can change. Both editions depend on the public lookup services.

## Requirements

- Node.js 22 or newer (`engines.node: ">=22"`)
- npm (the repository ships a `package-lock.json`; use `npm ci`)

No API keys, accounts, or `.env` file are required to run the instrument. The interface uses the platform system font stack, so it feels native on Apple, Windows, and Android devices and does not contact a font CDN.

## Getting started

Install Node.js 22 or newer first. No API keys or configuration are needed.

**Download the project:** get [the ZIP](https://github.com/manishh-13/url-x-ray/archive/refs/heads/main.zip), extract it, and open a terminal in the extracted folder containing `package.json`. Run:

```bash
npm ci
npm run dev
```

Then open <http://127.0.0.1:3099>. The server binds only to your machine. Keep it local, do not expose this request-making backend as a public service.

Prefer git instead of a ZIP?

```bash
git clone https://github.com/manishh-13/url-x-ray.git
cd url-x-ray
npm ci
npm run dev
```

No account is needed to download either one.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on `127.0.0.1:3099` |
| `npm run build` | Production build |
| `npm start` | Serve the production build on `127.0.0.1:3099` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (`tests/unit/**/*.test.ts`) |
| `npm run test:e2e` | Playwright end-to-end tests (`tests/e2e`) |
| `npm run check` | typecheck, then unit tests, then build |
| `npm run typecheck:pages` | `tsc --noEmit` for the static shell in `pages-app` |
| `npm run build:pages` | Static export of the hosted browser edition into `pages-app/out` |
| `npm run preview:pages` | Serve that export from `127.0.0.1:3100` under `/url-x-ray` |
| `npm run test:pages` | Playwright tests for the export (`tests/e2e/pages*.spec.ts`) |
| `npm run check:pages` | typecheck the shell, then build the export |

`npm run dev`, `npm run build` and `npm start` are unchanged by the static shell: the local app is
still one Next application on `127.0.0.1:3099`, and its build output stays in `.next` while the export
builds into `pages-app/.next` and `pages-app/out`.

## Preview the hosted edition

```bash
npm run build:pages
npm run preview:pages
```

Open <http://127.0.0.1:3100/url-x-ray/>. This serves the static artifact, not the full local backend. The project subpath is tested so assets and shared hostname links work on GitHub Pages. Set `PAGES_BASE_PATH` consistently when building and previewing a different mount point; an empty value builds for a domain root.

### How the hosted edition is deployed

`.github/workflows/pages.yml` publishes it to GitHub Pages on a push to `main`, and only when the repository is public and the Actions variable `ENABLE_PAGES` is `true`. It reads the real Pages base path, builds the static edition and uploads `pages-app/out` alone. GitHub Pages is free for public repositories and needs no payment method. The local backend is never deployed.

## How a run works

In the full local app, the client posts a URL to the investigation API and reads the response as a stream of
newline-delimited JSON (NDJSON) events, so each layer appears as soon as it resolves instead of the
page waiting for the slowest lookup.

```
POST /api/investigate    { "url": "https://example.com/path" }
-->  application/x-ndjson, one JSON event per line:
     {"type":"start","investigation":{...}}
     {"type":"update","investigation":{...}}     (repeated, once per layer)
     {"type":"complete","investigation":{...}}
     {"type":"error","message":"a message safe to show a person"}
```

`start`, `update`, `complete`, and `error` are the four event types; `complete` and `error` are
terminal. In the hosted browser edition there is no app API request: the same event
sequence is produced in the page by `src/lib/client/browser-investigate.ts` and consumed by the same
hook, so both editions share one contract. The decoder in `src/lib/client/stream.ts` is independent of network chunk boundaries, and
`src/lib/client/use-investigation.ts` owns cancellation and per-run generation tracking so a stale
stream can never overwrite a newer one.

**Status:** the live V1 and V1.5 path is implemented. The API streams snapshots from independent DNS, HTTP, TLS, network, and technology providers into the evidence model and the interactive graph.

## What it looks at

The investigation is organised as layers, each backed by its own provider (see
`ProviderId` in `src/lib/types.ts`):

- **The URL** itself, parsed and normalised
- **DNS resolution** over DNS-over-HTTPS
- **The response**: redirect chain, final status, and security-relevant response headers
- **TLS certificate**: issuer, subject, subject alternative names, validity, chain
- **IP and network**: ASN, reported network organisation, prefix, registry country
- **Technologies** and **edge/hosting**, inferred from the evidence above and labelled as inferred

## Roadmap

**V1: core investigation, implemented.** URL parsing, DNS resolution, redirect chain and response headers, IP and network affiliation, the evidence model, and the infrastructure graph.

**V1.5: TLS and technology, implemented.** Certificate inspection and the technology and edge/hosting inference layer, each entry carrying the evidence ids it was derived from.

**V2: compare and history.** Investigate two URLs side by side, and a session-scoped history of the
runs made in the current browser session.

**V3 (optional, not committed): third-party enrichment.** Optional, explicitly opt-in enrichment from
an external scanning service such as urlscan.io.

Nothing in V2 or V3 is implemented today. Nothing in the codebase talks to urlscan.io or any other
third-party scanning service, and there is no historical persistence: re-running a hostname performs a
fresh live investigation rather than reading back a stored snapshot.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module layout, the event stream, and the evidence model
- [SECURITY.md](SECURITY.md): the request safety model and what an investigation exposes
- [CONTRIBUTING.md](CONTRIBUTING.md): local workflow and the bar for a change
