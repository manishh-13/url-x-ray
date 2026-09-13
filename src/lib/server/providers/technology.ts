import { inferNetworkInfrastructure } from "@/lib/network-hints";
export { OPERATOR_HINTS } from "@/lib/network-hints";
import type { InfrastructureGuess, Technology, TechnologyData } from "@/lib/types";
import { LIMITS } from "../limits";
import { truncate } from "../redact";
import { type Provider, type ProviderContext } from "../provider";

export interface TechnologyProviderInput {
  /** Already sanitized response headers of the final hop. Cookies are absent. */
  headers: Record<string, string>;
  /** Response HTML, kept in process only. Never serialized to a client. */
  html: string;
  htmlBytes: number;
  htmlTruncated: boolean;
  /** Network facts already recorded, so infrastructure guesses can cite them. */
  networkFacts: { value: string; evidenceId: string }[];
}

export interface TechnologyProviderResult {
  technology: TechnologyData;
}

type Category = Technology["category"];

export interface HeaderRule {
  header: string;
  /** Applied to the header value. Omitted means presence alone is the signal. */
  match?: RegExp;
  name: string;
  category: Category;
  confidence: Technology["confidence"];
  explanation: string;
}

export interface MarkupRule {
  /** A concrete structural marker, not a stylistic guess. */
  marker: RegExp;
  label: string;
  name: string;
  category: Category;
  confidence: Technology["confidence"];
  explanation: string;
}

/**
 * Header rules. Presence of a vendor specific header is direct evidence that the
 * response passed through that software. Cookie headers are deliberately not
 * consulted: they are never read out of a response by this backend.
 */
export const HEADER_RULES: HeaderRule[] = [
  { header: "server", match: /^nginx/i, name: "nginx", category: "Backend", confidence: "observed", explanation: "The Server header names nginx." },
  { header: "server", match: /^apache/i, name: "Apache HTTP Server", category: "Backend", confidence: "observed", explanation: "The Server header names Apache." },
  { header: "server", match: /microsoft-iis/i, name: "Microsoft IIS", category: "Backend", confidence: "observed", explanation: "The Server header names IIS." },
  { header: "server", match: /litespeed/i, name: "LiteSpeed", category: "Backend", confidence: "observed", explanation: "The Server header names LiteSpeed." },
  { header: "server", match: /^caddy/i, name: "Caddy", category: "Backend", confidence: "observed", explanation: "The Server header names Caddy." },
  { header: "server", match: /^envoy/i, name: "Envoy", category: "Infrastructure", confidence: "observed", explanation: "The Server header names Envoy." },
  { header: "server", match: /^gunicorn/i, name: "Gunicorn", category: "Backend", confidence: "observed", explanation: "The Server header names Gunicorn." },
  { header: "server", match: /^uvicorn/i, name: "Uvicorn", category: "Backend", confidence: "observed", explanation: "The Server header names Uvicorn." },
  { header: "server", match: /^cowboy/i, name: "Cowboy", category: "Backend", confidence: "observed", explanation: "The Server header names Cowboy." },
  { header: "x-powered-by", match: /express/i, name: "Express", category: "Backend", confidence: "observed", explanation: "X-Powered-By names Express." },
  { header: "x-powered-by", match: /php/i, name: "PHP", category: "Backend", confidence: "observed", explanation: "X-Powered-By names PHP." },
  { header: "x-powered-by", match: /asp\.net/i, name: "ASP.NET", category: "Backend", confidence: "observed", explanation: "X-Powered-By names ASP.NET." },
  { header: "x-powered-by", match: /next\.js/i, name: "Next.js", category: "Frontend", confidence: "observed", explanation: "X-Powered-By names Next.js." },
  { header: "x-aspnet-version", name: "ASP.NET", category: "Backend", confidence: "observed", explanation: "X-AspNet-Version is emitted by ASP.NET." },
  { header: "x-drupal-cache", name: "Drupal", category: "Backend", confidence: "observed", explanation: "X-Drupal-Cache is emitted by Drupal." },
  { header: "x-shopid", name: "Shopify", category: "Backend", confidence: "observed", explanation: "X-ShopId is emitted by Shopify." },
  { header: "x-shopify-stage", name: "Shopify", category: "Backend", confidence: "observed", explanation: "X-Shopify-Stage is emitted by Shopify." },
  { header: "x-wix-request-id", name: "Wix", category: "Backend", confidence: "observed", explanation: "X-Wix-Request-Id is emitted by Wix." },
  { header: "x-runtime", name: "Ruby on Rails", category: "Backend", confidence: "inferred", explanation: "X-Runtime is a Rails convention, but other stacks can send it." },
  { header: "x-litespeed-cache", name: "LiteSpeed Cache", category: "Backend", confidence: "observed", explanation: "X-LiteSpeed-Cache is emitted by the LiteSpeed cache." },
];

