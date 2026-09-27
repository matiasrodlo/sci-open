import { MAX_DEPTH } from './orchestrator';
import { DEFAULT_SEARCH_SETTINGS, type SearchSettings } from './orchestrator/from-search-params';
import { DEFAULT_MAX_BYTES as DEFAULT_PROVIDER_CACHE_BYTES } from './orchestrator/provider-cache';
import { DEFAULT_MAX_BYTES as DEFAULT_CACHE_BYTES, DEFAULT_L2_COOLDOWN_MS } from './lib/cache-manager';
import { parseTrustProxy, trustProxyWarning, trustsAnyProxy, type TrustProxySetting } from './lib/trust-proxy';
import { useApiKeys, usableApiKey, type ApiKeys, type KeyedProvider } from './lib/api-key';
import {
  configureHttpPools, DEFAULT_HTTP_POOL, POOLED_SERVICES,
  type HttpPoolSettings, type PooledService
} from './lib/http-pool-config';
import type { HttpPoolConfig } from './lib/http-client-factory';

/**
 * Every setting the API reads, parsed once, at startup.
 *
 * They used to be read where they were used — nine modules, some on every
 * request — each with its own idea of what an unset, empty or malformed value
 * meant: `Number(x) || 120`, `parseInt(x || '20')`, `Number.isFinite(x) && x > 0`.
 * The differences were not cosmetic. `Number('')` is 0, and 0 was the one value
 * `SEARCH_RESCUE_LIMIT` takes to mean "off", so the empty value `env.example`
 * ships switched the rescue off; an unknown `LOG_LEVEL` stopped the server at
 * boot; `HTTP_POOL_MAX_CONNECTIONS` was parsed and applied to nothing.
 *
 * Here one rule holds for all of them. Unset and empty mean the default. A
 * value that does not parse, or is out of range, also means the default — or
 * the nearest value in range, where there is a ceiling — and says so in
 * `warnings`, which the server logs before it starts listening. Nothing here
 * throws: a mistyped setting should cost the operator that setting, not the
 * service.
 */
export type Config = {
  port: number;
  logLevel: LogLevel;
  production: boolean;
  trustProxy: TrustProxySetting;
  /** Who this service says it is to every upstream. See `UNPAYWALL_EMAIL`. */
  userAgent: string;
  adminKey: string | undefined;
  rateLimit: {
    /** Requests per window, per caller, across every route but the download. */
    max: number;
    /** In milliseconds. See `parseWindow`. */
    window: number;
    /** The download's own bucket. See the route in `app.ts`. */
    downloadMax: number;
  };
  redisUrl: string;
  cache: {
    /** L1, in serialised bytes. */
    maxBytes: number;
    /** How long L2 is skipped after Redis fails. */
    redisCooldownMs: number;
    /** The per-provider fan-out cache, in serialised bytes. */
    providerMaxBytes: number;
  };
  search: SearchSettings;
  httpPool: HttpPoolSettings;
  apiKeys: ApiKeys;
};

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
const LOG_LEVELS: readonly LogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const KEYED_PROVIDERS: readonly KeyedProvider[] = ['core', 'ncbi', 'doaj', 'datacite', 'openalex'];

/** The per-service pool settings a `<NAME>_POOL_CONFIG` object may carry. */
const POOL_FIELDS = ['keepAliveTimeout', 'maxSockets', 'timeout', 'retryAttempts', 'retryDelay'] as const;

const poolSetting = (service: PooledService) => `${service.toUpperCase()}_POOL_CONFIG`;

/**
 * The name of every setting `loadConfig` reads.
 *
 * Declared rather than discovered, because two of the ways a setting used to
 * be read were invisible to anything scanning the source for `process.env`: the
 * thirteen `<NAME>_POOL_CONFIG` settings were read under computed names, and
 * `docker-compose.yml` passed none of them. `compose-env.test.ts` checks this
 * list against the compose file.
 */
