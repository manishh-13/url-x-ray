/** Stop reading at the byte limit, rather than buffering an unbounded response. */
export async function readBoundedJson(response: Response, maxBytes: number, source: string): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw new Error(`${source} response too large`);
  }
  if (!response.body) throw new Error(`${source} returned an empty response`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error(`${source} response too large`);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${source} returned a response that was not JSON`);
  }
}
