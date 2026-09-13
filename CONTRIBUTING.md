# Contributing

This is a private, unreleased project with a small group of contributors. There is no external
contribution process. These are the working conventions for the people on it.

## Setup

```bash
npm ci
npm run dev     # http://127.0.0.1:3099
```

Node.js 22 or newer. Use `npm ci`, not `npm install`, so the lockfile stays authoritative. No API keys
or `.env` file are needed; if a change ever needs one, that is a design discussion first.

## Before you push

```bash
npm run check   # typecheck, then unit tests, then build
```

CI runs exactly these three steps, in this order, on every push and pull request, and in a second job
it typechecks the static shell, builds the export, and asserts the export is static only. Neither job
deploys, publishes, or releases anything. A red build is not "flaky until proven otherwise": read it.

Playwright tests are not in CI and are run locally:

```bash
npm run test:e2e
```

`playwright.config.ts` reuses an already running dev server, so `npm run dev` in another terminal makes
the suite much faster. Without one it starts `npm run dev` itself.

### The static shell

The hosted browser edition is built from `pages-app`, a second, tiny Next application whose pages
re-export the shared routes in `src/app`. It exists so the local app keeps its API route, its dynamic
route and its dev workflow unchanged while the export has none of them.

```bash
npm run typecheck:pages   # tsc for pages-app
npm run build:pages       # static export into pages-app/out
npm run preview:pages     # serve that export on 127.0.0.1:3100 under /url-x-ray
npm run test:pages        # Playwright against the export, assumes it is already built
```

Things worth knowing before changing it:

- `npm run dev`, `npm run build` and `npm start` must stay identical. The shell adds scripts; it never
  changes the local ones. Output stays separate: `.next` for the local app, `pages-app/.next` and
  `pages-app/out` for the export.
- The base path comes from `PAGES_BASE_PATH` (default `/url-x-ray`) and is validated once in
  `scripts/base-path.mjs`, which `pages-app/next.config.mjs`, the preview server and the Pages test
  config all import. That config is `.mjs` rather than `.ts` because Next's config transpile step does
  not resolve a relative `.mjs` import from a TypeScript config. A base path ends up in every emitted URL, so an invalid value fails the build rather than
  producing a site whose assets 404.
- Edition differences belong in `src/lib/edition.ts` and `src/components/edition.tsx`, decided at build
  time from `NEXT_PUBLIC_XRAY_EDITION`. A runtime switch would let a static page claim capabilities it
  does not have.
- A layer the hosted edition cannot collect is `unavailable` with `reason: "local-only"`, which is a
  deliberate omission and not a failed observation. Do not report it as an error.
- Root `tsconfig.json` excludes `pages-app`, so `npm run typecheck` and `npm run typecheck:pages` do not
  fight over generated Next types.
- `playwright.config.ts` ignores `pages*.spec.ts` and `playwright.pages.config.ts` runs only those, so
  the local suite and the export suite never share a server or a port.

## Ownership

The work is split so that contributors do not collide:

- **Backend and providers**: the API route and one module per layer (DNS, HTTP, TLS, network,
  technology).
- **Interpretation**: findings and graph assembly from provider output.
- **UI**: pages, components, and the end-to-end tests in `tests/e2e`.
- **Docs, tooling, and the stream decoder unit tests**: this file, `README.md`,
  `docs/ARCHITECTURE.md`, `SECURITY.md`, `LICENSE`, `.github/workflows/ci.yml`,
  `playwright.config.ts`, `tests/unit/stream.test.ts`.
- **The static shell and its deployment**: `pages-app/`, `scripts/base-path.mjs`,
  `scripts/serve-pages.mjs`, `playwright.pages.config.ts`, `tests/e2e/pages*.spec.ts`,
  `.github/workflows/pages.yml`.

Changing `src/lib/types.ts` affects everyone, so raise it before you change it.

## Code conventions

- TypeScript in `strict` mode. No `any`, no non-null `!` to silence a type you have not understood.
- Import internal modules through the `@/` alias, which maps to `src/`.
- The evidence rule: a provider returns data plus `Evidence`, never a conclusion. Anything interpretive
  carries the `evidenceIds` it was derived from, and is labelled `observed`, `inferred`, or `unknown`
  honestly. An inference presented as an observation is a bug.
- `unavailable` is a normal provider outcome. A missing AAAA record or a closed port is information;
  render it, do not fail the run.
- Extend what exists rather than adding a parallel abstraction. Use the primitives in
  `src/components/primitives.tsx` and the layer names it already exports.
- Comment the reason, not the mechanism. If the code needs a comment to say what it does, rename
  something instead.
- No em dashes and no en dashes in prose, comments, or UI copy. Use commas, colons, semicolons,
  parentheses, or "to" for ranges.

## Security-relevant changes

Anything that touches how a target is chosen, resolved, or requested is security-relevant: URL parsing,
address classification, redirect handling, timeouts, or size caps. Read [SECURITY.md](SECURITY.md)
first, keep the guarantees it documents, and update it in the same change if a guarantee moves. Do not
loosen a check to make a test pass.

## Tests

- Unit tests in `tests/unit/**/*.test.ts`, run under Vitest in a Node environment.
- End-to-end tests in `tests/e2e`, run under Playwright.
- New logic ships with a test. For the request safety model in particular, the interesting cases are the
  ones a hostile target would try: a redirect to a private address, a name that resolves to loopback, a
  chain that never terminates, a body that never ends.
- Do not make a live network request in a unit test. Construct a `Response` or stub the provider.

## Commits and reviews

Small, self-contained commits with a subject line that says what changed and why. A change that spans
several files should say in the description which of the areas above it touches. Because the repository
is private, nothing here is a public promise; the bar is still that `npm run check` passes and the
documentation matches the code.
