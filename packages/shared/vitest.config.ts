import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `vitest run --coverage`. This counts only this package's own tests: the
    // API's suites exercise the grammar too, but import the built `dist`, so
    // what they cover does not show here.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
      reporter: ['text-summary', 'json-summary', 'html']
    }
  }
});
