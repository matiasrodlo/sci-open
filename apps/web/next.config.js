const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone, which apps/web/Dockerfile copies into the runner stage
  output: 'standalone',
  experimental: {
    // Trace from the workspace root so the pnpm-linked @open-access-explorer/*
    // packages are included in the standalone bundle
    outputFileTracingRoot: path.join(__dirname, '../../'),
  },
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000',
    NEXT_PUBLIC_SEARCH_BACKEND: process.env.NEXT_PUBLIC_SEARCH_BACKEND || 'typesense',
  },
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;