import axios from 'axios';

/**
 * The only I/O in this provider.
 *
 * It does not catch. The old connector swallowed every failure and returned an
 * empty array, which is why a timeout and a genuinely empty result looked
 * identical from the outside — a provider could vanish from a search with
 * nothing recording that it had been asked. Errors propagate so the
 * orchestrator can turn them into a ProviderReport with a real status.
 *
 * It also owns no timeout of its own. The budget is a parameter because the
 * orchestrator is what knows how long the whole fan-out may take; a constant
 * here competes with that.
 */

const DEFAULT_BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest';

export type FetchOptions = {
  baseUrl?: string;
  /** Records per request. Capped by the caller against `capabilities.maxPageSize`. */
  pageSize: number;
  /** Record offset. Europe PMC pages by 1-based page number, so this lands exactly only on a page boundary. */
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

/** The shape we rely on. Everything else in the payload is passed through untouched. */
export type EuropePmcPayload = {
  hitCount?: number;
  resultList?: { result?: unknown[] };
};

export async function fetchPage(
  nativeQuery: string,
  options: FetchOptions
): Promise<EuropePmcPayload> {
  const { baseUrl = DEFAULT_BASE_URL, pageSize, offset, timeoutMs, signal, userAgent } = options;

  const response = await axios.get<EuropePmcPayload>(`${baseUrl}/search`, {
    params: {
      query: nativeQuery,
      format: 'json',
      pageSize,
      page: Math.floor(Math.max(offset, 0) / Math.max(pageSize, 1)) + 1,
      // `core` is what carries abstracts, keywords, citation counts and the
      // full-text URL list. `lite` omits all of them.
      resultType: 'core',
      sortBy: 'RELEVANCE'
    },
    timeout: timeoutMs,
    ...(signal ? { signal } : {}),
    ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {})
  });

  return response.data ?? {};
}
