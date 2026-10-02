import type { HttpPoolConfig } from './http-client-factory';

/**
 * Pool settings, global and per service.
 *
 * The list holds exactly the services that fetch through `getPooledClient`, and
 * that is now all of them. It used to hold five of thirteen, and the eight it
 * left out were the search fan-out — the expensive half, and the half that
 * decides how long a search takes. They opened a fresh connection per request,
 * ran without the retry policy, and reported nothing, so
 * `/api/performance/*` described the five cheapest callers and was silent about
 * everything a slow search is actually made of.
 *
 * Adding a service here is what makes `<NAME>_POOL_CONFIG` readable for it; a
 * name absent from the list falls back to the global defaults rather than
 * failing, so the list is about configurability rather than correctness.
 */
export const POOLED_SERVICES = [
  'openalex',
  'crossref',
  'unpaywall',
  'datacite',
  'ncbi',
  'arxiv',
  'biorxiv',
  'core',
  'doaj',
  'europepmc',
  'openaire',
  'opencitations',
  'plos',
  'hal'
] as const;

export type PooledService = (typeof POOLED_SERVICES)[number];

export type HttpPoolSettings = {
  defaults: Required<HttpPoolConfig>;
  services: Partial<Record<PooledService, HttpPoolConfig>>;
};

export const DEFAULT_HTTP_POOL: Required<HttpPoolConfig> = {
  keepAliveTimeout: 30000,
  maxSockets: 50,
  timeout: 10000,
  retryAttempts: 3,
  retryDelay: 1000
};

/**
 * What `getServiceConfig` answers from. The defaults until `configureHttpPools`
 * is handed the parsed settings at startup — see `config.ts` — which has to
 * happen before the first request, because a pooled client keeps the settings
 * it was built with.
 */
let settings: HttpPoolSettings = { defaults: DEFAULT_HTTP_POOL, services: {} };

export function configureHttpPools(next: HttpPoolSettings): void {
  settings = next;
}

export function getServiceConfig(serviceName: string): HttpPoolConfig {
  const service = settings.services[serviceName.toLowerCase() as PooledService];
  return { ...settings.defaults, ...service };
}
