const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone, which apps/web/Dockerfile copies into the runner stage
  output: 'standalone',

  // Trace from the workspace root so the pnpm-linked @open-access-explorer/*
  // packages are included in the standalone bundle. Top-level since Next 15;
  // it was `experimental.outputFileTracingRoot` before, and left there it is
  // ignored with a warning rather than applied — which would drop the linked
  // workspace packages out of the standalone output.
  outputFileTracingRoot: path.join(__dirname, '../../'),

  // There was an `env` block here inlining NEXT_PUBLIC_API_BASE, and a
  // `rewrites()` entry pointing /api/:path* at it. Both baked the API origin
  // into the build: `env` through a compile-time substitution, and rewrites
  // through .next/routes-manifest.json, which the build writes with the
  // destination already resolved. Between them the image was pinned to
  // whatever host built it.
  //
  // The rewrite is now a route handler at app/api/[...path]/route.ts, which
  // reads API_ORIGIN per request, and NEXT_PUBLIC_SEARCH_BACKEND is gone
  // because nothing ever read it.
};

module.exports = nextConfig;
