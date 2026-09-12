import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "URL X-Ray | See what’s behind a URL",
  description: "An evidence-first, interactive map of the publicly observable Internet infrastructure behind a URL. DNS, networks, certificates, redirects, and technologies, explained.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f7fa", colorScheme: "light dark" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light"><body>{children}</body></html>;
}
