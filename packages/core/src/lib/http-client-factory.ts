import axios, { AxiosError, AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import http from 'http';
import https from 'https';
import { log } from './logger';
import { costOf, recordUpstream } from './upstream-usage';

/**
 * The most of one upstream answer any pooled client will read.
 *
 * axios's Node default is no limit at all, so a provider or authority answering
 * with a runaway body — a misbehaving server, a proxy error page that never
 * ends — was buffered whole in this process. The largest page any source sends
 * the fan-out, measured on 2026-10-01, is an OpenAlex page of 200 works at
 * 9.3 MB; Europe PMC's thousand full records are 7.2 MB and PubMed's efetch of
 * two hundred 1.6 MB. 64 MB leaves room for an unusually long page and still
 * bounds what one request can cost.
 */
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

export interface HttpPoolConfig {
  keepAliveTimeout?: number;
  maxSockets?: number;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

export class HttpClientFactory {
  private clients: Map<string, AxiosInstance> = new Map();
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

  /**
   * Get or create a pooled HTTP client for a specific base URL
   */
  getClient(baseUrl: string, customConfig?: Partial<HttpPoolConfig>): AxiosInstance {
    // Cache and configure by the full base URL, not just the origin. Several
    // services live under a path (NCBI's /entrez/eutils, OpenAIRE's /search),
    // and normalizing that away made axios resolve every request against the
    // bare host — a silent 404 on each call.
    if (this.clients.has(baseUrl)) {
      return this.clients.get(baseUrl)!;
    }

    const config = { ...this.defaultConfig, ...customConfig };
    const client = this.createPooledClient(baseUrl, config);

    this.clients.set(baseUrl, client);
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
      // See `MAX_RESPONSE_BYTES`. A body past it fails the request, which the
      // fan-out reports as that provider's error.
      maxContentLength: MAX_RESPONSE_BYTES,
      validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    });

    // Configure connection pooling
    this.configureConnectionPooling(client, config);

    // Before the retry logic: response interceptors run in the order they
    // were added, so this sees every attempt, a retried one included.
    this.configureUsageCounting(client);

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

  /** Counts every answer, and every request that failed on its way, in
   * `upstream-usage.ts`. A request never sent — refused by its config, or
   * cancelled before it left — is not one. */
  private configureUsageCounting(client: AxiosInstance): void {
    const urlOf = (config: InternalAxiosRequestConfig | undefined) => {
      try {
        return config ? new URL(config.url ?? '', config.baseURL).href : undefined;
      } catch {
        return config?.baseURL;
      }
    };
    client.interceptors.response.use(
      (response: AxiosResponse) => {
        recordUpstream(urlOf(response.config), { status: response.status, costUsd: costOf(response.data) });
        return response;
      },
      (error: AxiosError) => {
        if (error.response || error.request) recordUpstream(urlOf(error.config), { ...(error.response ? { status: error.response.status } : {}) });
        return Promise.reject(error);
      }
    );
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
}

/** One factory per process, so every caller of a base URL shares its pool. */
const shared = new HttpClientFactory();

export function getPooledClient(baseUrl: string, config?: Partial<HttpPoolConfig>): AxiosInstance {
  return shared.getClient(baseUrl, config);
}