/**
 * Infrastructure rules. These describe the network path rather than the
 * application, so they are reported separately and always cite the header that
 * produced them.
 */
export const INFRASTRUCTURE_HEADER_RULES: HeaderRule[] = [
  { header: "cf-ray", name: "Cloudflare", category: "Infrastructure", confidence: "observed", explanation: "CF-Ray is added by Cloudflare's edge." },
  { header: "cf-cache-status", name: "Cloudflare", category: "Infrastructure", confidence: "observed", explanation: "CF-Cache-Status is added by Cloudflare's edge." },
  { header: "server", match: /^cloudflare/i, name: "Cloudflare", category: "Infrastructure", confidence: "observed", explanation: "The Server header names Cloudflare." },
  { header: "x-amz-cf-id", name: "Amazon CloudFront", category: "Infrastructure", confidence: "observed", explanation: "X-Amz-Cf-Id is added by CloudFront." },
  { header: "via", match: /cloudfront/i, name: "Amazon CloudFront", category: "Infrastructure", confidence: "observed", explanation: "The Via header names CloudFront." },
  { header: "server", match: /amazons3/i, name: "Amazon S3", category: "Infrastructure", confidence: "observed", explanation: "The Server header names Amazon S3." },
  { header: "x-served-by", match: /cache-/i, name: "Fastly", category: "Infrastructure", confidence: "observed", explanation: "X-Served-By carries a Fastly cache node name." },
  { header: "fastly-restarts", name: "Fastly", category: "Infrastructure", confidence: "observed", explanation: "Fastly-Restarts is added by Fastly." },
  { header: "x-fastly-request-id", name: "Fastly", category: "Infrastructure", confidence: "observed", explanation: "X-Fastly-Request-Id is added by Fastly." },
  { header: "server", match: /akamaighost/i, name: "Akamai", category: "Infrastructure", confidence: "observed", explanation: "The Server header names AkamaiGHost." },
  { header: "x-akamai-transformed", name: "Akamai", category: "Infrastructure", confidence: "observed", explanation: "X-Akamai-Transformed is added by Akamai." },
  { header: "x-vercel-id", name: "Vercel", category: "Infrastructure", confidence: "observed", explanation: "X-Vercel-Id is added by Vercel's edge." },
  { header: "x-nf-request-id", name: "Netlify", category: "Infrastructure", confidence: "observed", explanation: "X-NF-Request-Id is added by Netlify." },
  { header: "x-github-request-id", name: "GitHub Pages", category: "Infrastructure", confidence: "observed", explanation: "X-GitHub-Request-Id is added by GitHub Pages." },
  { header: "x-goog-generation", name: "Google Cloud Storage", category: "Infrastructure", confidence: "observed", explanation: "X-Goog-Generation is added by Google Cloud Storage." },
  { header: "server", match: /^google frontend/i, name: "Google Front End", category: "Infrastructure", confidence: "observed", explanation: "The Server header names the Google Front End." },
  { header: "x-azure-ref", name: "Azure Front Door", category: "Infrastructure", confidence: "observed", explanation: "X-Azure-Ref is added by Azure Front Door." },
  { header: "x-sucuri-id", name: "Sucuri", category: "Infrastructure", confidence: "observed", explanation: "X-Sucuri-ID is added by the Sucuri proxy." },
];

/**
 * Markup rules. Every marker is a framework specific hook, script path or
 * generator declaration that only that tool emits. There is no rule that infers
 * a library from generic markup such as a root div, because that would be a
 * guess rather than an observation.
 */
