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
    
    // Compress large search results
    const compressedResults = this.compressSearchResults(results);
    
    await this.cacheManager.set(
      cacheKey, 
      compressedResults, 
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
    
    if (cached) {
      return this.decompressSearchResults(cached);
    }
    
    return null;
  }

  /**
   * Cache partial search results for similar queries
   */
  async cachePartialResults(
    baseQuery: string,
    params: SearchParams,
    results: SearchResponse,
    similarity: number
  ): Promise<void> {
    if (similarity < 0.7) return; // Only cache if similarity is high enough
    
    const partialKey = this.generatePartialKey(baseQuery, params, similarity);
    const compressedResults = this.compressSearchResults(results);
    
    await this.cacheManager.set(
      partialKey,
      compressedResults,
      CacheStrategy.SEARCH_RESULTS
    );
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
    
    if (cached) {
      return this.decompressSearchResults(cached);
    }
    
    return null;
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

  /**
   * Compress search results to save memory
   */
  private compressSearchResults(results: SearchResponse): SearchResponse {
    return {
      ...results,
      hits: results.hits.map(hit => ({
        ...hit,
        // Remove large fields that can be reconstructed
        abstract: hit.abstract ? hit.abstract.substring(0, 500) : hit.abstract,
        // Keep only essential metadata
        sourceMetadata: hit.sourceMetadata ? {
          source: hit.sourceMetadata.source,
          latency: hit.sourceMetadata.latency
        } : hit.sourceMetadata
      }))
    };
  }

  /**
   * Decompress search results
   */
  private decompressSearchResults(results: SearchResponse): SearchResponse {
    // Results are already in compressed format, just return as-is
    return results;
  }
}
