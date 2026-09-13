import type { Metadata } from "next";

interface SiteMetadataOptions {
  browserEdition: boolean;
  basePath: string;
  siteOrigin: string;
}

export function createSiteMetadata({ browserEdition, basePath, siteOrigin }: SiteMetadataOptions): Metadata {
  const title = "URL X-Ray | See what’s behind a URL";
  const description = browserEdition
    ? "Explore live DNS records and public network details behind a URL in your browser. Download the local app for certificates, redirects and response technologies."
    : "An evidence-first, interactive map of the publicly observable Internet infrastructure behind a URL. DNS, networks, certificates, redirects, and technologies, explained.";
  const common: Metadata = {
    title,
    description,
    robots: { index: browserEdition, follow: browserEdition },
    icons: { icon: `${basePath}/icon.svg` },
    referrer: "no-referrer",
  };
  if (!browserEdition) return common;

  const canonical = new URL(`${basePath}/`, siteOrigin).href;
  const image = {
    url: new URL(`${basePath}/social-preview.png`, siteOrigin).href,
    width: 1200,
    height: 630,
    alt: "URL X-Ray in its light theme, showing DNS and network evidence from an example.com observation.",
  };
  return {
    ...common,
    metadataBase: new URL(siteOrigin),
    alternates: { canonical },
    openGraph: { type: "website", locale: "en_GB", siteName: "URL X-Ray", title, description, url: canonical, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
