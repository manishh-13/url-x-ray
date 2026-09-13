import { expect, type Page } from "@playwright/test";

export type LookupMode = "success" | "nxdomain" | "blocked" | "partial" | "private-address" | "ripe-fallback";

/** Intercept only the real public lookup transports, never fake a report or API. */
export async function mockBrowserLookups(page: Page, mode: LookupMode = "success") {
  const calls: { url: string; name: string; type: string; referrer?: string; cookie?: string }[] = [];
  await page.route("https://cloudflare-dns.com/dns-query?*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.searchParams.get("name") || "";
    const type = url.searchParams.get("type") || "";
    const headers = request.headers();
    calls.push({ url: url.href, name, type, referrer: headers.referer, cookie: headers.cookie });
    if (mode === "blocked" || (mode === "partial" && type === "HTTPS")) return route.abort("failed");
    const Answer: { name: string; type: number; TTL: number; data: string }[] = [];
    const add = (kind: number, data: string) => Answer.push({ name, type: kind, TTL: 300, data });
    if (mode !== "nxdomain") {
      if (name.endsWith(".origin.asn.cymru.com") && mode !== "ripe-fallback") add(16, '"13335 | 1.1.1.0/24 | AU | apnic | 2011-08-11"');
      else if (name === "AS13335.asn.cymru.com") add(16, '"13335 | US | arin | 2010-07-14 | CLOUDFLARENET, US"');
      else if (type === "PTR") add(12, "one.one.one.one.");
      else if (type === "A") add(1, mode === "private-address" ? "10.0.0.1" : "1.1.1.1");
      else if (type === "CNAME") add(5, "alias.example.net.");
      else if (type === "NS") add(2, "ns.example.net.");
      else if (type === "TXT") add(16, '"v=spf1 -all"');
    }
    await route.fulfill({ status: 200, contentType: "application/dns-json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ Status: mode === "nxdomain" ? 3 : 0, Answer }) });
  });
  await page.route("https://stat.ripe.net/data/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = route.request().headers();
    calls.push({ url: url.href, name: url.searchParams.get("resource") || "", type: "RIPE", referrer: headers.referer, cookie: headers.cookie });
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: url.pathname.includes("network-info") ? { asns: ["13335"], prefix: "1.1.1.0/24" } : { holder: "CLOUDFLARENET" } }) });
  });
  return calls;
}

export async function runBrowserInvestigation(page: Page, url = "example.com") {
  await page.getByLabel("Public URL to investigate").fill(url);
  await page.getByRole("button", { name: "X-ray URL", exact: true }).click();
  await expect(page.locator(".result-title-row h1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Re-run analysis", exact: true })).toBeVisible();
}
