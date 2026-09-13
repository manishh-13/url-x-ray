import type { Metadata, Viewport } from "next";
import { BASE_PATH, IS_BROWSER_EDITION } from "@/lib/edition";
import "./globals.css";
import "./insights.css";
import "./editions.css";

export const metadata: Metadata = {
  title: "URL X-Ray | See what’s behind a URL",
  description: IS_BROWSER_EDITION
    ? "Explore live DNS records and public network details behind a URL in your browser. Download the local app for certificates, redirects and response technologies."
    : "An evidence-first, interactive map of the publicly observable Internet infrastructure behind a URL. DNS, networks, certificates, redirects, and technologies, explained.",
  // The hosted edition is a public tool, so it may be indexed. The local app is
  // only reachable on one machine, and stays out of any index either way.
  robots: IS_BROWSER_EDITION ? { index: true, follow: true } : { index: false, follow: false },
  icons: { icon: `${BASE_PATH}/icon.svg` },
  referrer: "no-referrer",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f7fa", colorScheme: "light dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
