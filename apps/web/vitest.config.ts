import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // `tsconfig.json` sets `jsx: "preserve"`, because Next compiles the JSX
  // itself. Vitest does not go through Next, so without this its transform
  // emits classic `React.createElement` calls into files that — correctly, for
  // React 19 — do not import React, and every component test fails on
  // `React is not defined`.
  esbuild: { jsx: 'automatic' },
  test: {
    // Node by default: the two things under test here that are not components
    // — the route handler and the pure modules in `lib/` — want the real
    // platform globals, and `app/api/__tests__/route.test.ts` builds a
    // `NextRequest` out of them. Component files opt into a DOM one per file
    // with `// @vitest-environment jsdom`, so a browser environment is paid for
    // only where it is needed; it costs about 1.7s of startup.
    environment: 'node',
    include: [
      // Bracketed route directories — `app/api/[...path]` — are glob character
      // classes, so a pattern cannot descend into one. Tests for those live
      // beside them rather than inside, and import across the bracket, which is
      // module resolution and not globbing.
      '{lib,components,app}/**/*.test.ts?(x)'
    ],
    testTimeout: 5000
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  }
});
