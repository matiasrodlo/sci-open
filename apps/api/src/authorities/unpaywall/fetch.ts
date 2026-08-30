import axios from 'axios';
import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { extractContactEmail } from '../../lib/contact-email';

/** The only I/O in this authority. */

const DEFAULT_BASE_URL = 'https://api.unpaywall.org/v2';

/** Unpaywall was asked without the address it requires. */
export class UnpaywallUnidentifiedError extends Error {
  constructor() {
    super('Unpaywall requires a contact address; set UNPAYWALL_EMAIL to a real mailbox');
    this.name = 'UnpaywallUnidentifiedError';
  }
}

export type FetchOptions = {
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type UnpaywallPayload = Record<string, unknown>;

/**
 * Resolves one DOI, or `null` when Unpaywall does not have it.
 *
 * The address is not optional — Unpaywall answers 422 without one — so a
 * missing one throws here rather than producing a page of failed lookups that
 * all look like the service being down. `extractContactEmail` already refuses
 * the shipped placeholder.
 */
export async function lookupDoi(doi: string, options: FetchOptions): Promise<UnpaywallPayload | null> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;

  const email = userAgent ? extractContactEmail(userAgent) : undefined;
  if (!email) throw new UnpaywallUnidentifiedError();

  const client = getPooledClient(baseUrl, getServiceConfig('unpaywall'));

  try {
    const response = await client.get<UnpaywallPayload>(`/${doi}`, {
      params: { email },
      timeout: timeoutMs,
      headers: { Accept: 'application/json', 'User-Agent': userAgent! },
      ...(signal ? { signal } : {})
    });

    if (response.status === 404) return null;
    if (response.status >= 400) throw new Error(`Unpaywall ${response.status} for ${doi}`);

    // A DOI Unpaywall does not know answers 404, but a malformed one answers
    // 200 with an `error` key rather than a record.
    const body = response.data;
    if (!body || typeof body.doi !== 'string') return null;

    return body;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}
