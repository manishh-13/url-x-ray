import type { Evidence, Finding, Investigation, Layer, NetworkAddress, ProviderId } from "./types";
import { dnsNameDoesNotExist, dnsQueryOutcome, failedDnsQueries } from "./dns-status";

export interface NextCheck {
  id: string;
  title: string;
  description: string;
  layer: Layer;
  evidenceIds: string[];
}

export interface Takeaway {
  tone: "positive" | "attention" | "neutral" | "pending";
  title: string;
  description: string;
  layer: Layer;
  evidenceIds: string[];
  notes: string[];
  nextChecks: NextCheck[];
}

export interface NetworkGroup {
  id: string;
  asn?: string;
  organizations: string[];
  prefixes: string[];
  addresses: NetworkAddress[];
}

function idsFor(i: Investigation, source: Evidence["source"]): string[] {
  return i.evidence.filter((item) => item.source === source).map((item) => item.id);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : noun === "address" ? "es" : "s"}`;
}

function shortList(values: string[], limit = 2): string {
  return values.slice(0, limit).join(", ") + (values.length > limit ? ` and ${values.length - limit} more` : "");
}

function observedDate(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) + " UTC"
    : undefined;
}

function isLiteral(i: Investigation): boolean {
  const statuses = Object.values(i.dns?.queryStatus ?? {});
  return statuses.length > 0 && statuses.every((value) => value.trim().length > 0 && dnsQueryOutcome(value) === "not-applicable");
}

/** Group only matching ASNs. An absent ASN never merges unrelated addresses. */
export function groupNetworkAddresses(addresses: NetworkAddress[]): NetworkGroup[] {
  const groups = new Map<string, NetworkGroup>();
  const seen = new Set<string>();
  for (const address of addresses) {
    if (seen.has(address.ip)) continue;
    seen.add(address.ip);
    const asn = address.asn?.trim().toUpperCase() || undefined;
    const id = asn ? `asn:${asn}` : `address:${address.ip}`;
    const group = groups.get(id) ?? { id, asn, organizations: [], prefixes: [], addresses: [] };
    group.addresses.push(address);
    if (address.organization && !group.organizations.includes(address.organization)) group.organizations.push(address.organization);
    if (address.prefix && !group.prefixes.includes(address.prefix)) group.prefixes.push(address.prefix);
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** Recommendations are suggestions, derived from captured facts, never a guessed root cause. */
export function buildTakeaway(i: Investigation, running: boolean): Takeaway {
  const http = i.http;
  const tls = i.url.scheme === "https" ? i.tls : undefined;
  const hasResponse = !!http?.hops.length && http.finalStatus >= 100 && http.finalStatus <= 599;
  const failedDns = failedDnsQueries(i.dns);
  const notes: string[] = [];
  if (i.url.hasQuery) notes.push("Query parameters were removed before the request. The full URL may return a different result.");
  const result = (tone: Takeaway["tone"], title: string, description: string, layer: Layer, nextChecks: NextCheck[] = []): Takeaway => ({
    tone, title, description, layer, evidenceIds: idsFor(i, layer === "infrastructure" ? "technology" : layer === "history" ? "url" : layer), notes, nextChecks,
  });
  const check = (id: string, title: string, description: string, layer: Evidence["source"]): NextCheck => ({
    id, title, description, layer, evidenceIds: idsFor(i, layer),
  });

  if (running) {
    return result("pending", hasResponse ? `HTTP ${http!.finalStatus} received. Finishing the checks.` : "Following this URL, one layer at a time.",
      "The summary will settle when the remaining checks finish. You can already open any findings that have arrived.", hasResponse ? "http" : "dns");
  }
  if (!i.finishedAt) {
    return result("neutral", "This investigation stopped early.", "The findings collected so far are still available. Re-run the investigation to finish the remaining checks.", hasResponse ? "http" : "dns");
  }

  const blocked = i.evidence.find((item) => item.source === "http" && item.kind === "blocked");
  const refusedAddress = i.evidence.some((item) => item.source === "dns" && item.kind === "refused-address");
  if (blocked || (refusedAddress && !hasResponse)) {
    const layer = http?.hops.length ? "http" : "dns";
    return result("attention", "The request stopped before its destination.",
      http?.stoppedReason || "A DNS answer pointed outside the public Internet, so the request was not sent.", layer,
      [check("public-destination", "Check the public destination", "Inspect the DNS answer or redirect that stopped this run. If you manage the URL, confirm that it points to the intended public endpoint.", layer)]);
  }
  if (!hasResponse && dnsNameDoesNotExist(i.dns)) {
    return result("attention", "This hostname did not resolve.", `The resolver returned NXDOMAIN for ${i.url.hostname}, meaning the name was not found in this DNS lookup.`, "dns",
      [check("dns-name", "Check the hostname and its DNS records", "Check the spelling first. If you manage this name, check its records at your DNS provider, then try again after any changes have propagated.", "dns")]);
  }
  if (!hasResponse && !i.dns?.addresses.length) {
    const addressQueries = ["A", "AAAA"].map((type) => dnsQueryOutcome(i.dns?.queryStatus[type]));
    const noAddresses = addressQueries.every((outcome) => outcome === "success");
    return result("neutral", noAddresses ? "No public address was returned." : "The address lookup could not be completed.",
      noAddresses ? "The DNS lookup completed without an address this tool could connect to." : "This run could not establish a public address for the hostname. That does not tell us whether another resolver can reach it.", "dns",
      [check("dns-address", noAddresses ? "Check the address records" : "Check the resolver response", noAddresses
        ? "If this name should serve a website, check its A, AAAA or CNAME records with your DNS provider."
        : "Open the query results to see which lookup failed. Compare with your usual resolver before changing the site's DNS records.", "dns")]);
  }

  const checks: NextCheck[] = [];
  const observed = Date.parse(i.startedAt);
  const expiry = tls ? Date.parse(tls.validTo) : NaN;
  const starts = tls ? Date.parse(tls.validFrom) : NaN;
  let certificateTitle: string | undefined;
  let certificateDescription = "";
  if (tls && Number.isFinite(observed) && Number.isFinite(expiry) && expiry < observed) {
    certificateTitle = "The certificate had expired.";
    certificateDescription = `The certificate presented for ${tls.hostname} expired on ${observedDate(tls.validTo)}.`;
    checks.push(check("tls-expired", "Check certificate renewal", "If you manage this hostname, check renewal and confirm that its HTTPS endpoint is serving the renewed certificate.", "tls"));
  } else if (tls && Number.isFinite(observed) && Number.isFinite(starts) && starts > observed) {
    certificateTitle = "The certificate was not valid yet.";
    certificateDescription = `The certificate presented for ${tls.hostname} becomes valid on ${observedDate(tls.validFrom)}, after this observation.`;
    checks.push(check("tls-future", "Check the certificate dates and clock", "Compare the validity dates with the observer's clock. If you manage the endpoint, confirm that the correct certificate is deployed.", "tls"));
  } else if (tls?.authorized === false) {
    certificateTitle = "The certificate check failed.";
    certificateDescription = `The separate HTTPS check for ${tls.hostname} failed validation${tls.authorizationError ? `: ${tls.authorizationError}` : "."}`;
    if (tls.authorizationError === "ERR_TLS_CERT_ALTNAME_INVALID") {
      checks.push(check("tls-name", "Check the certificate's hostname", "Compare the requested hostname with the names listed on the certificate. If you manage the endpoint, check that it serves the certificate for this hostname.", "tls"));
    } else if (tls.authorizationError === "CERT_HAS_EXPIRED") {
      checks.push(check("tls-expired", "Check certificate renewal", "The validator reported an expired certificate. If you manage the endpoint, check renewal and the certificate currently being served.", "tls"));
    } else {
      checks.push(check("tls-validation", "Inspect the certificate validation error", "Open the certificate and its chain. Compare the recorded error with your browser; if you manage the endpoint, check the certificate chain it serves.", "tls"));
    }
  }

  let title: string;
  let description: string;
  let tone: Takeaway["tone"] = "attention";
  const reason = http?.stoppedReason || i.providers.http.message;
  if (hasResponse && http!.chainComplete === false) {
    title = "The redirect chain stopped early.";
    description = `Captured ${count(http!.hops.length, "response")}.${reason ? ` ${reason}` : " The final destination was not reached."}`;
    checks.push(check("http-redirect", "Inspect the last redirect", "Open the recorded hops and stopping reason. If you manage these URLs, check the last Location header and whether any hop points back to an earlier URL.", "http"));
  } else if (!hasResponse) {
    tone = "neutral";
    title = "No HTTP response was captured.";
    description = reason || "The request ended before a response arrived. The other collected findings are still available.";
    if (!certificateTitle) checks.push(check("http-unavailable", "Inspect where the request stopped", "Open the recorded request error and compare with a normal browser request. If you manage the endpoint, check its logs at the observation time.", "http"));
  } else {
    const status = http!.finalStatus;
    const redirects = http!.redirectCount;
    description = `The server returned HTTP ${status}${redirects ? ` after ${count(redirects, "redirect")}` : " with no redirects"}.`;
    if (status >= 200 && status < 300) {
      tone = "positive";
      title = "This request succeeded.";
      if (redirects) description += ` It ended at ${http!.finalUrl}.`;
    } else if (status === 401) {
      title = "This request needs authentication (HTTP 401).";
      checks.push(check("http-auth", "Check the access requirements", "Confirm whether this path is meant to be public or requires sign-in. This check sends no credentials; compare with your normal signed-in browser session if needed.", "http"));
    } else if (status === 403) {
      title = "This request was refused (HTTP 403).";
      checks.push(check("http-forbidden", "Check the access requirements", "Compare this URL with a normal browser request. If you manage the endpoint, inspect its access rules and logs to find why this request was refused.", "http"));
    } else if (status === 404 || status === 410) {
      title = status === 404 ? "This path was not found (HTTP 404)." : "This resource is gone (HTTP 410).";
      checks.push(check("http-path", "Check the requested path", "Confirm the path and any redirects. If you manage the site, check that this resource or application route exists.", "http"));
    } else if (status === 429) {
      title = "This request was rate limited (HTTP 429).";
      checks.push(check("http-rate", "Respect the retry interval", "Look for a Retry-After response header and wait before retrying. If you manage the endpoint, check the rate limit that handled this request.", "http"));
    } else if (status >= 500) {
      title = `The server returned an error (HTTP ${status}).`;
      checks.push(check("http-server", "Check the responding service", "If you operate this endpoint, correlate the observation time and response headers with your service or proxy logs. The response code alone does not identify the failing component.", "http"));
    } else if (status >= 300 && status < 400) {
      tone = "neutral";
      title = `The server returned HTTP ${status}.`;
      if (status === 304) description = "The server returned Not Modified, a response used with cached content.";
      else checks.push(check("http-location", "Inspect the redirect response", "Open the response headers and check its Location value. This run did not follow a further destination from this response.", "http"));
    } else {
      title = `The server returned HTTP ${status}.`;
      checks.push(check("http-status", "Inspect the response details", "Check the response headers and requested path. If you manage the endpoint, use the observation time to find the matching request in its logs.", "http"));
    }
  }

  if (failedDns.length) {
    notes.push(`${shortList(failedDns, 3)} DNS ${failedDns.length === 1 ? "query was" : "queries were"} unavailable; other returned records remain usable.`);
    checks.push(check("dns-partial", "Inspect the unavailable DNS queries", "Open Query availability to see each resolver result. Compare the failed record types with your usual resolver before changing DNS settings.", "dns"));
  }
  if (i.url.scheme === "https" && !tls && hasResponse) notes.push("The separate certificate check was unavailable. Open Certificate for the recorded reason.");
  const extras = (["network", "technology"] as const).filter((id) => i.providers[id].status === "unavailable");
  if (extras.length) notes.push(`${extras.map((id) => id === "network" ? "Network details" : "Technology signals").join(" and ")} could not be collected in this run.`);

  if (certificateTitle) {
    if (hasResponse) certificateDescription += ` The HTTP check separately received HTTP ${http!.finalStatus}${http!.chainComplete ? "." : ", but its redirect chain did not finish."}`;
    return result("attention", certificateTitle, certificateDescription, "tls", checks.slice(0, 2));
  }
  return result(tone, title, description, "http", checks.slice(0, 2));
}

/** One short finding per layer keeps Overview readable; full findings remain available. */
export function buildOverviewFindings(i: Investigation, running: boolean): Finding[] {
  const take = buildTakeaway(i, running);
  const overview: Finding[] = [];
  const add = (id: string, layer: Evidence["source"], title: string, description: string, confidence: Finding["confidence"] = "observed") => {
    overview.push({ id: `overview-${id}`, layer, title, description, confidence, evidenceIds: idsFor(i, layer) });
  };
  const fallback = (layer: ProviderId, label: string) => {
    const pending = running && ["pending", "investigating"].includes(i.providers[layer].status);
    add(layer, layer, pending ? `${label} is being checked` : `${label} was not captured`, pending ? "The result will appear as soon as this check finishes." : "Open this layer for the recorded reason and any partial findings.", "unknown");
  };
  const addresses = [...new Set(i.dns?.addresses ?? [])];
  if (isLiteral(i)) add("dns", "dns", "An IP address was supplied directly", `${i.url.hostname} is the address in the URL; a DNS lookup was not needed.`);
  else if (addresses.length) {
    const failed = failedDnsQueries(i.dns);
    add("dns", "dns", `DNS returned ${count(addresses.length, "address")}`, `${i.url.hostname} resolved to ${shortList(addresses)}.${failed.length ? ` ${shortList(failed)} ${failed.length === 1 ? "query was" : "queries were"} unavailable.` : " Open DNS to explore the records."}`);
  } else if (dnsNameDoesNotExist(i.dns)) add("dns", "dns", "The hostname was not found in DNS", "The resolver returned NXDOMAIN. Check the hostname and its DNS records.");
  else if (i.dns) add("dns", "dns", "No public address was available", "Open the DNS records and query results to see what the resolver returned.", "unknown");
  else fallback("dns", "DNS");

  if (i.http?.hops.length && i.http.finalStatus > 0) add("http", "http", `HTTP ${i.http.finalStatus}${i.http.chainComplete ? " response" : ", partial redirect chain"}`, `${i.http.chainComplete ? "The request ended at" : "The last response came from"} ${i.http.finalUrl}${i.http.redirectCount ? ` after ${count(i.http.redirectCount, "redirect")}` : ""}.`);
  else fallback("http", "The HTTP response");

  if (i.url.scheme === "http") add("tls", "tls", "The submitted address uses HTTP", "The original URL uses an unencrypted connection. Open Redirects & HTTP to see whether it moved to HTTPS.");
  else if (i.tls) {
    if (take.layer === "tls" && take.tone === "attention") add("tls", "tls", take.title, take.description);
    else add("tls", "tls", i.tls.authorized ? "The certificate check passed" : "A certificate was captured", `${i.tls.hostname}${observedDate(i.tls.validTo) ? `, valid until ${observedDate(i.tls.validTo)}` : ", validity date unavailable"}. Open Certificate for its names and issuer.`);
  } else fallback("tls", "The certificate");

  const groups = groupNetworkAddresses(i.network?.addresses ?? []);
  const known = groups.filter((group) => group.asn);
  const knownAddresses = known.reduce((total, group) => total + group.addresses.length, 0);
  const unknownAddresses = groups.filter((group) => !group.asn).reduce((total, group) => total + group.addresses.length, 0);
  if (known.length) {
    const networks = known.map((group) => `${group.asn}${group.organizations.length ? ` (${shortList(group.organizations, 1)})` : ""}`);
    add("network", "network", `${count(knownAddresses, "address")} in ${known.length === 1 ? "one network" : count(known.length, "network")}`, `${shortList(networks)}.${unknownAddresses ? ` ${count(unknownAddresses, "address")} still ${unknownAddresses === 1 ? "has" : "have"} no ASN detail.` : " Open IP & network for individual addresses and prefixes."}`);
  } else fallback("network", "The network registration");

  const tech = i.technology;
  const guesses = tech?.infrastructure ?? [];
  if (guesses.length) {
    overview.push({ id: "overview-technology", layer: "infrastructure", title: `${shortList(guesses.map((guess) => guess.name))} suggested by response signals`, description: tech?.technologies.length ? `Technology signals: ${shortList(tech.technologies.map((item) => item.name), 3)}. Open the evidence to see why this platform is suggested.` : "Open the response evidence behind this platform suggestion.", confidence: "inferred", evidenceIds: [...new Set(guesses.flatMap((guess) => guess.evidenceIds))].filter((id) => i.evidence.some((item) => item.id === id)) });
  } else if (tech?.technologies.length) add("technology", "technology", `${count(tech.technologies.length, "technology signal")} found`, `${shortList(tech.technologies.map((item) => item.name), 3)} appeared in response headers or HTML.`, tech.technologies.some((item) => item.confidence === "inferred") ? "inferred" : "observed");
  else if (tech) add("technology", "technology", "No recognized technology signal", "You can still explore the response and headers. A framework does not have to identify itself.", "unknown");
  else fallback("technology", "Technology signals");

  // The compact story never introduces a dangling evidence reference.
  const knownIds = new Set(i.evidence.map((item) => item.id));
  return overview.map((item) => ({ ...item, evidenceIds: item.evidenceIds.filter((id) => knownIds.has(id)) }));
}
