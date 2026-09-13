# Security

The full local app makes bounded requests to public URLs. The hosted browser edition only queries public DNS and network sources. Their boundaries are described separately below.

## Scope: the local app is private and single-user

The local app is intended to run on a developer's own machine, bound to
`127.0.0.1`, and used by one person. The controls below exist to keep the instrument from being tricked
into probing places it should not, and to keep the operator honest about what an investigation reveals.

They are **not** a multi-tenant or production defence. There is no authentication, authorisation, tenancy, durable quota, or abuse logging. A process-local global concurrency and rate cap only limits accidental bursts. If this were exposed to untrusted callers or to a shared
network interface, it would be an open request forwarder and a scanning proxy, and it would need a
different design before that were acceptable. Do not deploy it publicly.

## Scope: the hosted browser edition

The hosted browser edition is a static export with no backend of ours: no API route in the artifact,
nothing that accepts a request, and nothing that could forward one. It performs DNS and public network
lookups only. No HTTP request is sent to the inspected website; its authoritative DNS operator can still see queries forwarded by the resolver. Query values
and the fragment are discarded as in the local app, and the path is never sent anywhere because nothing
requests the target. There are no accounts, cookies, analytics or stored history.

Those lookups do go to third parties. Cloudflare DNS over HTTPS, Team Cymru over that same transport,
and RIPEstat as a fallback receive the hostname, public address or ASN needed for each lookup. Cloudflare and RIPEstat can see the visitor's source IP. Team Cymru sees resolver-originated DNS questions. These services may log their requests. The local app uses the same public services, so this is a property of the lookup rather
than of the hosting.

Deployment is gated and auditable. `.github/workflows/pages.yml` runs only when the repository variable
`ENABLE_PAGES` is `true`, the repository is public and the ref is `main`. Every third-party action is
pinned to a commit SHA, the build job holds read permissions only, and the deploy job is the sole holder
of `pages: write` and `id-token: write`. The uploaded artifact is the static export directory and
nothing else, and both workflows verify that the export contains no API route, no dynamic route and no
server output. No workflow uploads or serves the local app, and nothing deploys from a developer
machine.

## The local app request safety model

### Only publicly routable destinations

A target is rejected unless its resolved addresses are publicly routable. Loopback, link-local
(including the `169.254.0.0/16` cloud metadata range), private RFC 1918 space, carrier-grade NAT,
multicast, reserved, and unique-local IPv6 ranges are all refused, for IPv4 and IPv6 alike. Address
classification uses `ipaddr.js` rather than string matching. Only `http` and `https` schemes are
accepted.

### DNS pinning

The hostname is resolved once, the resolved address is checked for public routability, and the request
is then made against **that** address. The name is not resolved a second time at connect time. This
closes the DNS rebinding window in which a name passes validation as a public address and then resolves
to `127.0.0.1` or `169.254.169.254` a moment later.

### Every redirect is revalidated

A redirect is a new destination chosen by the target, not by the operator, so each hop in the chain is
put through the same checks as the original URL: scheme, resolution, public routability, and pinning.
A redirect to an internal address terminates the chain and is reported as the reason it stopped. The
chain length is bounded, and `HttpData.chainComplete` plus `stoppedReason` record why a chain ended.

### The query string and fragment are discarded before the request is made

The URL is parsed, and everything after the path is dropped. The query string and the fragment are
never sent to the target, never written to a log, and never rendered. Only the presence of a query and
the names of its keys are retained (`hasQuery`, `queryKeys`, `hasFragment` in `ParsedUrl`), because a
key name is often the useful signal and a value is often a token.

**The path is retained and is sent to the target.** It has to be, because the response depends on it.
A path can itself contain secrets, for example a signed download URL, an invite or reset link, or a
tenant identifier. Investigate the origin of such a URL rather than the full link when the path looks
sensitive.

### Requesting a URL is an observable act

The instrument issues one or more bounded `GET` requests to the target and its permitted redirects. That request appears in
the target's access logs, along with the source IP address and timing. There is no way to inspect a URL
over the network without being seen by it. Do not point the instrument at a URL where being observed
matters, including a one-time or single-use link, which the request may consume.

### Third-party lookups see the host or IP being investigated

DNS resolution uses Cloudflare DNS over HTTPS. Network ownership metadata comes from public sources such
as Team Cymru and RIPE. Those providers therefore learn the hostname or IP address under investigation
and the fact that this machine asked about it. That is unavoidable for the lookup and worth knowing
before investigating anything sensitive. The full URL, its query, and its fragment are never sent to
them.

### No JavaScript, no subresources

The response body is treated as bytes. Nothing is executed, no browser engine is involved, and no
subresource, script, stylesheet, image, or iframe is followed. The instrument does not become a
crawler, and a hostile page cannot run code in the investigation path.

### No cookies, no credentials, no ambient identity

Outbound requests carry no cookies, no `Authorization` header, and no credentials of any kind, and
`Set-Cookie` is not honoured or persisted. The browser-to-app request is sent with
`credentials: "omit"`. This does not hide the source IP address, timing or requested path. Targets can still log and correlate that information.

### Bounded work

Response bodies are read up to a byte cap and marked `truncated` when the cap is hit
(`TechnologyData.analyzedBytes`, `truncated`). Redirect chains, per-request timeouts, and total run
duration are bounded, and the client decoder caps its own buffer at 2 MB. A slow or enormous target
degrades the run rather than exhausting the process.

## What the instrument does not do

- No stored history, no snapshots, no persistence between runs. Re-running a hostname performs a fresh
  live investigation, and results may legitimately differ from a previous run. There is nothing to
  retrieve after the fact.
- No third-party scanning service. Nothing in the codebase talks to urlscan.io or any equivalent.
  Optional external enrichment is V3 on the roadmap and is not implemented.
- No port scanning, no path or directory enumeration, no vulnerability probing, no authentication
  attempts. The local app requests only the URL it was given, minus the discarded query string and
  fragment, and follows the redirects that URL returns. The hosted browser edition sends no request to
  the target at all.

## Handling of untrusted input

Response headers, certificate fields, PTR records, and network organisation names are attacker
controlled. They are rendered as text, never as markup, and they are used for display and inference
only, never to build a filesystem path or a shell command. Error messages shown to the operator are
written by this project; an upstream response body is not surfaced as an error.

## Reporting a problem

Report anything security-relevant privately first, through **Security > Report a vulnerability** on the
[repository security page](https://github.com/manishh-13/url-x-ray/security), rather than in a public issue. Please do not include a live sensitive URL in a report:
describe the shape of it instead. This is a small personal project maintained in spare time, so there is
no response-time commitment, and a fix may be a documentation change rather than code.
