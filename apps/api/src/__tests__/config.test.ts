import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig, useConfig, SETTINGS } from '../config';
import { MAX_DEPTH } from '../orchestrator';
import { DEFAULT_SEARCH_SETTINGS } from '../orchestrator/from-search-params';
import { getServiceConfig, DEFAULT_HTTP_POOL } from '../lib/http-pool-config';
import { apiKeyFor } from '../lib/api-key';

/**
 * One rule for every setting: unset and empty are the default, and a value
 * that does not parse or is out of range is the default — or the nearest value
 * in range — with a warning. These are the cases where the per-module parsers
 * this replaced disagreed with each other, or with themselves.
 */

/** An environment with the three startup notices answered, so a test sees only its own warnings. */
const quiet = { TRUST_PROXY: 'loopback', ADMIN_API_KEY: 'k', UNPAYWALL_EMAIL: 'ops@example.org' };
const load = (env: Record<string, string> = {}) => loadConfig({ ...quiet, ...env });

afterEach(() => {
  // `useConfig` sets module state the registries read; put the defaults back.
  useConfig(loadConfig({}).config);
});

describe('loadConfig', () => {
  it('uses the documented defaults for an empty environment', () => {
    const { config } = loadConfig({});

    expect(config.port).toBe(4000);
    expect(config.logLevel).toBe('debug');
    expect(config.production).toBe(false);
    expect(config.rateLimit).toEqual({ max: 120, window: 60_000, downloadMax: 20 });
    expect(config.redisUrl).toBe('redis://localhost:6379');
    expect(config.search).toEqual(DEFAULT_SEARCH_SETTINGS);
    expect(config.httpPool).toEqual({ defaults: DEFAULT_HTTP_POOL, services: {} });
    expect(config.apiKeys).toEqual({});
    expect(config.userAgent).toBe('OpenAccessExplorer/1.0 (mailto:your-email@example.com)');
  });

  it('says at startup what an empty environment leaves undone', () => {
    const { warnings } = loadConfig({});
    expect(warnings.join('\n')).toMatch(/TRUST_PROXY is not set/);
    expect(warnings.join('\n')).toMatch(/ADMIN_API_KEY is not set/);
    expect(warnings.join('\n')).toMatch(/UNPAYWALL_EMAIL is not set/);
    expect(load().warnings).toEqual([]);
  });

  it('reads an empty value as unset, not as zero', () => {
    // `Number('')` is 0, the one value the rescue limit takes to mean "off" —
    // which is what the empty value `env.example` ships used to do.
    const { config, warnings } = load({ SEARCH_RESCUE_LIMIT: '', RATE_LIMIT_MAX: '  ' });
    expect(config.search.rescueLimit).toBe(DEFAULT_SEARCH_SETTINGS.rescueLimit);
    expect(config.rateLimit.max).toBe(120);
    expect(warnings).toEqual([]);
  });

  it('lets zero turn the rescue off, and only the rescue', () => {
    const { config, warnings } = load({ SEARCH_RESCUE_LIMIT: '0', SEARCH_RESCUE_BUDGET_MS: '0', RATE_LIMIT_MAX: '0' });
    expect(config.search.rescueLimit).toBe(0);
    expect(config.search.rescueBudgetMs).toBe(DEFAULT_SEARCH_SETTINGS.rescueBudgetMs);
    expect(config.rateLimit.max).toBe(120);
    expect(warnings).toHaveLength(2);
  });

  it('falls back and warns on a value that does not parse', () => {
    const { config, warnings } = load({ SEARCH_DEPTH: 'deep', PORT: '-1' });
    expect(config.search.depth).toBe(DEFAULT_SEARCH_SETTINGS.depth);
    expect(config.port).toBe(4000);
    expect(warnings).toEqual([
      'PORT=-1 is not a number of at least 1; using 4000',
      'SEARCH_DEPTH=deep is not a number of at least 1; using 600'
    ]);
  });

  it('holds a depth above the ceiling at the ceiling, and says so', () => {
    const { config, warnings } = load({ SEARCH_DEPTH: '5000' });
    expect(config.search.depth).toBe(MAX_DEPTH);
    expect(warnings).toEqual([`SEARCH_DEPTH=5000 is above the ceiling of ${MAX_DEPTH}; using ${MAX_DEPTH}`]);
  });

  it('refuses a log level pino does not know, rather than failing to start', () => {
    expect(load({ LOG_LEVEL: 'WARN' }).config.logLevel).toBe('warn');

    const { config, warnings } = load({ LOG_LEVEL: 'verbose', NODE_ENV: 'production' });
    expect(config.logLevel).toBe('info');
    expect(config.production).toBe(true);
    expect(warnings[0]).toMatch(/^LOG_LEVEL=verbose is not one of/);
  });

  it('identifies the service by the configured contact address', () => {
    expect(load().config.userAgent).toBe('OpenAccessExplorer/1.0 (mailto:ops@example.org)');
    expect(load({ UNPAYWALL_EMAIL: 'your-email@example.com' }).warnings.join()).toMatch(/UNPAYWALL_EMAIL is not set/);
  });

  it('keeps real provider keys and drops the placeholders env.example ships', () => {
    const { config } = load({
      OPENALEX_API_KEY: '  real-key  ',
      DATACITE_API_KEY: 'your_datacite_api_key_here',
      CORE_API_KEY: ''
    });
    expect(config.apiKeys).toEqual({ openalex: 'real-key' });
  });

  it('merges a service pool over the global one, and names what it ignored', () => {
    const { config, warnings } = load({
      HTTP_POOL_MAX_SOCKETS: '80',
      OPENALEX_POOL_CONFIG: '{"maxSockets": 100, "maxConnections": 30, "timeout": -5}',
      CROSSREF_POOL_CONFIG: '{not json',
      UNPAYWALL_POOL_CONFIG: '[1, 2]'
    });

    expect(config.httpPool.defaults.maxSockets).toBe(80);
    expect(config.httpPool.services).toEqual({ openalex: { maxSockets: 100 } });
    expect(warnings).toEqual([
      expect.stringMatching(/^OPENALEX_POOL_CONFIG sets "maxConnections", which is not a pool setting/),
      expect.stringMatching(/^OPENALEX_POOL_CONFIG sets "timeout" to -5/),
      expect.stringMatching(/^CROSSREF_POOL_CONFIG is not valid JSON/),
      expect.stringMatching(/^UNPAYWALL_POOL_CONFIG is not a JSON object/)
    ]);
  });

  it('says so when a retired setting is still set', () => {
    const { warnings } = load({ HTTP_POOL_MAX_CONNECTIONS: '20', HTTP_POOL_ENABLE_HTTP2: 'true' });
    expect(warnings).toEqual([
      expect.stringMatching(/^HTTP_POOL_MAX_CONNECTIONS is no longer read/),
      expect.stringMatching(/^HTTP_POOL_ENABLE_HTTP2 is no longer read/)
    ]);
  });

  it('turns the whole-index facet counts off only when told to', () => {
    expect(load().config.search.facetCounts).toBe(true);
    expect(load({ SEARCH_FACET_COUNTS: 'OFF' }).config.search.facetCounts).toBe(false);
    const { config, warnings } = load({ SEARCH_FACET_COUNTS: 'sometimes' });
    expect(config.search.facetCounts).toBe(true);
    expect(warnings).toEqual(['SEARCH_FACET_COUNTS=sometimes is neither on nor off; counting across the sources']);
  });

  it('reads the rate-limit window as a duration, and a bare number as milliseconds', () => {
    expect(load({ RATE_LIMIT_WINDOW: '30 seconds' }).config.rateLimit.window).toBe(30_000);
    expect(load({ RATE_LIMIT_WINDOW: '1 hour' }).config.rateLimit.window).toBe(3_600_000);
    expect(load({ RATE_LIMIT_WINDOW: '2m' }).config.rateLimit.window).toBe(120_000);
    expect(load({ RATE_LIMIT_WINDOW: '60000' }).config.rateLimit.window).toBe(60_000);
    expect(load({ RATE_LIMIT_WINDOW: '1 minute' }).warnings).toEqual([]);
  });

  it('refuses a window it cannot read, which used to fail every request', () => {
    // Handed to the limiter as it stood, this became an undefined window that
    // the plugin then called as a function: 500 on every route but /health.
    const { config, warnings } = load({ RATE_LIMIT_WINDOW: 'one minute' });
    expect(config.rateLimit.window).toBe(60_000);
    expect(warnings).toEqual([expect.stringMatching(/^RATE_LIMIT_WINDOW=one minute is not a duration/)]);
  });

  it('refuses a window too short to limit anything, which a bare 60 was', () => {
    const { config, warnings } = load({ RATE_LIMIT_WINDOW: '60' });
    expect(config.rateLimit.window).toBe(60_000);
    expect(warnings).toEqual([expect.stringMatching(/^RATE_LIMIT_WINDOW=60 is 60 ms — a bare number is milliseconds/)]);
  });

  it('warns about a trust setting Fastify cannot honour', () => {
    const { config, warnings } = load({ TRUST_PROXY: '1' });
    expect(config.trustProxy).toBe(false);
    expect(warnings[0]).toMatch(/hop count/);
  });

  it('declares every setting it reads, including the per-service pool ones', () => {
    expect(SETTINGS).toContain('SEARCH_RESCUE_BUDGET_MS');
    expect(SETTINGS).toContain('PLOS_POOL_CONFIG');
    expect(SETTINGS).toContain('OPENALEX_API_KEY');
    expect(new Set(SETTINGS).size).toBe(SETTINGS.length);
  });
});

describe('useConfig', () => {
  it('hands the pool settings and provider keys to the modules that use them', () => {
    const { config } = load({ OPENALEX_POOL_CONFIG: '{"maxSockets": 7}', NCBI_API_KEY: 'ncbi-key' });
    useConfig(config);

    expect(getServiceConfig('openalex').maxSockets).toBe(7);
    expect(getServiceConfig('crossref').maxSockets).toBe(DEFAULT_HTTP_POOL.maxSockets);
    expect(apiKeyFor('ncbi')).toEqual({ apiKey: 'ncbi-key' });
    expect(apiKeyFor('core')).toEqual({});
  });
});
