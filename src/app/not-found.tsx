import Link from "next/link";
export default function NotFound() {
  return <main className="standalone-error"><span className="eyebrow">OUTSIDE THE PICTURE</span><h1>Nothing to observe here.</h1><p>This address doesn’t point to an X-ray. Start with a public URL instead.</p><Link href="/" className="primary-button">Back to the instrument</Link></main>;
}
