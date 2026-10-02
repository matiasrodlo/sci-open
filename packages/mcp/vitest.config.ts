import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Offline by construction: the tools run against a fixture engine, and
    // the live smoke test (scripts/smoke.ts) is a separate, nightly run.
    testTimeout: 10000
  }
});
