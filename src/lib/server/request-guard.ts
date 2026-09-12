import { LIMITS } from "./limits";

export type GuardFailure = { ok: false; status: number; message: string };
export type GuardResult<T> = { ok: true; value: T } | GuardFailure;

const fail = (status: number, message: string): GuardFailure => ({ ok: false, status, message });

/**
 * Only same origin POSTs are accepted.
 *
 * Sec-Fetch-Site is checked first because a browser sets it and a page cannot,
 * so a forged value can only ever make this check stricter. Origin is then
 * required and must equal the origin this request arrived on, scheme, host and
 * port included. A request with no Origin is refused rather than trusted, so a
 * cross site form post cannot start an investigation. X-Forwarded-Host and
 * X-Forwarded-Proto are deliberately ignored: they are client settable.
 */
export function checkSameOrigin(headers: Headers, requestUrl: string): GuardResult<true> {
  const refuse = () => fail(403, "This endpoint only accepts same origin requests.");

  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return refuse();

  const origin = headers.get("origin");
  if (!origin) return refuse();

  try {
    const supplied = new URL(origin);
    if (supplied.protocol !== "https:" && supplied.protocol !== "http:") return refuse();
    const received = new URL(requestUrl);
    const host = headers.get("host");
    if (!host) return refuse();
    const expected = new URL(`${received.protocol}//${host}`);
    if (supplied.origin.toLowerCase() !== expected.origin.toLowerCase()) return refuse();
  } catch {
    return refuse();
  }
  return { ok: true, value: true };
}

export function checkContentType(headers: Headers): GuardResult<true> {
  const contentType = headers.get("content-type") ?? "";
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return fail(415, "Send this request as application/json.");
  return { ok: true, value: true };
}

/**
 * Read the body with a hard byte ceiling, streaming so an oversized or endless
 * body is cut off rather than buffered. Nothing from the body is logged.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number = LIMITS.maxRequestBodyBytes,
): Promise<GuardResult<string>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return fail(413, "That request body is larger than this endpoint accepts.");
  }
  if (!request.body) {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      return fail(413, "That request body is larger than this endpoint accepts.");
    }
    return { ok: true, value: text };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return fail(413, "That request body is larger than this endpoint accepts.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: new TextDecoder().decode(buffer) };
}

/** Extract the single field this endpoint accepts, with no logging of input. */
export function parseInvestigateBody(text: string): GuardResult<{ url: string }> {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return fail(400, "That request body was not valid JSON.");
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return fail(400, 'Send a JSON object with a "url" field.');
  }
  const url = (payload as { url?: unknown }).url;
  if (typeof url !== "string" || url.trim() === "") {
    return fail(400, 'Send a JSON object with a "url" field.');
  }
  if (url.length > LIMITS.maxUrlChars) {
    return fail(413, `That URL is longer than the ${LIMITS.maxUrlChars} character limit.`);
  }
  return { ok: true, value: { url } };
}

/** Full request validation, in the order that rejects cheapest first. */
export async function guardInvestigateRequest(request: Request): Promise<GuardResult<{ url: string }>> {
  const origin = checkSameOrigin(request.headers, request.url);
  if (!origin.ok) return origin;
  const contentType = checkContentType(request.headers);
  if (!contentType.ok) return contentType;
  const body = await readBoundedBody(request);
  if (!body.ok) return body;
  return parseInvestigateBody(body.value);
}