export const SETTINGS = [
  'PORT', 'NODE_ENV', 'LOG_LEVEL', 'TRUST_PROXY', 'ADMIN_API_KEY', 'UNPAYWALL_EMAIL',
  'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW', 'RATE_LIMIT_DOWNLOAD_MAX',
  'REDIS_URL', 'CACHE_MAX_BYTES', 'CACHE_REDIS_COOLDOWN_MS', 'PROVIDER_CACHE_MAX_BYTES',
  'SEARCH_DEPTH', 'SEARCH_RESCUE_LIMIT', 'SEARCH_RESCUE_BUDGET_MS', 'SEARCH_FACET_COUNTS',
  'HTTP_POOL_KEEP_ALIVE_TIMEOUT', 'HTTP_POOL_MAX_SOCKETS', 'HTTP_POOL_TIMEOUT',
  'HTTP_POOL_RETRY_ATTEMPTS', 'HTTP_POOL_RETRY_DELAY',
  ...POOLED_SERVICES.map(poolSetting),
  ...KEYED_PROVIDERS.map(provider => `${provider.toUpperCase()}_API_KEY`)
] as const;

/**
 * Settings that used to be read and no longer are, with what to do instead.
 * Named here so that one still set says so at startup rather than looking like
 * a knob that works.
 */
const RETIRED: Record<string, string> = {
  HTTP_POOL_MAX_CONNECTIONS: 'nothing applied it; HTTP_POOL_MAX_SOCKETS is the connection cap',
  HTTP_POOL_ENABLE_HTTP2: 'nothing applied it; the upstream clients speak HTTP/1.1'
};

const PLACEHOLDER_EMAIL = 'your-email@example.com';

const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** The shortest window that limits anything: below it a bucket refills between two requests. */
const MIN_RATE_LIMIT_WINDOW_MS = 1000;

const DURATION = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i;

const DURATION_UNITS: Record<string, number> = {
  '': 1, ms: 1, msec: 1, msecs: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000
};

/**
 * `RATE_LIMIT_WINDOW` -> milliseconds, or `undefined` when it names no duration.
 *
 * Parsed here rather than handed to `@fastify/rate-limit` as a string, because
 * the plugin checks nothing. A string it cannot read became an `undefined`
 * window, and the limiter then called it as a function on every request: `one
 * minute` answered 500 on every route but `/health` — which it exempts before
 * reading the window, so a container's health check stayed green through the
 * outage. And a bare number is milliseconds to the plugin, so `60` meant sixty
 * of them: a bucket that refilled between any two requests, which is no limit.
 *
 * A bare number still means milliseconds here — that is what it has always
 * done, and a value that works should keep working — but one under a second is
 * refused with a warning that says why, since nobody sets that on purpose.
 */
export function parseWindow(raw: string): number | undefined {
  const match = raw.trim().match(DURATION);
  if (!match) return undefined;
  const unit = DURATION_UNITS[match[2]!.toLowerCase()];
  return unit === undefined ? undefined : Math.round(Number(match[1]) * unit);
}

type Env = Readonly<Record<string, string | undefined>>;

export type LoadedConfig = { config: Config; warnings: string[] };

