import axios from 'axios';
import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';

/** The only I/O in this authority. */

const DEFAULT_BASE_URL = 'https://api.crossref.org';

export type FetchOptions = {
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type CrossrefPayload = { message?: unknown };

/**
 * Resolves one DOI, or `null` when Crossref does not have it.
 *
 * A 404 is an answer, not a failure: the DOI is simply not registered with
 * Crossref, which is true of every arXiv-only preprint in a result set. It
 * returns `null` so the report can distinguish "asked and told no" from "the
 * request broke", which the old client could not — it logged both and returned
 * `null` for both.
 */
export async function lookupDoi(doi: string, options: FetchOptions): Promise<CrossrefPayload | null> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('crossref'));

  try {
    const response = await client.get<CrossrefPayload>(`/works/${encodeURIComponent(doi)}`, {
      timeout: timeoutMs,
      headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
      ...(signal ? { signal } : {})
    });

    // The pooled client resolves anything under 500, so a 404 arrives here
    // rather than in the catch.
    if (response.status === 404) return null;
    if (response.status >= 400) {
      throw new Error(`Crossref ${response.status} for ${doi}`);
    }

    return response.data?.message ? response.data : null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}
