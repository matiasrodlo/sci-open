import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Every suite here is offline by construction: normalisers run against
    // committed fixtures and the one function that resolves DNS is tested with
    // the resolver stubbed. A test that needs the network belongs in a separate
    // opt-in suite, not in the gate that runs on every commit.
    testTimeout: 5000,
    // `vitest run --coverage`. Every source file is listed, not only the ones a
    // test imports, so a module nothing exercises reports 0% rather than being
    // left out of the total.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/__fixtures__/**'],
      reporter: ['text-summary', 'json-summary', 'html']
    }
  }
});
