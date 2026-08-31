import { HttpPoolConfig } from './http-client-factory';
import { log } from './logger';

/**
 * Pool settings, global and per service.
 *
 * The per-service list is deliberately short: it holds exactly the providers
 * that fetch through `getPooledClient`. CORE and Europe PMC call axios
 * directly, so a `CORE_POOL_CONFIG` or `EUROPE_PMC_POOL_CONFIG` was parsed at
 * startup into a map nothing then queried — they are no longer read, and no
 * longer documented.
 */
const POOLED_SERVICES = [
  'OPENALEX',
  'CROSSREF',
  'UNPAYWALL',
  'DATACITE',
  'NCBI'
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
