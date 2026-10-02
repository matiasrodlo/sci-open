import { fetchPage, OpenAlexUnavailableError } from '../../providers/openalex/fetch';
import type { OpenAlexPayload } from '../../providers/openalex/fetch';

/**
 * The DOI lookup, which is a filter and not a search.
 *
 * The old client's `getWorkByDOI` called `searchWorks({ doi })`, which builds
 * `search=doi:10.…` — a full-text search for the literal string. That returns
 * whatever loosely matches, so a DOI query could come back with a different
 * paper, which was then merged in beside the correct one as its peer.
 * `filter=doi:…` is an exact match: measured 2026-08-30 on
 * `10.1038/srep09811`, `meta.count` is **1**.
 *
 * It is also ten times cheaper, which matters against a daily budget a
 * comparison sweep can already exhaust. OpenAlex prices the two differently
 * and says so in `meta.cost_usd`: the filter lookup cost **$0.0001**, and the
 * `search` form is billed at **$0.001** — measured back to back, the second
 * one refused for want of the $0.001 the first had left in the budget.
 *
 * The request itself is the search provider's, unchanged. Sharing it is
 * deliberate: the two roles ask the same endpoint for the same fields, and a
 * second copy of the select list is a second thing to keep correct.
 */

export type FetchOptions = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export { OpenAlexUnavailableError };
export type { OpenAlexPayload };

export async function lookupDoi(doi: string, options: FetchOptions): Promise<OpenAlexPayload | null> {
  const payload = await fetchPage(
    { filter: `doi:${doi.toLowerCase()}` },
    { ...options, pageSize: 1, offset: 0 }
  );

  return (payload.results ?? []).length > 0 ? payload : null;
}
