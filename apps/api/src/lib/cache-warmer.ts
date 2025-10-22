import { CacheManager } from './cache-manager';
import { SearchCacheManager } from './search-cache-manager';
import { PaperCacheManager } from './paper-cache-manager';
import { APICacheManager } from './api-cache-manager';
import { SearchParams, SearchResponse } from '@open-access-explorer/shared';

export interface PopularQuery {
  query: string;
  frequency: number;
  lastUsed: number;
}

export interface TrendingPaper {
  id: string;
  title: string;
  accessCount: number;
  lastAccessed: number;
}

export class CacheWarmer {
  private cacheManager: CacheManager;
  private searchCacheManager: SearchCacheManager;
  private paperCacheManager: PaperCacheManager;
  private apiCacheManager: APICacheManager;
  
  private popularQueries: Map<string, PopularQuery> = new Map();
  private trendingPapers: Map<string, TrendingPaper> = new Map();
  private warmingInProgress: boolean = false;

  constructor(
    cacheManager: CacheManager,
    searchCacheManager: SearchCacheManager,
    paperCacheManager: PaperCacheManager,
    apiCacheManager: APICacheManager
  ) {
    this.cacheManager = cacheManager;
    this.searchCacheManager = searchCacheManager;
    this.paperCacheManager = paperCacheManager;
    this.apiCacheManager = apiCacheManager;
  }

  /**
   * Start cache warming process
   */
  async startWarming(): Promise<void> {
    if (this.warmingInProgress) {
      console.log('Cache warming already in progress');
      return;
    }

    this.warmingInProgress = true;
    console.log('Starting cache warming process...');

    try {
      // Warm popular searches
      await this.warmPopularSearches();
      
      // Warm trending papers
      await this.warmTrendingPapers();
      
      // Warm API health checks
      await this.warmAPIHealthChecks();
      
      // Warm common facets
      await this.warmCommonFacets();
      
      console.log('Cache warming completed successfully');
    } catch (error) {
      console.error('Cache warming failed:', error);
    } finally {
      this.warmingInProgress = false;
    }
  }

  /**
   * Warm popular search queries
   */
  private async warmPopularSearches(): Promise<void> {
    console.log('Warming popular searches...');
    
    const popularQueries = await this.getPopularQueries();
    
    for (const query of popularQueries.slice(0, 20)) { // Warm top 20 queries
      try {
        // Create basic search params for warming
        const params: SearchParams = {
          q: query.query,
          page: 1,
          pageSize: 20,
          sort: 'relevance'
        };
        
        // Check if already cached
        const cached = await this.searchCacheManager.getCachedSearchResults(query.query, params);
        if (cached) {
          console.log(`Query "${query.query}" already cached`);
          continue;
        }
        
        // This would typically call the search pipeline
        // For now, we'll just log the warming attempt
        console.log(`Warming query: "${query.query}"`);
        
        // Simulate search result warming
        await this.simulateSearchWarming(query.query, params);
        
      } catch (error) {
        console.error(`Failed to warm query "${query.query}":`, error);
      }
    }
  }

  /**
   * Warm trending papers
   */
  private async warmTrendingPapers(): Promise<void> {
    console.log('Warming trending papers...');
    
    const trendingPapers = await this.getTrendingPapers();
    
    for (const paper of trendingPapers.slice(0, 50)) { // Warm top 50 papers
      try {
        // Check if already cached
        const cached = await this.paperCacheManager.getCachedPaper(paper.id);
        if (cached) {
          console.log(`Paper "${paper.title}" already cached`);
          continue;
        }
        
        // Simulate paper warming
        await this.simulatePaperWarming(paper.id, paper.title);
        
      } catch (error) {
        console.error(`Failed to warm paper "${paper.title}":`, error);
      }
    }
  }

  /**
   * Warm API health checks
   */
  private async warmAPIHealthChecks(): Promise<void> {
    console.log('Warming API health checks...');
    
    const sources = ['openalex', 'crossref', 'unpaywall', 'core', 'europepmc', 'ncbi'];
    
    for (const source of sources) {
      try {
        // Check if health info is already cached
        const cached = await this.apiCacheManager.getCachedAPIHealth(source);
        if (cached) {
          console.log(`API health for ${source} already cached`);
          continue;
        }
        
        // Simulate API health warming
        await this.simulateAPIHealthWarming(source);
        
      } catch (error) {
        console.error(`Failed to warm API health for ${source}:`, error);
      }
    }
  }

