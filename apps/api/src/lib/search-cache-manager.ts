import { CacheManager, CacheStrategy } from './cache-manager';
import { SearchParams, SearchResponse } from '@open-access-explorer/shared';

/**
 * The response cache for `/api/search`.
 *
 * One entry per `{query, page, pageSize, sort, filters}`, holding the whole
 * `SearchResponse` — facets included. A separate facets namespace used to be
 * written alongside it on every search and read by nobody, which cost a second
 * cache write per request to store a copy of something already in the first.
 *
 * A `getSimilarResults` path also sat in front of this one, looking up a
 * `partial:` key on every primary miss. Nothing in the service ever wrote a
 * `partial:` key, so that lookup was a guaranteed miss — and, on an L1 miss, a
 * guaranteed Redis round trip — in front of every fresh search. Both are gone.
 *
 * **The key is derived from `SearchParams` and nothing else.** Each of these
 * methods used to take the query text as a separate first argument alongside
 * the params it belongs to, and the route passed `params.q || ''`. That is how
 * `params.doi` — a documented field that `runOrchestrator` gives *precedence*
 * over `q` — never reached the key: every `{ doi }` request with no `q` hashed
 * the empty string, so they all collided on one entry and the second caller was
 * served the first caller's paper. The same key feeds the single-flight guard,
 * so two concurrent DOI lookups were also coalesced onto one fan-out and both
 * answered with one of the two works. A subject that is passed in beside the
 * params that decide it is a subject that can disagree with them, so it is not
 * passed in any more.
 */
/**
 * Whether an answer is worth remembering.
 *
 * `complete: false` means a provider failed or timed out, so `total` is a lower
 * bound and whole sources are missing from the hits and the facets. Stored under
 * the same key as a whole answer, one provider's bad minute was served to
 * everyone asking that question for the next hour — and nothing could get past
 * it, because the frontend's retry re-posted the identical request and was
 * answered from that entry.
 *
 * Not storing it costs a repeated fan-out for a query that is failing anyway,
 * and that is cheaper than it reads: `ProviderCache` only stores outcomes that
 * succeeded, so a retry reuses the providers that answered and re-asks only the
 * ones that did not.
 *
 * Exported because the route needs the same answer for the `Cache-Control` it
 * sends — though on a POST that header persuades nobody, so this function is
 * not one half of a defence but the whole of it. See the note at the header
 * itself in `index.ts`.
 *
 * `bounded` is deliberately *not* consulted, though it makes `total` a lower
 * bound just as `complete: false` does. The two are not the same kind of event.
 * A provider's failure is transient and a retry can fix it, which is the whole
 * argument above; a rescue that hit its limit is deterministic — the same query
 * ranks the same candidates and the limit cuts the list at the same place — so
 * declining to store it would repeat a ten-provider fan-out forever to arrive
 * at the identical answer. A broad query is bounded routinely, so this is the
 * difference between a cache and no cache.
 *
 * The one case that blurs is a rescue bounded by its *budget* rather than its
 * limit, which is transient like a provider timeout. It is stored anyway: the
 * cost is a slightly short `total` for five minutes, against a repeated fan-out
 * for every broad search, and the response says `bounded` either way.
 */
export function worthCaching(result: SearchResponse): boolean {
  return result.complete !== false;
}

export class SearchCacheManager {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Cache search results with intelligent key generation.
   *
   * Refuses a degraded answer rather than leaving that to the caller — the
   * store is what owns what it holds, and a rule enforced at one call site is a
   * rule the next call site does not know about. Returns whether it stored
   * anything, so a caller can say so.
   */
  async cacheSearchResults(params: SearchParams, results: SearchResponse): Promise<boolean> {
    if (!worthCaching(results)) return false;

    const cacheKey = this.generateSearchKey(params);

    await this.cacheManager.set(
      cacheKey,
      results,
      CacheStrategy.SEARCH_RESULTS
    );

    return true;
  }

  /**
   * Get cached search results
   */
  async getCachedSearchResults(params: SearchParams): Promise<SearchResponse | null> {
    const cacheKey = this.generateSearchKey(params);
    const cached = await this.cacheManager.get<SearchResponse>(cacheKey, CacheStrategy.SEARCH_RESULTS);

    return cached ?? null;
  }

  /**
   * The identity of a search. Public because the single-flight guard has to
   * collapse exactly the requests this cache would treat as the same entry —
   * if the two disagreed, concurrent duplicates would slip past the guard and
   * then overwrite each other in the cache.
   */
  keyFor(params: SearchParams): string {
    return this.generateSearchKey(params);
  }

  private generateSearchKey(params: SearchParams): string {
    // The query is the subject; everything else distinguishes entries about
    // that same subject and travels in the variant.
    return this.cacheManager.generateKey('search', this.subjectOf(params), JSON.stringify({
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance',
      filters: this.normalizeFilters(params.filters)
    }));
  }

  /**
   * What this request actually searched for.
   *
   * `doi` before `q`, matching `runOrchestrator`, which builds its `Query` from
   * `params.doi ?? params.q ?? ''`. The key has to name whatever the
   * orchestrator was pointed at, or it names something else's results.
   */
  private subjectOf(params: SearchParams): string {
    return this.normalizeQuery(params.doi ?? params.q ?? '');
  }

  /**
   * Case and whitespace only.
   *
   * It used to also strip every character outside `[\w\s]`, and JavaScript's
   * `\w` is ASCII-only — so `TNF-α` and `TNF` both normalised to `tnf`, as did
   * `alpha/beta` and `alphabeta`, and each pair shared one entry. Dropping
   * characters to normalise a key is what makes two questions look like one.
   * Folding case and collapsing runs of whitespace is lossless enough to be
   * safe: two queries that differ only that way really are the same search.
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Normalize filters for consistent caching
   */
  private normalizeFilters(filters?: any): any {
    if (!filters) return {};

    const normalized: any = {};

    // Sort arrays to ensure consistent ordering
    Object.keys(filters).forEach(key => {
      if (Array.isArray(filters[key])) {
        normalized[key] = [...filters[key]].sort();
      } else {
        normalized[key] = filters[key];
      }
    });

    return normalized;
  }
}
