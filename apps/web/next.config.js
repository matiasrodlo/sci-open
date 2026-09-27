const path = require('path');

/**
 * What a page may load, and who may frame it.
 *
 * The site sent no security headers at all. It renders titles, abstracts and
 * links out of provider metadata — deposits written by whoever deposits — so a
 * policy is the second line behind the escaping and the scheme checks in
 * `lib/external-link.ts`, not the first. Nothing is loaded from another origin:
 * the font is self-hosted by `next/font` at build time, and every external
 * address is a link the reader follows, which a policy does not govern.
 *
 * `'unsafe-inline'` on scripts is what Next's App Router needs without a
 * per-request nonce, which would mean middleware on every page. It still rules
 * out every script from elsewhere, `eval` and plugins. Development adds `eval`
 * and the HMR socket, which the dev server needs.
 *
 * Not `/api/*`: the proxy forwards the API's own headers, helmet's among them,
 * and a second policy on a JSON body governs nothing.
 *
 * HSTS is left to whatever terminates TLS — this server never sees HTTPS, and
 * a header promising it would be a claim about a deployment it cannot check.
 */
const development = process.env.NODE_ENV !== 'production';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${development ? ' ws: wss:' : ''}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  // `frame-ancestors` for browsers that predate it.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone, which apps/web/Dockerfile copies into the runner stage
  output: 'standalone',

  // `X-Powered-By: Next.js` tells a visitor nothing and a scanner which
  // advisories to try.
  poweredByHeader: false,

  async headers() {
    return [{ source: '/((?!api/).*)', headers: SECURITY_HEADERS }];
  },

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