export const MARKUP_RULES: MarkupRule[] = [
  { marker: /<script[^>]+id=["']__NEXT_DATA__["']/i, label: "__NEXT_DATA__ script", name: "Next.js", category: "Frontend", confidence: "observed", explanation: "Next.js serializes its route payload into a script with this id." },
  { marker: /\/_next\/static\//i, label: "/_next/static/ asset path", name: "Next.js", category: "Frontend", confidence: "observed", explanation: "Next.js serves build assets from this path." },
  { marker: /window\.__remixContext/i, label: "__remixContext bootstrap", name: "Remix", category: "Frontend", confidence: "observed", explanation: "Remix serializes its router context into this global." },
  { marker: /\/_nuxt\//i, label: "/_nuxt/ asset path", name: "Nuxt", category: "Frontend", confidence: "observed", explanation: "Nuxt serves build assets from this path." },
  { marker: /data-server-rendered=["']true["']/i, label: "data-server-rendered attribute", name: "Vue", category: "Frontend", confidence: "observed", explanation: "Vue's server renderer marks its mount point with this attribute." },
  { marker: /\sng-version=["'][^"']+["']/i, label: "ng-version attribute", name: "Angular", category: "Frontend", confidence: "observed", explanation: "Angular stamps its version onto the application root element." },
  { marker: /data-reactroot/i, label: "data-reactroot attribute", name: "React", category: "Frontend", confidence: "observed", explanation: "React's server renderer marks its root with this attribute." },
  { marker: /__sveltekit_|data-sveltekit-/i, label: "SvelteKit bootstrap marker", name: "SvelteKit", category: "Frontend", confidence: "observed", explanation: "SvelteKit emits these markers into the document." },
  { marker: /<link[^>]+href=["'][^"']*\/wp-json/i, label: "wp-json link", name: "WordPress", category: "Backend", confidence: "observed", explanation: "WordPress advertises its REST API with this link." },
  { marker: /\/wp-content\//i, label: "/wp-content/ asset path", name: "WordPress", category: "Backend", confidence: "observed", explanation: "WordPress serves themes and uploads from this path." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i, label: "generator meta: WordPress", name: "WordPress", category: "Backend", confidence: "observed", explanation: "The generator meta tag names WordPress." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Drupal/i, label: "generator meta: Drupal", name: "Drupal", category: "Backend", confidence: "observed", explanation: "The generator meta tag names Drupal." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Joomla/i, label: "generator meta: Joomla", name: "Joomla", category: "Backend", confidence: "observed", explanation: "The generator meta tag names Joomla." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Hugo/i, label: "generator meta: Hugo", name: "Hugo", category: "Frontend", confidence: "observed", explanation: "The generator meta tag names Hugo." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Jekyll/i, label: "generator meta: Jekyll", name: "Jekyll", category: "Frontend", confidence: "observed", explanation: "The generator meta tag names Jekyll." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Astro/i, label: "generator meta: Astro", name: "Astro", category: "Frontend", confidence: "observed", explanation: "The generator meta tag names Astro." },
  { marker: /<meta[^>]+name=["']generator["'][^>]+content=["']Docusaurus/i, label: "generator meta: Docusaurus", name: "Docusaurus", category: "Frontend", confidence: "observed", explanation: "The generator meta tag names Docusaurus." },
  { marker: /cdn\.shopify\.com/i, label: "cdn.shopify.com asset host", name: "Shopify", category: "Backend", confidence: "observed", explanation: "Shopify serves storefront assets from this host." },
  { marker: /googletagmanager\.com\/gtm\.js/i, label: "Google Tag Manager script", name: "Google Tag Manager", category: "Analytics", confidence: "observed", explanation: "The document references the Tag Manager loader." },
  { marker: /googletagmanager\.com\/gtag\/js|google-analytics\.com\/analytics\.js/i, label: "Google Analytics script", name: "Google Analytics", category: "Analytics", confidence: "observed", explanation: "The document references a Google Analytics loader." },
  { marker: /plausible\.io\/js\//i, label: "Plausible script", name: "Plausible", category: "Analytics", confidence: "observed", explanation: "The document references the Plausible script." },
  { marker: /cdn\.segment\.com/i, label: "Segment script", name: "Segment", category: "Analytics", confidence: "observed", explanation: "The document references the Segment loader." },
  { marker: /static\.hotjar\.com/i, label: "Hotjar script", name: "Hotjar", category: "Analytics", confidence: "observed", explanation: "The document references the Hotjar script." },
  { marker: /matomo\.js|piwik\.js/i, label: "Matomo script", name: "Matomo", category: "Analytics", confidence: "observed", explanation: "The document references the Matomo script." },
  { marker: /js\.stripe\.com/i, label: "Stripe.js script", name: "Stripe", category: "Backend", confidence: "observed", explanation: "The document references Stripe.js." },
];

/**
 * Derive technologies from the response that was actually received.
 *
 * Only two kinds of input are consulted: response header names and values, and
 * structural markers inside the HTML that was already fetched. Nothing is
 * requested, no script is executed, no subresource is loaded, and no detection
 * is emitted without a matching marker. The HTML itself is never returned.
 */
export const technologyProvider: Provider<TechnologyProviderInput, TechnologyProviderResult> = {
  id: "technology",
  label: "Technology",
  timeoutMs: LIMITS.provider.technology,

  async run(context: ProviderContext, input: TechnologyProviderInput) {
    const { evidence } = context;
    const html = input.html.slice(0, LIMITS.maxHtmlBytes);
    const technologies = new Map<string, Technology>();
    const infrastructure = new Map<string, InfrastructureGuess>();

    const addTechnology = (rule: { name: string; category: Category; confidence: Technology["confidence"]; explanation: string }, evidenceId: string) => {
      const existing = technologies.get(rule.name);
      if (existing) {
        if (!existing.evidenceIds.includes(evidenceId)) existing.evidenceIds.push(evidenceId);
        if (existing.confidence === "inferred" && rule.confidence === "observed") existing.confidence = "observed";
        return;
      }
      technologies.set(rule.name, {
        name: rule.name,
        category: rule.category,
        confidence: rule.confidence,
        evidenceIds: [evidenceId],
        explanation: rule.explanation,
      });
    };

    const addInfrastructure = (name: string, explanation: string, evidenceId: string) => {
      const existing = infrastructure.get(name);
      if (existing) {
        if (!existing.evidenceIds.includes(evidenceId)) existing.evidenceIds.push(evidenceId);
        return;
      }
      infrastructure.set(name, { name, confidence: "inferred", evidenceIds: [evidenceId], explanation });
    };

    const headerEvidence = (header: string, value: string): string =>
      evidence.record({
        source: "http",
        kind: "header",
        label: `Response header ${header}`,
        value: truncate(value),
        confidence: "observed",
        explanation: "Read from the final response of the redirect chain.",
      });

    for (const rule of HEADER_RULES) {
      const value = input.headers[rule.header];
      if (value === undefined) continue;
      if (rule.match && !rule.match.test(value)) continue;
      addTechnology(rule, headerEvidence(rule.header, value));
    }

    for (const rule of INFRASTRUCTURE_HEADER_RULES) {
      const value = input.headers[rule.header];
      if (value === undefined) continue;
      if (rule.match && !rule.match.test(value)) continue;
      const id = headerEvidence(rule.header, value);
      addTechnology(rule, id);
      addInfrastructure(rule.name, rule.explanation, id);
    }

    if (html) {
      for (const rule of MARKUP_RULES) {
        if (!rule.marker.test(html)) continue;
        const id = evidence.record({
          source: "technology",
          kind: "markup",
          label: `Structural marker: ${rule.label}`,
          value: rule.label,
          confidence: "observed",
          explanation: "Matched in the HTML that was already retrieved. No script was executed and no subresource was fetched.",
        });
        addTechnology(rule, id);
      }
    }

    for (const hint of inferNetworkInfrastructure(input.networkFacts)) {
      for (const evidenceId of hint.evidenceIds) addInfrastructure(hint.name, hint.explanation, evidenceId);
    }

    const data: TechnologyData = {
      technologies: [...technologies.values()],
      infrastructure: [...infrastructure.values()],
      analyzedBytes: input.htmlBytes,
      truncated: input.htmlTruncated,
    };

    // Truncation is reported even when nothing matched, because it explains why
    // a marker further down the document could not have been seen.
    const truncationNote = input.htmlTruncated
      ? `Markup analysis stopped at ${LIMITS.maxHtmlBytes} bytes, so a marker beyond that point would not be seen.`
      : undefined;

    if (data.technologies.length === 0 && data.infrastructure.length === 0) {
      const nothingFound = input.htmlBytes === 0 && Object.keys(input.headers).length === 0
        ? "There was no response to analyse."
        : "No technology marker was present in the response headers or markup.";
      return {
        status: "complete" as const,
        message: truncationNote ? `${nothingFound} ${truncationNote}` : nothingFound,
        data: { technology: data },
      };
    }
    return { status: "complete" as const, message: truncationNote, data: { technology: data } };
  },
};
