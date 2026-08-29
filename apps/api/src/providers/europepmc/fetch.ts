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

/**
 * Europe PMC answered, but not with a search response.
 *
 * Observed live on 2026-08-29: HTTP 200, and a body of `{"version":"6.9"}`
 * entire — no `hitCount`, no `resultList` — for every query including
 * `cancer`. Read as a payload that is simply empty, which is what happened
 * before this check existed, it becomes `retrieved: 0` with `status: 'ok'` and
 * `complete: true`: a degraded provider presented as a query that matched
 * nothing.
 *
 * That is the exact symptom phase 01 recorded — Europe PMC returning 0 records
 * on one run and 600 on the next, with nothing in the response telling the two
 * apart — and the reason `ProviderReport` carries a status at all. A real
 * empty result set still reports `hitCount: 0`, so it is not caught here.
 */
export class EuropePmcUnavailableError extends Error {
  constructor(detail: string) {
    super(`Europe PMC returned no search response: ${detail}`);
    this.name = 'EuropePmcUnavailableError';
  }
}

/**
 * Whether a 200 actually carried a result page.
 *
 * Deliberately permissive: either field is enough. The point is to separate a
 * response that answered the question from one that did not, not to police the
 * schema.
 */
export function assertSearchResponse(payload: EuropePmcPayload): void {
  if (typeof payload?.hitCount === 'number') return;
  if (payload?.resultList !== undefined) return;

  const keys = Object.keys(payload ?? {});
  throw new EuropePmcUnavailableError(
    keys.length > 0 ? `body carried only ${keys.join(', ')}` : 'an empty body'
  );
}

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

  const payload = response.data ?? {};
  assertSearchResponse(payload);
  return payload;
}
