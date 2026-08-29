import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['{lib,components,app}/**/*.test.ts?(x)'],
    testTimeout: 5000
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') }
  }
});
