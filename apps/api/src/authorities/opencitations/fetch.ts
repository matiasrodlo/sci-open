import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';

/**
 * The only I/O in this authority.
 *
 * The base URL the service was configured with is dead. `OPENCITATIONS_BASE`
 * is `https://opencitations.net/index/coci/api/v1`, and both that host and
 * `opencitations.net/index/api/v2` answer **301 Moved Permanently** — measured
 * 2026-08-30. The live endpoint is `api.opencitations.net/index/v2`, which
 * answers 200 in about 1.4s. So the old connector could not have returned a
 * citation for anything, whatever else was wrong with it.
 */

const DEFAULT_BASE_URL = 'https://api.opencitations.net/index/v2';

export type FetchOptions = {
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

/** `[{ "count": "43" }]` — the count is a string. */
export type OpenCitationsPayload = Array<{ count?: string }>;

export async function lookupDoi(
  doi: string,
  options: FetchOptions
): Promise<OpenCitationsPayload | null> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;

  const client = getPooledClient(baseUrl, getServiceConfig('opencitations'));

  // `validateStatus` is no longer set per request: the pooled client already
  // resolves a 4xx rather than throwing, which is what this call wanted and
  // was overriding the default to get.
  const response = await client.get<OpenCitationsPayload>(
    `/citation-count/doi:${encodeURIComponent(doi)}`,
    {
      timeout: timeoutMs,
      headers: { Accept: 'application/json', ...(userAgent ? { 'User-Agent': userAgent } : {}) },
      ...(signal ? { signal } : {})
    }
  );

  if (response.status >= 400) throw new Error(`OpenCitations ${response.status} for ${doi}`);
  return Array.isArray(response.data) ? response.data : null;
}
