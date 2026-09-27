import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import http from 'http';
import https from 'https';
import { log } from './logger';

// Timing data the metrics interceptors stash on each request's config
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    metadata?: {
      startTime: number;
      baseUrl: string;
    };
  }
}

export interface HttpPoolConfig {
  keepAliveTimeout?: number;
  maxSockets?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

/**
 * What one upstream host has been asked and how it answered, counting every
 * attempt — a retried request is two.
 *
 * The counters this replaced could not see a rate limit. The clients resolve
 * every status below 500 as a response (`validateStatus`), and the metrics
 * counted every resolved response as a success — so an OpenAlex answering 429
 * all afternoon showed an error rate of zero. Connection reuse was read from
 * the server's `Connection: keep-alive` header, which says the server would
 * keep the socket open, not that this client used an open one.
 */
export interface HttpPoolMetrics {
  /** Every attempt: answered, failed or aborted. */
  totalRequests: number;
  /** 2xx and 3xx. */
  succeeded: number;
  /** 4xx other than 429: an answer about the request — a 404 is often the right one. */
  clientErrors: number;
  /** 429: the upstream refusing us for asking too often. */
  rateLimited: number;
  /** 5xx, per attempt. */
  serverErrors: number;
  /** No answer at all: a timeout, a refused or reset connection. */
  failed: number;
  /** Cut off by this service's own budget — not the upstream's doing. */
  aborted: number;
  /** Answered on a socket kept open from an earlier request, as Node reports it. */
  reusedConnections: number;
  /** Answered on a socket opened for it. */
  newConnections: number;
  /** Mean time to an answer or a failure, in milliseconds. */
  averageResponseTime: number;
  /**
   * The share of attempts the upstream did not serve: rate limits, server
   * errors and failures. A 4xx is left out — it is an answer, and a 404 for an
   * id nobody holds is the right one — and so is an abort, which is ours.
   */
  errorRate: number;
  lastReset: Date;
}

/** How one attempt ended, as the metrics count it. */
type Outcome =
  | { status: number; reused: boolean | undefined }
  | { failure: 'failed' | 'aborted' };

function emptyMetrics(): HttpPoolMetrics {
  return {
    totalRequests: 0, succeeded: 0, clientErrors: 0, rateLimited: 0, serverErrors: 0,
    failed: 0, aborted: 0, reusedConnections: 0, newConnections: 0,
    averageResponseTime: 0, errorRate: 0, lastReset: new Date()
  };
}

/** Whether Node answered this request on a reused socket. `undefined` off Node's http. */
function reusedSocket(request: unknown): boolean | undefined {
  const reused = (request as { reusedSocket?: unknown } | undefined)?.reusedSocket;
  return typeof reused === 'boolean' ? reused : undefined;
}

export class HttpClientFactory {
  private static instance: HttpClientFactory;
  private clients: Map<string, AxiosInstance> = new Map();
  private metrics: Map<string, HttpPoolMetrics> = new Map();
  private defaultConfig: HttpPoolConfig;

