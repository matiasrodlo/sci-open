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
 */
export class SearchCacheManager {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Cache search results with intelligent key generation
   */
  async cacheSearchResults(
    query: string,
    params: SearchParams,
    results: SearchResponse
  ): Promise<void> {
    const cacheKey = this.generateSearchKey(query, params);

    await this.cacheManager.set(
      cacheKey,
      results,
      CacheStrategy.SEARCH_RESULTS
    );
  }

  /**
   * Get cached search results
   */
  async getCachedSearchResults(
    query: string,
    params: SearchParams
  ): Promise<SearchResponse | null> {
    const cacheKey = this.generateSearchKey(query, params);
    const cached = await this.cacheManager.get<SearchResponse>(cacheKey, CacheStrategy.SEARCH_RESULTS);

    return cached ?? null;
  }

  /**
   * The identity of a search. Public because the single-flight guard has to
   * collapse exactly the requests this cache would treat as the same entry —
   * if the two disagreed, concurrent duplicates would slip past the guard and
   * then overwrite each other in the cache.
   */
  keyFor(query: string, params: SearchParams): string {
    return this.generateSearchKey(query, params);
  }

  private generateSearchKey(query: string, params: SearchParams): string {
    // The query is the subject; everything else distinguishes entries about
    // that same subject and travels in the variant.
    return this.cacheManager.generateKey('search', this.normalizeQuery(query), JSON.stringify({
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance',
      filters: this.normalizeFilters(params.filters)
    }));
  }

  /**
   * Normalize search query for consistent caching
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
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
