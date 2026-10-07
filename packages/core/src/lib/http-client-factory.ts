import axios, { AxiosError, AxiosInstance, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import http from 'http';
import https from 'https';
import { log } from './logger';
import { recordUpstream } from './upstream-usage';

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

/** What a test may change about a client; the engine's clients take the defaults. */
export type PooledClientOptions = {
  /** Retries after a network error or a 5xx. Three by default. */
  retries?: number;
  /** The first retry's wait, doubled for each one after it, at most ten seconds. One second by default. */
  retryDelayMs?: number;
  /** For a request that sets none of its own. Ten seconds by default. */
  timeoutMs?: number;
};

const KEEP_ALIVE_MS = 30_000;
const MAX_SOCKETS = 50;

/**
 * A client for one base URL: pooled, capped at `MAX_RESPONSE_BYTES`, counted
 * in `upstream-usage.ts`, and retrying a failure that may not recur.
 */
export function createPooledClient(baseUrl: string, options: PooledClientOptions = {}): AxiosInstance {
  const { retries = 3, retryDelayMs = 1000, timeoutMs = 10_000 } = options;

  const agentOptions = {
    keepAlive: true,
    keepAliveMsecs: KEEP_ALIVE_MS,
    maxSockets: MAX_SOCKETS,
    maxFreeSockets: MAX_SOCKETS / 2,
    timeout: timeoutMs
  };
  const client = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    headers: {
      'Connection': 'keep-alive',
      'Keep-Alive': `timeout=${KEEP_ALIVE_MS / 1000}, max=1000`,
    },
    maxRedirects: 5,
    // See `MAX_RESPONSE_BYTES`. A body past it fails the request, which the
    // fan-out reports as that provider's error.
    maxContentLength: MAX_RESPONSE_BYTES,
    validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    httpAgent: new http.Agent(agentOptions),
    httpsAgent: new https.Agent(agentOptions)
  });

  // Before the retry logic: response interceptors run in the order they
  // were added, so this sees every attempt, a retried one included.
  countUsage(client);

  axiosRetry(client, {
    retries,
    retryDelay: (retryCount) => Math.min(retryDelayMs * Math.pow(2, retryCount - 1), 10000),
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
      log.debug(`Retrying request (${retryCount}/${retries}): ${requestConfig.url}`);
    }
  });

  return client;
}

/** Counts every answer, and every request that failed on its way, in
 * `upstream-usage.ts`. A request never sent — refused by its config, or
 * cancelled before it left — is not one. */
function countUsage(client: AxiosInstance): void {
  const urlOf = (config: InternalAxiosRequestConfig | undefined) => {
    try {
      return config ? new URL(config.url ?? '', config.baseURL).href : undefined;
    } catch {
      return config?.baseURL;
    }
  };
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      recordUpstream(urlOf(response.config), { status: response.status });
      return response;
    },
    (error: AxiosError) => {
      if (error.response || error.request) recordUpstream(urlOf(error.config), { ...(error.response ? { status: error.response.status } : {}) });
      return Promise.reject(error);
    }
  );
}

const clients = new Map<string, AxiosInstance>();

/**
 * The process's one client for a base URL, so every caller of it shares its
 * pool.
 *
 * Keyed by the full base URL, not just the origin. Several services live
 * under a path (NCBI's /entrez/eutils, OpenAIRE's /graph/v1), and normalizing
 * that away made axios resolve every request against the bare host — a silent
 * 404 on each call.
 */
export function getPooledClient(baseUrl: string): AxiosInstance {
  let client = clients.get(baseUrl);
  if (!client) clients.set(baseUrl, client = createPooledClient(baseUrl));
  return client;
}
