// The static shell reuses the shared landing route unchanged. Which edition is
// running is decided at build time by pages-app/next.config.mjs and read through
// src/lib/edition.ts, so there is no shell-specific interface code here.
export { default } from "@/app/page";
