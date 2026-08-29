import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Every suite here is offline by construction: normalisers run against
    // committed fixtures and the one function that resolves DNS is tested with
    // the resolver stubbed. A test that needs the network belongs in a separate
    // opt-in suite, not in the gate that runs on every commit.
    testTimeout: 5000
  }
});
