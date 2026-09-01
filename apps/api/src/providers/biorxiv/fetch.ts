import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';

/**
 * The only I/O in this provider: a per-DOI lookup against both servers.
 *
 * Both are asked because a DOI belongs to one or the other and the caller has
 * no way to know which. That is two requests, against the ten a keyword scan
 * used to spend.
 */

const DEFAULT_BASE_URL = 'https://api.biorxiv.org';

export const SERVERS = ['biorxiv', 'medrxiv'] as const;
export type BiorxivServer = (typeof SERVERS)[number];

/**
 * Escapes a DOI for use in the path without escaping its slash.
 *
 * `encodeURIComponent` turns `10.1101/2025.10.27.684732` into
 * `10.1101%2F2025...`, which this API answers with 404 — and since one of the
 * two servers legitimately 404s on every lookup, that failure is
 * indistinguishable from "not found" and reads as an empty result. Verified
 * against the live API both ways: the raw slash returns 3 records, the escaped
 * one returns 404.
 */
function encodePath(doi: string): string {
  return doi.split('/').map(encodeURIComponent).join('/');
}

export type FetchOptions = {
  baseUrl?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

/** One server's answer, paired with the server that gave it. */
export type ServerCollection = { server: BiorxivServer; collection: unknown[] };

export async function fetchByDoi(doi: string, options: FetchOptions): Promise<ServerCollection[]> {
  const { baseUrl = DEFAULT_BASE_URL, timeoutMs, signal, userAgent } = options;

  // One client for both servers: they are two paths on one host, so they share
  // a connection pool rather than each opening their own.
  const client = getPooledClient(baseUrl, getServiceConfig('biorxiv'));

  const settled = await Promise.all(
    SERVERS.map(async (server): Promise<ServerCollection> => {
      try {
        const response = await client.get<{ collection?: unknown[] }>(
          `/details/${server}/${encodePath(doi)}`,
          {
            timeout: timeoutMs,
            ...(signal ? { signal } : {}),
            ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {})
          }
        );
        // A DOI that belongs to the other server 404s here, which is the
        // expected outcome for one of the two on every lookup — so it is the
        // common path, not the exceptional one, and the pooled client resolves
        // it rather than throwing. Anything else is a real failure.
        if (response.status === 404) return { server, collection: [] };
        if (response.status >= 400) {
          throw new Error(`bioRxiv ${response.status} from ${server}`);
        }

        return { server, collection: response.data?.collection ?? [] };
      } catch (error: any) {
        // Kept for a client that throws rather than resolves the 404.
        if (error?.response?.status === 404) return { server, collection: [] };
        throw error;
      }
    })
  );

  return settled;
}
