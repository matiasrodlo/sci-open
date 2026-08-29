import { CacheManager, CacheStrategy } from './cache-manager';
import { SearchParams, SearchResponse } from '@open-access-explorer/shared';
import { createHash } from 'crypto';

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
   * Invalidate search cache by query pattern
   */
  async invalidateSearchCache(query: string): Promise<void> {
    const pattern = `search:${this.hashQuery(query)}`;
    await this.cacheManager.invalidatePattern(pattern);
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
    const normalizedQuery = this.normalizeQuery(query);
    const keyData = {
      q: normalizedQuery,
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance',
      filters: this.normalizeFilters(params.filters)
    };
    
    return this.cacheManager.generateKey('search', JSON.stringify(keyData));
  }

  /**
   * Generate cache key for partial results
   */
  private generatePartialKey(baseQuery: string, params: SearchParams, similarity: number): string {
    const keyData = {
      baseQuery,
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance',
      filters: this.normalizeFilters(params.filters),
      similarity: Math.round(similarity * 100) / 100
    };
    
    return this.cacheManager.generateKey('partial', JSON.stringify(keyData));
  }

  /**
   * Generate cache key for facets
   */
  private generateFacetsKey(query: string, params: SearchParams): string {
    const normalizedQuery = this.normalizeQuery(query);
    const keyData = {
      q: normalizedQuery,
      filters: this.normalizeFilters(params.filters)
    };
    
    return this.cacheManager.generateKey('facets', JSON.stringify(keyData));
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

  /**
   * Hash query for consistent key generation
   */
  private hashQuery(query: string): string {
    return createHash('md5').update(query).digest('hex');
  }

}
