import NodeCache from 'node-cache';
import Redis from 'ioredis';
import { createHash } from 'crypto';

export enum CacheStrategy {
  SEARCH_RESULTS = 'search_results',
  PAPER_DETAILS = 'paper_details',
  API_RESPONSES = 'api_responses',
  FACETS = 'facets',
  METADATA = 'metadata'
}

export interface CacheConfig {
  l1: number;  // TTL in seconds for L1 cache (memory)
  l2: number;  // TTL in seconds for L2 cache (Redis)
  l3: number;  // TTL in seconds for L3 cache (database)
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;
  avgResponseTime: number;
  cacheSize: number;
}

export class CacheManager {
  private l1Cache: NodeCache;
  private l2Cache: Redis;
  private l3Cache: Map<string, any> = new Map(); // Simple in-memory L3 for now
  private metrics: CacheMetrics;
  private strategyConfigs: Map<CacheStrategy, CacheConfig>;

  constructor(redisUrl?: string) {
    // Initialize L1 cache (memory)
    this.l1Cache = new NodeCache({
      stdTTL: 300, // 5 minutes default
      checkperiod: 60,
      useClones: false,
      maxKeys: 10000
    });

    // Initialize L2 cache (Redis)
    this.l2Cache = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000
    });

    // Initialize metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      l1Hits: 0,
      l2Hits: 0,
      l3Hits: 0,
      avgResponseTime: 0,
      cacheSize: 0
    };

    // Initialize strategy configurations
    this.strategyConfigs = new Map([
      [CacheStrategy.SEARCH_RESULTS, { l1: 300, l2: 3600, l3: 86400 }],     // 5min, 1hour, 24hour
      [CacheStrategy.PAPER_DETAILS, { l1: 600, l2: 7200, l3: 604800 }],    // 10min, 2hour, 7day
      [CacheStrategy.API_RESPONSES, { l1: 60, l2: 1800, l3: 7200 }],        // 1min, 30min, 2hour
      [CacheStrategy.FACETS, { l1: 900, l2: 3600, l3: 21600 }],             // 15min, 1hour, 6hour
      [CacheStrategy.METADATA, { l1: 1800, l2: 14400, l3: 86400 }]          // 30min, 4hour, 24hour
    ]);

    // Setup Redis event handlers
    this.l2Cache.on('connect', () => {
      console.log('Redis connected');
    });

    this.l2Cache.on('error', (err) => {
      console.error('Redis error:', err);
    });
  }

  /**
   * Get value from cache with hierarchical fallback
   */
  async get<T>(key: string, strategy: CacheStrategy = CacheStrategy.SEARCH_RESULTS): Promise<T | null> {
    const startTime = Date.now();
    
    try {
      // L1 Cache (Memory) - fastest
      const l1Value = this.l1Cache.get<T>(key);
      if (l1Value !== undefined) {
        this.metrics.l1Hits++;
        this.metrics.hits++;
        this.updateMetrics(startTime);
        return l1Value;
      }

      // L2 Cache (Redis) - fast
      try {
        const l2Value = await this.l2Cache.get(key);
        if (l2Value !== null) {
          const parsedValue = JSON.parse(l2Value);
          
          // Store in L1 cache for faster future access
          const config = this.strategyConfigs.get(strategy)!;
          this.l1Cache.set(key, parsedValue, config.l1);
          
          this.metrics.l2Hits++;
          this.metrics.hits++;
          this.updateMetrics(startTime);
          return parsedValue;
        }
      } catch (redisError) {
        console.warn('Redis cache error, falling back to L3:', redisError);
      }

      // L3 Cache (Database/File) - persistent
      const l3Value = this.l3Cache.get(key);
      if (l3Value !== undefined) {
        // Store in L2 and L1 caches
        const config = this.strategyConfigs.get(strategy)!;
        try {
          await this.l2Cache.setex(key, config.l2, JSON.stringify(l3Value));
        } catch (redisError) {
          console.warn('Failed to store in Redis:', redisError);
        }
        this.l1Cache.set(key, l3Value, config.l1);
        
        this.metrics.l3Hits++;
        this.metrics.hits++;
        this.updateMetrics(startTime);
        return l3Value;
      }

      // Cache miss
      this.metrics.misses++;
      this.updateMetrics(startTime);
      return null;

    } catch (error) {
      console.error('Cache get error:', error);
      this.metrics.misses++;
      this.updateMetrics(startTime);
      return null;
    }
  }

  /**
   * Set value in all cache levels
   */
  async set<T>(key: string, value: T, strategy: CacheStrategy = CacheStrategy.SEARCH_RESULTS): Promise<void> {
    const config = this.strategyConfigs.get(strategy)!;
    
    try {
      // L1 Cache (Memory)
      this.l1Cache.set(key, value, config.l1);
      
      // L2 Cache (Redis)
      try {
        await this.l2Cache.setex(key, config.l2, JSON.stringify(value));
      } catch (redisError) {
        console.warn('Failed to store in Redis:', redisError);
      }
      
      // L3 Cache (Database/File)
      this.l3Cache.set(key, value);
      
      // Cleanup L3 cache if it gets too large
      if (this.l3Cache.size > 50000) {
        this.cleanupL3Cache();
      }
      
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Delete value from all cache levels
   */
  async delete(key: string): Promise<void> {
    try {
      // L1 Cache
      this.l1Cache.del(key);
      
      // L2 Cache
      try {
        await this.l2Cache.del(key);
      } catch (redisError) {
        console.warn('Failed to delete from Redis:', redisError);
      }
      
      // L3 Cache
      this.l3Cache.delete(key);
      
    } catch (error) {
      console.error('Cache delete error:', error);
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      // L1 Cache - get all keys and filter
      const l1Keys = this.l1Cache.keys();
      const matchingL1Keys = l1Keys.filter(key => key.includes(pattern));
      matchingL1Keys.forEach(key => this.l1Cache.del(key));
      
      // L2 Cache - use Redis SCAN
      try {
        const keys = await this.l2Cache.keys(`*${pattern}*`);
        if (keys.length > 0) {
          await this.l2Cache.del(...keys);
        }
      } catch (redisError) {
        console.warn('Failed to invalidate Redis pattern:', redisError);
      }
      
      // L3 Cache
      for (const [key] of this.l3Cache) {
        if (key.includes(pattern)) {
          this.l3Cache.delete(key);
        }
      }
      
    } catch (error) {
      console.error('Cache pattern invalidation error:', error);
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics {
    const totalRequests = this.metrics.hits + this.metrics.misses;
    const hitRate = totalRequests > 0 ? (this.metrics.hits / totalRequests) * 100 : 0;
    
    return {
      ...this.metrics,
      cacheSize: this.l1Cache.getStats().keys + this.l3Cache.size
    };
  }

  /**
   * Clear all caches
   */
  async clear(): Promise<void> {
    try {
      // L1 Cache
      this.l1Cache.flushAll();
      
      // L2 Cache
      try {
        await this.l2Cache.flushdb();
      } catch (redisError) {
        console.warn('Failed to clear Redis:', redisError);
      }
      
      // L3 Cache
      this.l3Cache.clear();
      
      // Reset metrics
      this.metrics = {
        hits: 0,
        misses: 0,
        l1Hits: 0,
        l2Hits: 0,
        l3Hits: 0,
        avgResponseTime: 0,
        cacheSize: 0
      };
      
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Generate cache key with namespace
   */
  generateKey(namespace: string, ...parts: (string | number)[]): string {
    const key = parts.join(':');
    return `${namespace}:${this.hashKey(key)}`;
  }

  /**
   * Hash key for consistent length and security
   */
  private hashKey(key: string): string {
    return createHash('md5').update(key).digest('hex');
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(startTime: number): void {
    const responseTime = Date.now() - startTime;
    const totalRequests = this.metrics.hits + this.metrics.misses;
    
    if (totalRequests > 0) {
      this.metrics.avgResponseTime = 
        (this.metrics.avgResponseTime * (totalRequests - 1) + responseTime) / totalRequests;
    }
  }

  /**
   * Cleanup L3 cache by removing oldest entries
   */
  private cleanupL3Cache(): void {
    const entries = Array.from(this.l3Cache.entries());
    const toRemove = entries.slice(0, Math.floor(entries.length * 0.2)); // Remove 20% oldest
    
    toRemove.forEach(([key]) => {
      this.l3Cache.delete(key);
    });
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    try {
      await this.l2Cache.quit();
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Export singleton instance
export const cacheManager = new CacheManager();
