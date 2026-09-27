import dotenv from 'dotenv';
import path from 'path';

// Load .env from workspace root.
// This package compiles to CommonJS (tsconfig `module: "commonjs"`, no `"type":
// "module"` in package.json), under both `tsx watch` in dev and `node dist` in
// production, so `__dirname` is always defined. It resolves to the workspace
// root from either src/ or dist/, which are at the same depth.
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { loadConfig, useConfig } from './config';
import { buildApp } from './app';
import { CacheManager } from './lib/cache-manager';
import { httpPerformanceMonitor } from './lib/http-performance-monitor';
import { httpClientFactory } from './lib/http-client-factory';
import { gracefulShutdown } from './lib/shutdown';
import { log, useLogger } from './lib/logger';

/**
 * The server: the one place that reads the environment, opens connections and
 * listens. Everything a request does is in `app.ts`, built from what this
 * hands it.
 */

const { config, warnings } = loadConfig();
useConfig(config);

const cache = new CacheManager(config.redisUrl, config.cache.maxBytes, config.cache.redisCooldownMs);
const fastify = buildApp({ config, cache });

// Connectors and pipeline code log through lib/logger, which forwards here.
// Until this runs they stay silent apart from warnings and errors, so nothing
// during module load escapes the configured level.
useLogger(fastify.log);

for (const warning of warnings) fastify.log.warn(warning);

const start = async () => {
  try {
    await fastify.listen({ port: config.port, host: '0.0.0.0' });

    log.info('HTTP performance monitoring started');
    httpPerformanceMonitor.startMonitoring(30000); // 30 second intervals

    // The server drains before anything it uses is released. See `lib/shutdown.ts`.
    const stop = gracefulShutdown(fastify, [
      { name: 'performance monitor', close: () => httpPerformanceMonitor.stopMonitoring() },
      { name: 'upstream connections', close: () => httpClientFactory.closeAllConnections() },
      { name: 'cache', close: () => cache.close() }
    ]);

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, async () => {
        log.info('Shutting down gracefully', { signal });
        await stop();
        process.exit(0);
      });
    }

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
