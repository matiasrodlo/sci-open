import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import axiosRetry from 'axios-retry';
import { Http2Session } from 'http2';

export interface HttpPoolConfig {
  maxConnections?: number;
  keepAliveTimeout?: number;
  maxSockets?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  enableHttp2?: boolean;
}

export interface HttpPoolMetrics {
  totalRequests: number;
  reusedConnections: number;
  newConnections: number;
  averageResponseTime: number;
  errorRate: number;
  lastReset: Date;
}

export class HttpClientFactory {
  private static instance: HttpClientFactory;
  private clients: Map<string, AxiosInstance> = new Map();
  private metrics: Map<string, HttpPoolMetrics> = new Map();
  private defaultConfig: HttpPoolConfig;

  constructor(config: HttpPoolConfig = {}) {
    this.defaultConfig = {
      maxConnections: 20,
      keepAliveTimeout: 30000,
      maxSockets: 50,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
      enableHttp2: true,
      ...config
    };
  }

  static getInstance(config?: HttpPoolConfig): HttpClientFactory {
    if (!HttpClientFactory.instance) {
      HttpClientFactory.instance = new HttpClientFactory(config);
    }
    return HttpClientFactory.instance;
  }

  /**
   * Get or create a pooled HTTP client for a specific base URL
   */
  getClient(baseUrl: string, customConfig?: Partial<HttpPoolConfig>): AxiosInstance {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    
    if (this.clients.has(normalizedUrl)) {
      return this.clients.get(normalizedUrl)!;
    }

    const config = { ...this.defaultConfig, ...customConfig };
    const client = this.createPooledClient(normalizedUrl, config);
    
    this.clients.set(normalizedUrl, client);
    this.initializeMetrics(normalizedUrl);
    
    return client;
  }

