#!/usr/bin/env node
/**
 * Serve the exported static shell exactly the way a static host would.
 *
 * This is a preview server for the artifact in pages-app/out, and nothing else:
 * it reads files, it never writes, it has no API route, and it binds 127.0.0.1
 * so the preview is not reachable from the network. It mounts the site under the
 * same base path the export was built with, so a wrong asset prefix shows up
 * here rather than after a deploy.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { basePathFromEnv } from "./base-path.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "pages-app", "out");

const port = Number(process.env.PAGES_PREVIEW_PORT ?? 3100);
const host = "127.0.0.1";
// Validated the same way the export was built, so the preview cannot
// disagree with the artifact about where the site lives.
const basePath = basePathFromEnv();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const send = (response, status, body, type = "text/plain; charset=utf-8", extra = {}) => {
  response.writeHead(status, {
    ...extra,
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  });
  response.end(body);
};

/** Resolve a request path to a file inside out/, or return undefined. */
async function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed percent encoding never names a file in the export.
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;
  const candidate = path.resolve(root, `.${path.posix.normalize(decoded)}`);
  // Path traversal check: the resolved path must stay inside the export.
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return undefined;

  const attempts = decoded.endsWith("/")
    ? [path.join(candidate, "index.html")]
    : [candidate, `${candidate}.html`, path.join(candidate, "index.html")];

  for (const attempt of attempts) {
    try {
      const info = await stat(attempt);
      if (info.isFile()) return attempt;
    } catch {
      // Try the next shape.
    }
  }
  return undefined;
}

const server = createServer(async (request, response) => {
  // A static host serves reads only, so anything else is refused here too. This
  // is what a POST to the local app's API route meets in this edition.
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Only GET and HEAD are served.", "text/plain; charset=utf-8", { allow: "GET, HEAD" });
    return;
  }

  let url;
  try {
    url = new URL(request.url ?? "/", `http://${host}:${port}`);
  } catch {
    send(response, 400, "Malformed request target.");
    return;
  }

  if (basePath && (url.pathname === "/" || url.pathname === "")) {
    response.writeHead(302, { location: `${basePath}/`, "cache-control": "no-store" });
    response.end();
    return;
  }
  if (basePath && !url.pathname.startsWith(`${basePath}/`) && url.pathname !== basePath) {
    send(response, 404, `Not found. This preview serves ${basePath}/ only.`);
    return;
  }

  const relative = basePath ? url.pathname.slice(basePath.length) || "/" : url.pathname;
  const file = await resolveFile(relative);

  if (!file) {
    const notFound = await resolveFile("/404.html");
    if (notFound) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      createReadStream(notFound).pipe(response);
      return;
    }
    send(response, 404, "Not found.");
    return;
  }

  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
});

try {
  await stat(root);
} catch {
  console.error(`No export found at ${root}. Run: npm run build:pages`);
  process.exit(1);
}

server.listen(port, host, () => {
  console.log(`Static shell preview: http://${host}:${port}${basePath}/`);
});
