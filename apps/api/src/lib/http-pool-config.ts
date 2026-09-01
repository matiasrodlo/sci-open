import { HttpPoolConfig } from './http-client-factory';
import { log } from './logger';

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
const POOLED_SERVICES = [
  'OPENALEX',
  'CROSSREF',
  'UNPAYWALL',
  'DATACITE',
  'NCBI',
  'ARXIV',
  'BIORXIV',
  'CORE',
  'DOAJ',
  'EUROPEPMC',
  'OPENAIRE',
  'OPENCITATIONS',
  'PLOS'
] as const;

export class HttpPoolConfigManager {
  private static instance: HttpPoolConfigManager;
  private defaultConfig: HttpPoolConfig;
  private serviceConfigs: Map<string, Partial<HttpPoolConfig>> = new Map();

  private constructor() {
    this.defaultConfig = this.loadDefaultConfig();
    this.loadServiceConfigs();
  }

  static getInstance(): HttpPoolConfigManager {
    if (!HttpPoolConfigManager.instance) {
      HttpPoolConfigManager.instance = new HttpPoolConfigManager();
    }
    return HttpPoolConfigManager.instance;
  }

  /**
   * Load default configuration from environment variables
   */
  private loadDefaultConfig(): HttpPoolConfig {
    return {
      maxConnections: parseInt(process.env.HTTP_POOL_MAX_CONNECTIONS || '20'),
      keepAliveTimeout: parseInt(process.env.HTTP_POOL_KEEP_ALIVE_TIMEOUT || '30000'),
      maxSockets: parseInt(process.env.HTTP_POOL_MAX_SOCKETS || '50'),
      timeout: parseInt(process.env.HTTP_POOL_TIMEOUT || '10000'),
      retryAttempts: parseInt(process.env.HTTP_POOL_RETRY_ATTEMPTS || '3'),
      retryDelay: parseInt(process.env.HTTP_POOL_RETRY_DELAY || '1000'),
      enableHttp2: process.env.HTTP_POOL_ENABLE_HTTP2 !== 'false',
    };
  }

  /**
   * Load service-specific configurations
   */
  private loadServiceConfigs(): void {
    for (const service of POOLED_SERVICES) {
      const configKey = `${service}_POOL_CONFIG`;
      const configValue = process.env[configKey];

      if (configValue) {
        try {
          const serviceConfig = JSON.parse(configValue);
          this.serviceConfigs.set(service.toLowerCase(), serviceConfig);
        } catch (error) {
          log.warn(`Invalid ${configKey} configuration:`, error);
        }
      }
    }
  }

  /**
   * Get configuration for a specific service
   */
  getServiceConfig(serviceName: string): HttpPoolConfig {
    const serviceKey = serviceName.toLowerCase();
    const serviceConfig = this.serviceConfigs.get(serviceKey);

    if (serviceConfig) {
      return { ...this.defaultConfig, ...serviceConfig };
    }

    return this.defaultConfig;
  }
}

const httpPoolConfigManager = HttpPoolConfigManager.getInstance();

export function getServiceConfig(serviceName: string): HttpPoolConfig {
  return httpPoolConfigManager.getServiceConfig(serviceName);
}
