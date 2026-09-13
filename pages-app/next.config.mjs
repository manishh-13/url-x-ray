import path from "node:path";
import { fileURLToPath } from "node:url";
import { basePathFromEnv } from "../scripts/base-path.mjs";

/**
 * The static shell. This project is a second, tiny Next application whose only
 * pages re-export the shared routes in ../src, so the local app keeps one
 * source of truth for the interface. It builds with `output: "export"`, so it
 * has no server, no API route and no dynamic route: what it emits is a folder
 * of files a static host can serve.
 *
 * This file is .mjs rather than .ts so it can import the shared base path
 * validator as plain ESM, which Next's config transpile step does not resolve.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const basePath = basePathFromEnv();

/** @type {import("next").NextConfig} */
const config = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
  // Shared code lives outside this directory, so the bundler root is the
  // repository, not pages-app. Dependencies resolve from the root node_modules.
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  devIndicators: false,
  images: { unoptimized: true },
  // Compiled in, so the shared components can tell which edition they are
  // running in without reading anything at runtime.
  env: {
    NEXT_PUBLIC_XRAY_EDITION: "browser",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default config;
