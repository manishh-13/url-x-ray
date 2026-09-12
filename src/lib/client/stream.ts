import type { InvestigationEvent } from "@/lib/types";

/** Decode newline-delimited events without depending on network chunk boundaries. */
export async function readInvestigationStream(
  response: Response,
  onEvent: (event: InvestigationEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!response.ok) {
    let message = "The instrument couldn't start this investigation. Please try again.";
    try {
      const body = await response.json();
      if (typeof body.message === "string") message = body.message;
      else if (typeof body.error === "string") message = body.error;
    } catch { /* An upstream error page is not evidence. */ }
    throw new Error(message);
  }
  if (!response.body) throw new Error("This browser couldn't open the investigation stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const parse = (line: string) => {
    if (!line.trim()) return;
    let event: InvestigationEvent;
    try { event = JSON.parse(line) as InvestigationEvent; }
    catch { throw new Error("The evidence stream was interrupted. Please run the X-ray again."); }
    if (!["start", "update", "complete", "error"].includes(event.type)) return;
    if (event.type === "complete" || event.type === "error") completed = true;
    onEvent(event);
  };
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 2_000_000) throw new Error("The evidence stream exceeded the safe display limit.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) parse(buffer);
    if (signal?.aborted) throw new DOMException("Investigation cancelled", "AbortError");
    if (!completed) throw new Error("The connection ended before every layer arrived. The evidence collected so far is still available.");
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
