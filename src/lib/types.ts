export type Confidence = "observed" | "inferred" | "unknown";
export type ProviderId = "dns" | "http" | "tls" | "network" | "technology";
export type ProviderStatus = "pending" | "investigating" | "complete" | "unavailable";
export type Layer = "url" | ProviderId | "infrastructure" | "history";

export interface ParsedUrl {
  href: string;
  hostname: string;
  scheme: "https" | "http";
  port: string;
  pathname: string;
  queryKeys: string[];
  hasQuery: boolean;
  hasFragment: boolean;
  display: string;
}

export interface Evidence {
  id: string;
  source: ProviderId | "url";
  kind: string;
  label: string;
  value: string;
  confidence: Confidence;
  observedAt: string;
  sourceUrl?: string;
  explanation?: string;
}

export interface ProviderState {
  status: ProviderStatus;
  message?: string;
  durationMs?: number;
}

export interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl: number;
}

export interface DnsData {
  resolver: string;
  records: DnsRecord[];
  addresses: string[];
  queryStatus: Record<string, string>;
}

export interface HttpHop {
  url: string;
  status: number;
  location?: string;
  headers: Record<string, string>;
  durationMs: number;
  address?: string;
}

export interface HeaderSignal {
  name: string;
  title: string;
  state: "present" | "absent" | "unknown";
  explanation: string;
  value?: string;
}

export interface HttpData {
  hops: HttpHop[];
  finalUrl: string;
  finalStatus: number;
  redirectCount: number;
  chainComplete: boolean;
  stoppedReason?: string;
  headerSignals: HeaderSignal[];
  durationMs: number;
}

export interface CertificateLink {
  subject: string;
  issuer: string;
  validTo: string;
}

export interface TlsData {
  hostname: string;
  issuer: string;
  subject: string;
  sans: string[];
  validFrom: string;
  validTo: string;
  protocol: string;
  fingerprint256: string;
  authorized: boolean;
  authorizationError?: string;
  chain: CertificateLink[];
}

export interface NetworkAddress {
  ip: string;
  version: 4 | 6;
  asn?: string;
  organization?: string;
  prefix?: string;
  country?: string;
  ptr?: string[];
  source: string;
  sourceUrl?: string;
}

export interface NetworkData {
  addresses: NetworkAddress[];
  limited: boolean;
}

export interface Technology {
  name: string;
  category: "Frontend" | "Backend" | "Infrastructure" | "Analytics";
  confidence: "observed" | "inferred";
  evidenceIds: string[];
  explanation: string;
}

export interface InfrastructureGuess {
  name: string;
  confidence: "inferred";
  evidenceIds: string[];
  explanation: string;
}

export interface TechnologyData {
  technologies: Technology[];
  infrastructure: InfrastructureGuess[];
  analyzedBytes: number;
  truncated: boolean;
}

export interface Investigation {
  id: string;
  url: ParsedUrl;
  startedAt: string;
  finishedAt?: string;
  providers: Record<ProviderId, ProviderState>;
  dns?: DnsData;
  http?: HttpData;
  tls?: TlsData;
  network?: NetworkData;
  technology?: TechnologyData;
  evidence: Evidence[];
}

export type InvestigationEvent =
  | { type: "start"; investigation: Investigation }
  | { type: "update"; investigation: Investigation }
  | { type: "complete"; investigation: Investigation }
  | { type: "error"; message: string };

export interface Finding {
  id: string;
  layer: Layer;
  title: string;
  description: string;
  confidence: Confidence;
  evidenceIds: string[];
}

export interface GraphNode {
  id: string;
  layer: Layer;
  eyebrow: string;
  label: string;
  detail: string;
  confidence: Confidence;
  status: ProviderStatus;
  evidenceIds: string[];
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: "resolution" | "request" | "inference" | "relationship";
}

export interface InfrastructureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
