"use client";
export default function ErrorBoundary({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="standalone-error"><span className="eyebrow">AN INTERRUPTED OBSERVATION</span><h1>The picture didn’t develop.</h1><p>The instrument encountered an unexpected problem. Your URL has not been saved.</p><button onClick={reset} className="primary-button">Try again</button></main>;
}