  /**
   * Create a new HTTP client with connection pooling
   */
  private createPooledClient(baseUrl: string, config: HttpPoolConfig): AxiosInstance {
    const client = axios.create({
      baseURL: baseUrl,
      timeout: config.timeout,
      headers: {
        'Connection': 'keep-alive',
        'Keep-Alive': `timeout=${config.keepAliveTimeout! / 1000}, max=1000`,
      },
      // Enable HTTP/2 if supported
      httpVersion: config.enableHttp2 ? '2' : '1.1',
      // Connection pooling configuration
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Configure connection pooling
    this.configureConnectionPooling(client, config);

    // Add retry logic
    this.configureRetryLogic(client, config);

    // Add metrics tracking
    this.addMetricsTracking(client, baseUrl);

    return client;
  }

  /**
   * Configure connection pooling for the HTTP client
   */
  private configureConnectionPooling(client: AxiosInstance, config: HttpPoolConfig): void {
    // Configure the underlying HTTP agent for connection pooling
    const https = require('https');
    const http = require('http');
    
    const agentConfig = {
      keepAlive: true,
      keepAliveMsecs: config.keepAliveTimeout,
      maxSockets: config.maxSockets,
      maxFreeSockets: Math.floor(config.maxSockets! / 2),
      timeout: config.timeout,
    };

    // Create HTTP and HTTPS agents with pooling
    const httpAgent = new http.Agent(agentConfig);
    const httpsAgent = new https.Agent(agentConfig);

    // Configure the axios instance to use our agents
    client.defaults.httpAgent = httpAgent;
    client.defaults.httpsAgent = httpsAgent;
  }

  /**
   * Configure retry logic for failed requests
   */
  private configureRetryLogic(client: AxiosInstance, config: HttpPoolConfig): void {
    axiosRetry(client, {
      retries: config.retryAttempts,
      retryDelay: (retryCount) => {
        return Math.min(config.retryDelay! * Math.pow(2, retryCount - 1), 10000);
      },
      retryCondition: (error) => {
        // Retry on network errors, timeouts, and 5xx errors
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.code === 'ECONNRESET') ||
               (error.code === 'ETIMEDOUT') ||
               (error.response?.status >= 500);
      },
      onRetry: (retryCount, error, requestConfig) => {
        console.log(`Retrying request (${retryCount}/${config.retryAttempts}): ${requestConfig.url}`);
      }
    });
  }

  /**
   * Add metrics tracking to monitor connection reuse
   */
  private addMetricsTracking(client: AxiosInstance, baseUrl: string): void {
    const normalizedUrl = this.normalizeUrl(baseUrl);
    
    // Request interceptor
    client.interceptors.request.use(
      (config) => {
        const startTime = Date.now();
        config.metadata = { startTime, baseUrl: normalizedUrl };
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor
    client.interceptors.response.use(
      (response) => {
        this.updateMetrics(normalizedUrl, response, false);
        return response;
      },
      (error) => {
        this.updateMetrics(normalizedUrl, error.response, true);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Update metrics for a request
   */
  private updateMetrics(baseUrl: string, response: AxiosResponse | undefined, isError: boolean): void {
    const metrics = this.metrics.get(baseUrl);
    if (!metrics) return;

    metrics.totalRequests++;
    if (isError) {
      metrics.errorRate = (metrics.errorRate * (metrics.totalRequests - 1) + 1) / metrics.totalRequests;
    } else {
      metrics.errorRate = (metrics.errorRate * (metrics.totalRequests - 1)) / metrics.totalRequests;
    }

    // Check if connection was reused (simplified heuristic)
    if (response?.headers['connection'] === 'keep-alive') {
      metrics.reusedConnections++;
    } else {
      metrics.newConnections++;
    }

    // Update average response time
    const responseTime = response ? Date.now() - (response.config.metadata?.startTime || 0) : 0;
    metrics.averageResponseTime = (metrics.averageResponseTime * (metrics.totalRequests - 1) + responseTime) / metrics.totalRequests;
  }

  /**
   * Initialize metrics for a base URL
   */
  private initializeMetrics(baseUrl: string): void {
    this.metrics.set(baseUrl, {
      totalRequests: 0,
      reusedConnections: 0,
      newConnections: 0,
      averageResponseTime: 0,
      errorRate: 0,
      lastReset: new Date()
    });
  }

  /**
   * Normalize URL for consistent key generation
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return url;
    }
  }

  /**
   * Get metrics for a specific client
   */
  getMetrics(baseUrl?: string): Map<string, HttpPoolMetrics> | HttpPoolMetrics | null {
    if (baseUrl) {
      return this.metrics.get(this.normalizeUrl(baseUrl)) || null;
    }
    return this.metrics;
  }

  /**
   * Reset metrics for a specific client or all clients
   */
  resetMetrics(baseUrl?: string): void {
    if (baseUrl) {
      const normalizedUrl = this.normalizeUrl(baseUrl);
      const metrics = this.metrics.get(normalizedUrl);
      if (metrics) {
        metrics.totalRequests = 0;
        metrics.reusedConnections = 0;
        metrics.newConnections = 0;
        metrics.averageResponseTime = 0;
        metrics.errorRate = 0;
        metrics.lastReset = new Date();
      }
    } else {
      this.metrics.clear();
      // Reinitialize metrics for existing clients
      for (const [url] of this.clients) {
        this.initializeMetrics(url);
      }
    }
  }

  /**
   * Get connection reuse rate for a specific client
   */
  getConnectionReuseRate(baseUrl: string): number {
    const metrics = this.metrics.get(this.normalizeUrl(baseUrl));
    if (!metrics || metrics.totalRequests === 0) return 0;
    return metrics.reusedConnections / metrics.totalRequests;
  }

  /**
   * Get overall performance metrics
   */
  getOverallMetrics(): {
    totalClients: number;
    totalRequests: number;
    averageConnectionReuse: number;
    averageResponseTime: number;
    averageErrorRate: number;
  } {
    let totalRequests = 0;
    let totalReusedConnections = 0;
    let totalResponseTime = 0;
    let totalErrorRate = 0;
    let clientCount = 0;

    for (const metrics of this.metrics.values()) {
      totalRequests += metrics.totalRequests;
      totalReusedConnections += metrics.reusedConnections;
      totalResponseTime += metrics.averageResponseTime * metrics.totalRequests;
      totalErrorRate += metrics.errorRate;
      clientCount++;
    }

    return {
      totalClients: clientCount,
      totalRequests,
      averageConnectionReuse: totalRequests > 0 ? totalReusedConnections / totalRequests : 0,
      averageResponseTime: totalRequests > 0 ? totalResponseTime / totalRequests : 0,
      averageErrorRate: clientCount > 0 ? totalErrorRate / clientCount : 0
    };
  }

  /**
   * Close all connections and cleanup
   */
  async closeAllConnections(): Promise<void> {
    for (const [url, client] of this.clients) {
      try {
        // Close HTTP agents
        if (client.defaults.httpAgent) {
          client.defaults.httpAgent.destroy();
        }
        if (client.defaults.httpsAgent) {
          client.defaults.httpsAgent.destroy();
        }
      } catch (error) {
        console.error(`Error closing connections for ${url}:`, error);
      }
    }
    
    this.clients.clear();
    this.metrics.clear();
  }
}

// Export singleton instance
export const httpClientFactory = HttpClientFactory.getInstance();

// Export convenience function
export function getPooledClient(baseUrl: string, config?: Partial<HttpPoolConfig>): AxiosInstance {
  return httpClientFactory.getClient(baseUrl, config);
}
