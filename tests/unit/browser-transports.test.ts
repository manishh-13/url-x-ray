import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudflareDoh } from "@/lib/server/doh";
import { allowlistJsonFetcher } from "@/lib/server/metadata";
import { readBoundedJson } from "@/lib/server/bounded-json";

afterEach(() => vi.unstubAllGlobals());
const signal = () => new AbortController().signal;

describe("browser-compatible fixed lookup transports", () => {
  it("sends anonymous CORS DNS queries only to the fixed HTTPS resolver", async () => {
    const fetcher = vi.fn(async () => Response.json({ Status: 0, Answer: [{ name: "example.com.", type: 1, TTL: 300, data: "1.1.1.1" }] }));
    vi.stubGlobal("fetch", fetcher);
    expect(await cloudflareDoh("example.com", "A", signal())).toMatchObject({ status: 0, answers: [{ name: "example.com", data: "1.1.1.1" }] });
    const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://cloudflare-dns.com");
    expect(url.pathname).toBe("/dns-query");
    expect(url.searchParams.get("name")).toBe("example.com");
    expect(options).toMatchObject({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", mode: "cors" });
  });

  it.each([
    "https://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1",
    "https://stat.ripe.net/data/as-overview/data.json?resource=AS13335",
  ])("reads only public metadata at %s", async (url) => {
    const fetcher = vi.fn(async () => Response.json({ data: {} }));
    vi.stubGlobal("fetch", fetcher);
    await expect(allowlistJsonFetcher(url, signal())).resolves.toEqual({ data: {} });
    expect(fetcher).toHaveBeenCalledWith(new URL(url), expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", mode: "cors" }));
  });

  it.each([
    "https://example.com/", "http://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1",
    "https://stat.ripe.net:444/data/network-info/data.json?resource=1.1.1.1",
    "https://user:pass@stat.ripe.net/data/network-info/data.json?resource=1.1.1.1",
    "https://stat.ripe.net/other?resource=1.1.1.1",
    "https://stat.ripe.net/data/network-info/data.json?resource=127.0.0.1",
    "https://stat.ripe.net/data/network-info/data.json?resource=internal.corp",
    "https://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1&resource=10.0.0.1",
    "https://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1&extra=secret",
    "https://stat.ripe.net/data/network-info/data.json?resource=1.1.1.1#secret",
    "https://stat.ripe.net/data/as-overview/data.json?resource=ASinvalid",
  ])("rejects non-allowlisted metadata %s before fetching", async (url) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(allowlistJsonFetcher(url, signal())).rejects.toThrow("not allowlisted");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("bounded public JSON reads", () => {
  it("joins split UTF-8 codepoints before parsing", async () => {
    const bytes = new TextEncoder().encode('{"text":"café"}');
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }));
    await expect(readBoundedJson(response, 50, "Resolver")).resolves.toEqual({ text: "café" });
  });
  it("stops and cancels a chunked oversized body without buffering the tail", async () => {
    let read = 0; const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull(controller) { read++; controller.enqueue(new Uint8Array(128)); }, cancel }, { highWaterMark: 0 }));
    await expect(readBoundedJson(response, 200, "Resolver")).rejects.toThrow("Resolver response too large");
    expect(read).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels a declared oversized body before reading it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": "200" } });
    await expect(readBoundedJson(response, 100, "Registry")).rejects.toThrow("Registry response too large");
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("does not echo untrusted error markup", async () => {
    await expect(readBoundedJson(new Response("<script>untrusted</script>"), 100, "Resolver")).rejects.toThrow("Resolver returned a response that was not JSON");
  });
});
