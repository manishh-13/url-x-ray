import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { XRayApp } from "@/components/xray-app";

type Props = { params: Promise<{ hostname: string }> };
function validHostname(hostname: string) {
  return hostname.length <= 253 && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(hostname) && hostname.includes(".") && !hostname.includes("..");
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { hostname } = await params;
  if (!validHostname(hostname)) return { title: "URL X-Ray" };
  return { title: `${hostname} | URL X-Ray`, description: `Start a fresh observation of the public infrastructure behind ${hostname}. No saved findings are implied.`, robots: { index: false, follow: false } };
}
export default async function HostnamePage({ params }: Props) {
  const { hostname } = await params;
  if (!validHostname(hostname)) notFound();
  return <XRayApp initialHostname={hostname.toLowerCase()} />;
}
