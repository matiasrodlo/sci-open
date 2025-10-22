import { CacheManager, CacheStrategy } from './cache-manager';
import { createHash } from 'crypto';

export interface APICacheConfig {
  source: string;
  ttl: number;
  retryOnError: boolean;
  maxRetries: number;
}

export class APICacheManager {
  private cacheManager: CacheManager;
  private sourceConfigs: Map<string, APICacheConfig>;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
    
    // Initialize source-specific configurations
    this.sourceConfigs = new Map([
      ['openalex', { source: 'openalex', ttl: 3600, retryOnError: true, maxRetries: 3 }],
      ['crossref', { source: 'crossref', ttl: 1800, retryOnError: true, maxRetries: 3 }],
      ['unpaywall', { source: 'unpaywall', ttl: 7200, retryOnError: false, maxRetries: 1 }],
      ['core', { source: 'core', ttl: 1800, retryOnError: true, maxRetries: 2 }],
      ['europepmc', { source: 'europepmc', ttl: 3600, retryOnError: true, maxRetries: 2 }],
      ['ncbi', { source: 'ncbi', ttl: 3600, retryOnError: true, maxRetries: 2 }],
      ['arxiv', { source: 'arxiv', ttl: 7200, retryOnError: false, maxRetries: 1 }],
      ['datacite', { source: 'datacite', ttl: 1800, retryOnError: true, maxRetries: 2 }],
      ['openaire', { source: 'openaire', ttl: 3600, retryOnError: true, maxRetries: 2 }]
    ]);
  }

  /**
   * Cache API response with source-specific configuration
   */
  async cacheAPIResponse(
    source: string,
    endpoint: string,
    params: any,
    response: any,
    error?: any
  ): Promise<void> {
    const cacheKey = this.generateAPIKey(source, endpoint, params);
    const config = this.sourceConfigs.get(source);
    
    if (!config) {
      console.warn(`No cache configuration found for source: ${source}`);
      return;
    }

    // Cache successful responses
    if (!error) {
      await this.cacheManager.set(cacheKey, response, CacheStrategy.API_RESPONSES);
    } else {
      // Cache errors for shorter duration to avoid repeated failures
      const errorKey = this.generateErrorKey(source, endpoint, params);
      await this.cacheManager.set(errorKey, { error: error.message, timestamp: Date.now() }, CacheStrategy.API_RESPONSES);
    }
  }

  /**
   * Get cached API response
   */
  async getCachedAPIResponse(
    source: string,
    endpoint: string,
    params: any
  ): Promise<any | null> {
    const cacheKey = this.generateAPIKey(source, endpoint, params);
    const cached = await this.cacheManager.get<any>(cacheKey, CacheStrategy.API_RESPONSES);
    
    if (cached) {
      return cached;
    }

    // Check for cached errors
    const errorKey = this.generateErrorKey(source, endpoint, params);
    const errorCached = await this.cacheManager.get<any>(errorKey, CacheStrategy.API_RESPONSES);
    
    if (errorCached) {
      const config = this.sourceConfigs.get(source);
      if (config && config.retryOnError) {
        const timeSinceError = Date.now() - errorCached.timestamp;
        const retryDelay = config.ttl * 1000; // Convert to milliseconds
        
        if (timeSinceError > retryDelay) {
          // Error cache expired, allow retry
          await this.cacheManager.delete(errorKey);
          return null;
        }
      }
      
      // Return cached error to avoid repeated API calls
      throw new Error(`Cached API error: ${errorCached.error}`);
    }
    
    return null;
  }

  /**
   * Cache API rate limit information
   */
  async cacheRateLimit(
    source: string,
    rateLimitInfo: {
      limit: number;
      remaining: number;
      resetTime: number;
    }
  ): Promise<void> {
    const rateLimitKey = this.generateRateLimitKey(source);
    await this.cacheManager.set(rateLimitKey, rateLimitInfo, CacheStrategy.API_RESPONSES);
  }

  /**
   * Get cached rate limit information
   */
  async getCachedRateLimit(source: string): Promise<any | null> {
    const rateLimitKey = this.generateRateLimitKey(source);
    return await this.cacheManager.get<any>(rateLimitKey, CacheStrategy.API_RESPONSES);
  }

  /**
   * Cache API health status
   */
  async cacheAPIHealth(
    source: string,
    healthInfo: {
      isHealthy: boolean;
      lastCheck: number;
      responseTime: number;
      errorRate: number;
    }
  ): Promise<void> {
    const healthKey = this.generateHealthKey(source);
    await this.cacheManager.set(healthKey, healthInfo, CacheStrategy.API_RESPONSES);
  }

  /**
   * Get cached API health status
   */
  async getCachedAPIHealth(source: string): Promise<any | null> {
    const healthKey = this.generateHealthKey(source);
    return await this.cacheManager.get<any>(healthKey, CacheStrategy.API_RESPONSES);
  }

  /**
   * Invalidate API cache for specific source
   */
  async invalidateAPICache(source: string): Promise<void> {
    const patterns = [
      `api:${source}:*`,
      `error:${source}:*`,
      `ratelimit:${source}`,
      `health:${source}`
    ];
    
    for (const pattern of patterns) {
      await this.cacheManager.invalidatePattern(pattern);
    }
  }

  /**
   * Invalidate API cache by endpoint
   */
  async invalidateAPIEndpoint(source: string, endpoint: string): Promise<void> {
    const patterns = [
      `api:${source}:${endpoint}:*`,
      `error:${source}:${endpoint}:*`
    ];
    
    for (const pattern of patterns) {
      await this.cacheManager.invalidatePattern(pattern);
    }
  }

  /**
   * Get API cache statistics
   */
  async getAPICacheStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const [source, config] of this.sourceConfigs) {
      const health = await this.getCachedAPIHealth(source);
      const rateLimit = await this.getCachedRateLimit(source);
      
      stats[source] = {
        config,
        health,
        rateLimit,
        lastUpdated: health?.lastCheck || null
      };
    }
    
    return stats;
  }

  /**
   * Generate cache key for API response
   */
  private generateAPIKey(source: string, endpoint: string, params: any): string {
    const normalizedParams = this.normalizeParams(params);
    const paramHash = this.hashParams(normalizedParams);
    return this.cacheManager.generateKey('api', source, endpoint, paramHash);
  }

  /**
   * Generate cache key for API error
   */
  private generateErrorKey(source: string, endpoint: string, params: any): string {
    const normalizedParams = this.normalizeParams(params);
    const paramHash = this.hashParams(normalizedParams);
    return this.cacheManager.generateKey('error', source, endpoint, paramHash);
  }

  /**
   * Generate cache key for rate limit
   */
  private generateRateLimitKey(source: string): string {
    return this.cacheManager.generateKey('ratelimit', source);
  }

  /**
   * Generate cache key for health status
   */
  private generateHealthKey(source: string): string {
    return this.cacheManager.generateKey('health', source);
  }

  /**
   * Normalize parameters for consistent caching
   */
  private normalizeParams(params: any): any {
    if (!params || typeof params !== 'object') {
      return params;
    }
    
    const normalized: any = {};
    
    // Sort object keys for consistent ordering
    Object.keys(params).sort().forEach(key => {
      if (Array.isArray(params[key])) {
        normalized[key] = [...params[key]].sort();
      } else if (typeof params[key] === 'object' && params[key] !== null) {
        normalized[key] = this.normalizeParams(params[key]);
      } else {
        normalized[key] = params[key];
      }
    });
    
    return normalized;
  }

  /**
   * Hash parameters for consistent key generation
   */
  private hashParams(params: any): string {
    const paramString = JSON.stringify(params);
    return createHash('md5').update(paramString).digest('hex');
  }
}