  /**
   * Warm common facets
   */
  private async warmCommonFacets(): Promise<void> {
    console.log('Warming common facets...');
    
    const commonQueries = [
      'machine learning',
      'artificial intelligence',
      'deep learning',
      'neural networks',
      'computer vision',
      'natural language processing',
      'data science',
      'statistics',
      'mathematics',
      'physics'
    ];
    
    for (const query of commonQueries) {
      try {
        const params: SearchParams = {
          q: query,
          page: 1,
          pageSize: 1 // Only need facets, not results
        };
        
        // Check if facets already cached
        const cached = await this.searchCacheManager.getCachedFacets(query, params);
        if (cached) {
          console.log(`Facets for "${query}" already cached`);
          continue;
        }
        
        // Simulate facet warming
        await this.simulateFacetWarming(query, params);
        
      } catch (error) {
        console.error(`Failed to warm facets for "${query}":`, error);
      }
    }
  }

  /**
   * Record query usage for popularity tracking
   */
  async recordQueryUsage(query: string): Promise<void> {
    const normalizedQuery = this.normalizeQuery(query);
    const existing = this.popularQueries.get(normalizedQuery);
    
    if (existing) {
      existing.frequency++;
      existing.lastUsed = Date.now();
    } else {
      this.popularQueries.set(normalizedQuery, {
        query: normalizedQuery,
        frequency: 1,
        lastUsed: Date.now()
      });
    }
    
    // Clean up old queries (older than 30 days)
    this.cleanupOldQueries();
  }

  /**
   * Record paper access for trending tracking
   */
  async recordPaperAccess(paperId: string, title: string): Promise<void> {
    const existing = this.trendingPapers.get(paperId);
    
    if (existing) {
      existing.accessCount++;
      existing.lastAccessed = Date.now();
    } else {
      this.trendingPapers.set(paperId, {
        id: paperId,
        title,
        accessCount: 1,
        lastAccessed: Date.now()
      });
    }
    
    // Clean up old papers (older than 7 days)
    this.cleanupOldPapers();
  }

  /**
   * Get popular queries
   */
  private async getPopularQueries(): Promise<PopularQuery[]> {
    return Array.from(this.popularQueries.values())
      .sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get trending papers
   */
  private async getTrendingPapers(): Promise<TrendingPaper[]> {
    return Array.from(this.trendingPapers.values())
      .sort((a, b) => b.accessCount - a.accessCount);
  }

  /**
   * Simulate search warming (placeholder for actual search pipeline call)
   */
  private async simulateSearchWarming(query: string, params: SearchParams): Promise<void> {
    // In a real implementation, this would call the search pipeline
    console.log(`Simulating search warming for: "${query}"`);
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  /**
   * Simulate paper warming (placeholder for actual paper fetching)
   */
  private async simulatePaperWarming(paperId: string, title: string): Promise<void> {
    // In a real implementation, this would fetch paper details
    console.log(`Simulating paper warming for: "${title}"`);
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  /**
   * Simulate API health warming (placeholder for actual health checks)
   */
  private async simulateAPIHealthWarming(source: string): Promise<void> {
    // In a real implementation, this would check API health
    console.log(`Simulating API health warming for: ${source}`);
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  /**
   * Simulate facet warming (placeholder for actual facet generation)
   */
  private async simulateFacetWarming(query: string, params: SearchParams): Promise<void> {
    // In a real implementation, this would generate facets
    console.log(`Simulating facet warming for: "${query}"`);
    
    // Simulate some delay
    await new Promise(resolve => setTimeout(resolve, 150));
  }

  /**
   * Normalize query for consistent tracking
   */
  private normalizeQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
  }

  /**
   * Clean up old queries
   */
  private cleanupOldQueries(): void {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    for (const [key, query] of this.popularQueries) {
      if (query.lastUsed < thirtyDaysAgo) {
        this.popularQueries.delete(key);
      }
    }
  }

  /**
   * Clean up old papers
   */
  private cleanupOldPapers(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    for (const [key, paper] of this.trendingPapers) {
      if (paper.lastAccessed < sevenDaysAgo) {
        this.trendingPapers.delete(key);
      }
    }
  }

  /**
   * Get warming statistics
   */
  getWarmingStats(): {
    popularQueries: number;
    trendingPapers: number;
    warmingInProgress: boolean;
  } {
    return {
      popularQueries: this.popularQueries.size,
      trendingPapers: this.trendingPapers.size,
      warmingInProgress: this.warmingInProgress
    };
  }
}