  constructor(config: HttpPoolConfig = {}) {
    this.defaultConfig = {
      keepAliveTimeout: 30000,
      maxSockets: 50,
      timeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000,
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
    // Cache and configure by the full base URL, not just the origin. Several
    // services live under a path (NCBI's /entrez/eutils, OpenAIRE's /search),
    // and normalizing that away made axios resolve every request against the
    // bare host — a silent 404 on each call. Metrics stay keyed by host.
    if (this.clients.has(baseUrl)) {
      return this.clients.get(baseUrl)!;
    }

    const config = { ...this.defaultConfig, ...customConfig };
    const client = this.createPooledClient(baseUrl, config);

    this.clients.set(baseUrl, client);

    // Only when the host is new. Two base URLs on one host — a second endpoint
    // under a different path, which OpenAlex and NCBI are each one change away
    // from — share a metrics key, so initialising unconditionally would zero
    // the first client's counters the moment the second was built.
    const metricsKey = this.normalizeUrl(baseUrl);
    if (!this.metrics.has(metricsKey)) {
      this.initializeMetrics(metricsKey);
    }

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
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Configure connection pooling
    this.configureConnectionPooling(client, config);

    // Metrics before retries. Response interceptors run in the order they were
    // added, so this one sees each attempt before the retry logic decides to
    // make another — and each retry comes back through it as an attempt of its
    // own. Added after, it also saw the retried result on the way out, and a
    // request retried once was counted three times.
    this.addMetricsTracking(client, baseUrl);

    // Add retry logic
    this.configureRetryLogic(client, config);

    return client;
  }

  /**
   * Configure connection pooling for the HTTP client
   */
  private configureConnectionPooling(client: AxiosInstance, config: HttpPoolConfig): void {
    // Configure the underlying HTTP agent for connection pooling
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
               ((error.response?.status ?? 0) >= 500);
      },
      // `_error` is skipped rather than dropped: it sits between the two
      // parameters this callback does use, so the signature needs it.
      onRetry: (retryCount, _error, requestConfig) => {
        log.debug(`Retrying request (${retryCount}/${config.retryAttempts}): ${requestConfig.url}`);
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
        this.updateMetrics(normalizedUrl, response.config.metadata?.startTime, {
          status: response.status,
          reused: reusedSocket(response.request)
        });
        return response;
      },
      (error) => {
        const outcome: Outcome = error.response
          ? { status: error.response.status, reused: reusedSocket(error.response.request) }
          : { failure: axios.isCancel(error) ? 'aborted' : 'failed' };
        this.updateMetrics(normalizedUrl, error.config?.metadata?.startTime, outcome);
        return Promise.reject(error);
      }
    );
  }

  /** Counts one attempt. */
  private updateMetrics(baseUrl: string, startTime: number | undefined, outcome: Outcome): void {
    const metrics = this.metrics.get(baseUrl);
    if (!metrics) return;

    metrics.totalRequests++;

    if ('status' in outcome) {
      const { status, reused } = outcome;
      if (status < 400) metrics.succeeded++;
      else if (status === 429) metrics.rateLimited++;
      else if (status < 500) metrics.clientErrors++;
      else metrics.serverErrors++;

      if (reused === true) metrics.reusedConnections++;
      else if (reused === false) metrics.newConnections++;
    } else if (outcome.failure === 'aborted') {
      metrics.aborted++;
    } else {
      metrics.failed++;
    }

    const unserved = metrics.rateLimited + metrics.serverErrors + metrics.failed;
    metrics.errorRate = unserved / metrics.totalRequests;

    if (startTime !== undefined) {
      const elapsed = Date.now() - startTime;
      metrics.averageResponseTime += (elapsed - metrics.averageResponseTime) / metrics.totalRequests;
    }
  }

  private initializeMetrics(baseUrl: string): void {
    this.metrics.set(baseUrl, emptyMetrics());
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
  getMetrics(baseUrl: string): HttpPoolMetrics | null;
  getMetrics(): Map<string, HttpPoolMetrics>;
  getMetrics(baseUrl?: string): Map<string, HttpPoolMetrics> | HttpPoolMetrics | null {
    if (baseUrl) {
      return this.metrics.get(this.normalizeUrl(baseUrl)) || null;
    }
    return this.metrics;
  }

  /**
   * Reset metrics for a specific client or all clients.
   *
   * There are two key spaces here and they are not the same: `clients` is keyed
   * by the **full** base URL, because several services live under a path and
   * normalising that away made axios resolve every request against the bare
   * host; `metrics` is keyed by the **normalised** origin. Every write goes
   * through `normalizeUrl`, and the reset-all branch below did not — it fed
   * `initializeMetrics` the raw client keys, so the eight of thirteen services
   * whose base URL carries a path (NCBI's /entrez/eutils, OpenAIRE's /search,
   * CORE's /v3, DataCite's /dois, arXiv's /api/query, PLOS's /search, Europe
   * PMC's, DOAJ's /api) ended up with entries under a key `updateMetrics` never
   * looks up. Its `if (!metrics) return` then dropped every subsequent
   * measurement for them, silently and permanently.
   */
  resetMetrics(baseUrl?: string): void {
    if (baseUrl) {
      const normalizedUrl = this.normalizeUrl(baseUrl);
      if (this.metrics.has(normalizedUrl)) this.initializeMetrics(normalizedUrl);
    } else {
      this.metrics.clear();
      // Reinitialised under the same key the recording path writes to.
      for (const [url] of this.clients) {
        this.initializeMetrics(this.normalizeUrl(url));
      }
    }
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
        log.error(`Error closing connections for ${url}:`, error);
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
