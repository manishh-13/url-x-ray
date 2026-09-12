/**
 * Every bound the backend enforces, in one place so tests and providers agree.
 * Values are deliberately conservative: this tool reads public metadata only.
 */
export const LIMITS = {
  /** Hard ceiling for one investigation, including every provider. */
  investigationMs: 20_000,
  /** Per provider budgets. Their sum may exceed the total on purpose: the total wins. */
  provider: {
    dns: 6_000,
    http: 10_000,
    tls: 8_000,
    network: 6_000,
    technology: 1_500,
  },
  /** One DoH question. */
  dohMs: 2_500,
  /** One HTTP hop, socket connect plus headers plus bounded body. */
  httpHopMs: 6_000,
  /** One TLS handshake. */
  tlsHandshakeMs: 5_000,
  /** One external metadata question (Team Cymru / RIPEstat). */
  metadataMs: 2_500,
  /** Response bytes retained for structural analysis. Nothing beyond this is read. */
  maxHtmlBytes: 512 * 1024,
  /** Redirects followed. The initial request is not a redirect. */
  maxRedirects: 5,
  /** Response headers surfaced per hop. */
  maxHeadersPerHop: 60,
  /** Characters retained per header value. */
  maxHeaderValueChars: 512,
  /** Addresses we will ask external registries about. */
  maxNetworkAddresses: 4,
  /** PTR questions per investigation. */
  maxPtrQueries: 4,
  /** Certificates walked while unrolling a chain. */
  maxChainDepth: 10,
  /** Request body accepted by POST /api/investigate. */
  maxRequestBodyBytes: 4 * 1024,
  /** Characters accepted in the submitted url string. */
  maxUrlChars: 2_048,
  /** Query keys retained as metadata. */
  maxQueryKeys: 24,
} as const;

/** Global, process wide capacity. Not per client: client identity is not trusted. */
export const CAPACITY = {
  maxConcurrent: 3,
  windowMs: 60_000,
  maxPerWindow: 30,
} as const;