export function loadConfig(env: Env = process.env): LoadedConfig {
  const warnings: string[] = [];

  /** The value, trimmed; `undefined` when unset or empty. */
  const text = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value ? value : undefined;
  };

  /**
   * A number of at least `min`, or `fallback` when unset. Out of range or
   * unparseable is `fallback` with a warning; above `max` is `max` with one.
   */
  const number = (name: string, fallback: number, { min = 1, max }: { min?: number; max?: number } = {}): number => {
    const raw = text(name);
    if (raw === undefined) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value) || value < min) {
      warnings.push(`${name}=${raw} is not a number of at least ${min}; using ${fallback}`);
      return fallback;
    }
    if (max !== undefined && value > max) {
      warnings.push(`${name}=${raw} is above the ceiling of ${max}; using ${max}`);
      return max;
    }
    return value;
  };

  const production = env.NODE_ENV === 'production';

  const facetCounts = (): boolean => {
    const raw = text('SEARCH_FACET_COUNTS');
    if (raw === undefined || raw.toLowerCase() === 'on') return true;
    if (raw.toLowerCase() === 'off') return false;
    warnings.push(`SEARCH_FACET_COUNTS=${raw} is neither on nor off; counting across the sources`);
    return true;
  };

  const logLevelRaw = text('LOG_LEVEL');
  const defaultLevel: LogLevel = production ? 'info' : 'debug';
  let logLevel: LogLevel = defaultLevel;
  if (logLevelRaw !== undefined) {
    if ((LOG_LEVELS as readonly string[]).includes(logLevelRaw.toLowerCase())) {
      logLevel = logLevelRaw.toLowerCase() as LogLevel;
    } else {
      warnings.push(`LOG_LEVEL=${logLevelRaw} is not one of ${LOG_LEVELS.join(', ')}; using ${defaultLevel}`);
    }
  }

  // See `lib/trust-proxy.ts`: this decides whether the rate limiter's key is
  // the caller or the proxy in front of them.
  const trustProxyRaw = env.TRUST_PROXY;
  const trustProxy = parseTrustProxy(trustProxyRaw);
  const trustProblem = trustProxyWarning(trustProxyRaw);
  if (trustProblem) {
    warnings.push(trustProblem);
  } else if (!trustsAnyProxy(trustProxy)) {
    warnings.push(
      'TRUST_PROXY is not set: the rate limit is keyed on the connecting address. ' +
      'Behind the web tier that is one shared bucket for every visitor, not one each.'
    );
  }

  const rateLimitWindow = (): number => {
    const raw = text('RATE_LIMIT_WINDOW');
    if (raw === undefined) return DEFAULT_RATE_LIMIT_WINDOW_MS;

    const ms = parseWindow(raw);
    if (ms === undefined) {
      warnings.push(`RATE_LIMIT_WINDOW=${raw} is not a duration like "1 minute" or "30 seconds"; using 1 minute`);
      return DEFAULT_RATE_LIMIT_WINDOW_MS;
    }
    if (ms < MIN_RATE_LIMIT_WINDOW_MS) {
      warnings.push(
        `RATE_LIMIT_WINDOW=${raw} is ${ms} ms — a bare number is milliseconds — which is too short to limit anything; using 1 minute`
      );
      return DEFAULT_RATE_LIMIT_WINDOW_MS;
    }
    return ms;
  };

  const adminKey = text('ADMIN_API_KEY');
  if (!adminKey) warnings.push('ADMIN_API_KEY is not set: the cache and performance endpoints are disabled');

  // OpenAlex and Unpaywall route a caller who identifies themselves into a
  // faster pool, and read the address out of this string. Unpaywall requires
  // one outright.
  const email = text('UNPAYWALL_EMAIL');
  const contact = email && email !== PLACEHOLDER_EMAIL ? email : undefined;
  if (!contact) {
    warnings.push(
      'UNPAYWALL_EMAIL is not set: Unpaywall and OpenAlex are asked anonymously, ' +
      'which Unpaywall refuses and OpenAlex meters more tightly'
    );
  }

  const httpPool: HttpPoolSettings = {
    defaults: {
      keepAliveTimeout: number('HTTP_POOL_KEEP_ALIVE_TIMEOUT', DEFAULT_HTTP_POOL.keepAliveTimeout),
      maxSockets: number('HTTP_POOL_MAX_SOCKETS', DEFAULT_HTTP_POOL.maxSockets),
      timeout: number('HTTP_POOL_TIMEOUT', DEFAULT_HTTP_POOL.timeout),
      retryAttempts: number('HTTP_POOL_RETRY_ATTEMPTS', DEFAULT_HTTP_POOL.retryAttempts, { min: 0 }),
      retryDelay: number('HTTP_POOL_RETRY_DELAY', DEFAULT_HTTP_POOL.retryDelay, { min: 0 })
    },
    services: {}
  };

  for (const service of POOLED_SERVICES) {
    const name = poolSetting(service);
    const raw = text(name);
    if (raw === undefined) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      warnings.push(`${name} is not valid JSON; ${service} uses the global pool settings`);
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push(`${name} is not a JSON object; ${service} uses the global pool settings`);
      continue;
    }

    const overrides: HttpPoolConfig = {};
    for (const [field, value] of Object.entries(parsed)) {
      if (!(POOL_FIELDS as readonly string[]).includes(field)) {
        warnings.push(`${name} sets "${field}", which is not a pool setting (${POOL_FIELDS.join(', ')}); ignored`);
      } else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        warnings.push(`${name} sets "${field}" to ${JSON.stringify(value)}, not a number of at least 0; ignored`);
      } else {
        overrides[field as (typeof POOL_FIELDS)[number]] = value;
      }
    }
    if (Object.keys(overrides).length > 0) httpPool.services[service] = overrides;
  }

  const apiKeys: ApiKeys = {};
  for (const provider of KEYED_PROVIDERS) {
    // `usableApiKey` also drops the `your_…_here` placeholders `env.example`
    // ships, which DataCite answers with a 401 where no key at all is a 200.
    const key = usableApiKey(env[`${provider.toUpperCase()}_API_KEY`]);
    if (key) apiKeys[provider] = key;
  }

  for (const [name, reason] of Object.entries(RETIRED)) {
    if (text(name) !== undefined) warnings.push(`${name} is no longer read (${reason}); remove it`);
  }

  const config: Config = {
    port: number('PORT', 4000, { max: 65535 }),
    logLevel,
    production,
    trustProxy,
    userAgent: `OpenAccessExplorer/1.0 (mailto:${contact ?? PLACEHOLDER_EMAIL})`,
    adminKey,
    rateLimit: {
      max: number('RATE_LIMIT_MAX', 120),
      window: rateLimitWindow(),
      downloadMax: number('RATE_LIMIT_DOWNLOAD_MAX', 20)
    },
    redisUrl: text('REDIS_URL') ?? 'redis://localhost:6379',
    cache: {
      maxBytes: number('CACHE_MAX_BYTES', DEFAULT_CACHE_BYTES),
      redisCooldownMs: number('CACHE_REDIS_COOLDOWN_MS', DEFAULT_L2_COOLDOWN_MS),
      providerMaxBytes: number('PROVIDER_CACHE_MAX_BYTES', DEFAULT_PROVIDER_CACHE_BYTES)
    },
    search: {
      /**
       * How deep each provider is read: the setting that decides how much of a
       * corpus a search sees. **Raise `SEARCH_RESCUE_BUDGET_MS` with it** —
       * depth multiplies the candidates the open-access gate would drop, the
       * rescue budget does not grow to match, and the extra records are then
       * dropped unasked. A depth of zero would ask every provider for nothing,
       * so it is refused like any other value below 1.
       */
      depth: number('SEARCH_DEPTH', DEFAULT_SEARCH_SETTINGS.depth, { max: MAX_DEPTH }),
      /**
       * How many papers the gate would drop are asked about first. Zero is a
       * coherent instruction — do not run the step — so it is allowed here and
       * nowhere else; empty is unset, not zero.
       */
      rescueLimit: number('SEARCH_RESCUE_LIMIT', DEFAULT_SEARCH_SETTINGS.rescueLimit, { min: 0 }),
      /**
       * The setting that actually decides how many candidates are reached: on a
       * broad query this budget expires long before the limit is. Zero would run
       * the step and abort it before any lookup returned, so it is refused.
       */
      rescueBudgetMs: number('SEARCH_RESCUE_BUDGET_MS', DEFAULT_SEARCH_SETTINGS.rescueBudgetMs),
      /**
       * `off` counts every facet over the read, as before the sources were
       * asked for their own counts — which are most of a search's upstream
       * requests, a year facet being ten of them for each source that counts
       * one at a time. Anything else leaves them on.
       */
      facetCounts: facetCounts()
    },
    httpPool,
    apiKeys
  };

  return { config, warnings };
}

/**
 * Hands the settings the upstream clients need to the modules that hold them:
 * the pool settings, which a client keeps from the moment it is built, and the
 * provider keys the registries read. Called once, before the first request —
 * by the server, and by the offline scripts that drive the registries.
 */
export function useConfig(config: Config): void {
  configureHttpPools(config.httpPool);
  useApiKeys(config.apiKeys);
}
