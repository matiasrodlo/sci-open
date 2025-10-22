import { HttpPoolConfig } from './http-client-factory';

export interface HttpPoolEnvironmentConfig {
  // Connection pool settings
  HTTP_POOL_MAX_CONNECTIONS?: string;
  HTTP_POOL_KEEP_ALIVE_TIMEOUT?: string;
  HTTP_POOL_MAX_SOCKETS?: string;
  HTTP_POOL_TIMEOUT?: string;
  
  // Retry settings
  HTTP_POOL_RETRY_ATTEMPTS?: string;
  HTTP_POOL_RETRY_DELAY?: string;
  
  // HTTP/2 settings
  HTTP_POOL_ENABLE_HTTP2?: string;
  
  // Per-service configurations
  OPENALEX_POOL_CONFIG?: string;
  CROSSREF_POOL_CONFIG?: string;
  UNPAYWALL_POOL_CONFIG?: string;
  CORE_POOL_CONFIG?: string;
  DATACITE_POOL_CONFIG?: string;
  NCBI_POOL_CONFIG?: string;
  EUROPE_PMC_POOL_CONFIG?: string;
}

export class HttpPoolConfigManager {
  private static instance: HttpPoolConfigManager;
  private defaultConfig: HttpPoolConfig;
  private serviceConfigs: Map<string, HttpPoolConfig> = new Map();

  constructor() {
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
    const services = [
      'OPENALEX', 'CROSSREF', 'UNPAYWALL', 'CORE', 
      'DATACITE', 'NCBI', 'EUROPE_PMC'
    ];

    for (const service of services) {
      const configKey = `${service}_POOL_CONFIG`;
      const configValue = process.env[configKey];
      
      if (configValue) {
        try {
          const serviceConfig = JSON.parse(configValue);
          this.serviceConfigs.set(service.toLowerCase(), serviceConfig);
        } catch (error) {
          console.warn(`Invalid ${configKey} configuration:`, error);
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

  /**
   * Get default configuration
   */
  getDefaultConfig(): HttpPoolConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Get optimized configuration for high-volume services
   */
  getHighVolumeConfig(): HttpPoolConfig {
    return {
      ...this.defaultConfig,
      maxConnections: Math.max(this.defaultConfig.maxConnections!, 30),
      maxSockets: Math.max(this.defaultConfig.maxSockets!, 100),
      keepAliveTimeout: Math.max(this.defaultConfig.keepAliveTimeout!, 60000),
    };
  }

  /**
   * Get optimized configuration for low-latency services
   */
  getLowLatencyConfig(): HttpPoolConfig {
    return {
      ...this.defaultConfig,
      timeout: Math.min(this.defaultConfig.timeout!, 5000),
      retryAttempts: Math.min(this.defaultConfig.retryAttempts!, 2),
      retryDelay: Math.min(this.defaultConfig.retryDelay!, 500),
    };
  }

  /**
   * Get configuration for batch operations
   */
  getBatchConfig(): HttpPoolConfig {
    return {
      ...this.defaultConfig,
      maxConnections: Math.max(this.defaultConfig.maxConnections!, 50),
      maxSockets: Math.max(this.defaultConfig.maxSockets!, 200),
      keepAliveTimeout: Math.max(this.defaultConfig.keepAliveTimeout!, 120000),
      timeout: Math.max(this.defaultConfig.timeout!, 30000),
    };
  }

  /**
   * Validate configuration
   */
  validateConfig(config: HttpPoolConfig): string[] {
    const errors: string[] = [];

    if (config.maxConnections && config.maxConnections < 1) {
      errors.push('maxConnections must be at least 1');
    }

    if (config.maxSockets && config.maxSockets < config.maxConnections!) {
      errors.push('maxSockets must be greater than or equal to maxConnections');
    }

    if (config.keepAliveTimeout && config.keepAliveTimeout < 1000) {
      errors.push('keepAliveTimeout must be at least 1000ms');
    }

    if (config.timeout && config.timeout < 1000) {
      errors.push('timeout must be at least 1000ms');
    }

    if (config.retryAttempts && (config.retryAttempts < 0 || config.retryAttempts > 10)) {
      errors.push('retryAttempts must be between 0 and 10');
    }

    if (config.retryDelay && config.retryDelay < 100) {
      errors.push('retryDelay must be at least 100ms');
    }

    return errors;
  }

  /**
   * Get configuration summary for logging
   */
  getConfigSummary(): {
    default: HttpPoolConfig;
    services: Record<string, HttpPoolConfig>;
    validation: string[];
  } {
    const validation = this.validateConfig(this.defaultConfig);
    
    const services: Record<string, HttpPoolConfig> = {};
    for (const [service, config] of this.serviceConfigs) {
      services[service] = config;
    }

    return {
      default: this.defaultConfig,
      services,
      validation
    };
  }
}

// Export singleton instance
export const httpPoolConfigManager = HttpPoolConfigManager.getInstance();

// Export convenience functions
export function getServiceConfig(serviceName: string): HttpPoolConfig {
  return httpPoolConfigManager.getServiceConfig(serviceName);
}

export function getDefaultConfig(): HttpPoolConfig {
  return httpPoolConfigManager.getDefaultConfig();
}

export function getHighVolumeConfig(): HttpPoolConfig {
  return httpPoolConfigManager.getHighVolumeConfig();
}

export function getLowLatencyConfig(): HttpPoolConfig {
  return httpPoolConfigManager.getLowLatencyConfig();
}

export function getBatchConfig(): HttpPoolConfig {
  return httpPoolConfigManager.getBatchConfig();
}
