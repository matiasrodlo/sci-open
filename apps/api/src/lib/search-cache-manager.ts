import { CacheManager, CacheStrategy } from './cache-manager';
import { SearchParams, SearchResponse } from '@open-access-explorer/shared';

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
   * Get similar cached results
   */
  async getSimilarResults(
    query: string,
    params: SearchParams
  ): Promise<SearchResponse | null> {
    const baseQuery = this.normalizeQuery(query);
    const similarity = this.calculateSimilarity(baseQuery, query);
    
    if (similarity < 0.7) return null;
    
    const partialKey = this.generatePartialKey(baseQuery, params, similarity);
    const cached = await this.cacheManager.get<SearchResponse>(partialKey, CacheStrategy.SEARCH_RESULTS);
    
    return cached ?? null;
  }

  /**
   * Cache search facets separately for better performance
   */
  async cacheFacets(
    query: string,
    params: SearchParams,
    facets: Record<string, any>
  ): Promise<void> {
    const facetsKey = this.generateFacetsKey(query, params);
    await this.cacheManager.set(facetsKey, facets, CacheStrategy.FACETS);
  }

  /**
   * Get cached facets
   */
  async getCachedFacets(
    query: string,
    params: SearchParams
  ): Promise<Record<string, any> | null> {
    const facetsKey = this.generateFacetsKey(query, params);
    return await this.cacheManager.get<Record<string, any>>(facetsKey, CacheStrategy.FACETS);
  }

  /**
   * Every cached page and facet set for one query.
   *
   * The old version hashed the raw query into a pattern and asked the cache to
   * substring-match it against keys that had hashed something else entirely —
   * the whole `{q, page, pageSize, sort, filters}` blob — so it could never
   * match anything. The query is the *subject* of these entries and the page,
   * sort and filters are variants of it, which is the distinction the key
   * layout now carries.
   */
  async invalidateSearchCache(query: string): Promise<number> {
    const subject = this.normalizeQuery(query);
    return (
      (await this.cacheManager.invalidate('search', subject)) +
      (await this.cacheManager.invalidate('facets', subject)) +
      (await this.cacheManager.invalidate('partial', subject))
    );
  }

  /**
   * Generate cache key for search results
   */
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
   * Generate cache key for partial results
   */
  private generatePartialKey(baseQuery: string, params: SearchParams, similarity: number): string {
    return this.cacheManager.generateKey('partial', baseQuery, JSON.stringify({
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance',
      filters: this.normalizeFilters(params.filters),
      similarity: Math.round(similarity * 100) / 100
    }));
  }

  /**
   * Generate cache key for facets
   */
  private generateFacetsKey(query: string, params: SearchParams): string {
    return this.cacheManager.generateKey('facets', this.normalizeQuery(query), JSON.stringify({
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

  /**
   * Calculate query similarity
   */
  private calculateSimilarity(query1: string, query2: string): number {
    const words1 = new Set(query1.split(' '));
    const words2 = new Set(query2.split(' '));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }

}
