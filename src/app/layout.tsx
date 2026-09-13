import type { Viewport } from "next";
import { BASE_PATH, IS_BROWSER_EDITION } from "@/lib/edition";
import { createSiteMetadata } from "@/lib/site-metadata";
import "./globals.css";
import "./insights.css";
import "./editions.css";

export const metadata = createSiteMetadata({
  browserEdition: IS_BROWSER_EDITION,
  basePath: BASE_PATH,
  siteOrigin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://manishh-13.github.io",
});
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f7fa", colorScheme: "light dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
