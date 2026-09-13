import { cloudflareDoh, type DohQuery } from "./doh";
import { nodeHttpTransport, type HttpTransport } from "./transport";
import { nodeTlsTransport, type TlsTransport } from "./tls-transport";
import { randomUUID } from "node:crypto";

import { allowlistJsonFetcher, type JsonFetcher } from "./metadata";
export { allowlistJsonFetcher, METADATA_HOSTS, type JsonFetcher } from "./metadata";

export interface BackendDeps {
  doh: DohQuery;
  http: HttpTransport;
  tls: TlsTransport;
  json: JsonFetcher;
  now: () => Date;
  newId: () => string;
}

export function createDeps(overrides: Partial<BackendDeps> = {}): BackendDeps {
  return {
    doh: cloudflareDoh,
    http: nodeHttpTransport,
    tls: nodeTlsTransport,
    json: allowlistJsonFetcher,
    now: () => new Date(),
    newId: () => randomUUID(),
    ...overrides,
  };
}
