// The static shell reuses the shared root layout unchanged, so the hosted and
// local editions cannot drift apart. Everything about this edition that differs
// is decided by pages-app/next.config.mjs and read through src/lib/edition.ts.
export { default, metadata, viewport } from "@/app/layout";
