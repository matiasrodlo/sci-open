import { CacheManager, CacheStrategy } from './cache-manager';
import { OARecord } from '@open-access-explorer/shared';
import { createHash } from 'crypto';

export class PaperCacheManager {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Cache paper details with multiple indexing strategies
   */
  async cachePaperDetails(paper: OARecord): Promise<void> {
    // Cache by paper ID
    const paperKey = this.generatePaperKey(paper.id);
    await this.cacheManager.set(paperKey, paper, CacheStrategy.PAPER_DETAILS);
    
    // Cache by DOI for cross-referencing
    if (paper.doi) {
      const doiKey = this.generateDoiKey(paper.doi);
      await this.cacheManager.set(doiKey, paper, CacheStrategy.PAPER_DETAILS);
    }
    
    // Cache by title hash for title-based lookups
    if (paper.title) {
      const titleKey = this.generateTitleKey(paper.title);
      await this.cacheManager.set(titleKey, paper, CacheStrategy.PAPER_DETAILS);
    }
    
    // Cache paper metadata separately for faster access
    const metadata = this.extractMetadata(paper);
    const metadataKey = this.generateMetadataKey(paper.id);
    await this.cacheManager.set(metadataKey, metadata, CacheStrategy.METADATA);
  }

  /**
   * Get cached paper by ID
   */
  async getCachedPaper(paperId: string): Promise<OARecord | null> {
    const paperKey = this.generatePaperKey(paperId);
    return await this.cacheManager.get<OARecord>(paperKey, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Get cached paper by DOI
   */
  async getCachedPaperByDoi(doi: string): Promise<OARecord | null> {
    const doiKey = this.generateDoiKey(doi);
    return await this.cacheManager.get<OARecord>(doiKey, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Get cached paper by title
   */
  async getCachedPaperByTitle(title: string): Promise<OARecord | null> {
    const titleKey = this.generateTitleKey(title);
    return await this.cacheManager.get<OARecord>(titleKey, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Get cached paper metadata
   */
  async getCachedPaperMetadata(paperId: string): Promise<any | null> {
    const metadataKey = this.generateMetadataKey(paperId);
    return await this.cacheManager.get<any>(metadataKey, CacheStrategy.METADATA);
  }

  /**
   * Cache paper relationships (citations, references)
   */
  async cachePaperRelationships(
    paperId: string, 
    relationships: {
      citations?: string[];
      references?: string[];
      related?: string[];
    }
  ): Promise<void> {
    const relationshipsKey = this.generateRelationshipsKey(paperId);
    await this.cacheManager.set(relationshipsKey, relationships, CacheStrategy.METADATA);
  }

  /**
   * Get cached paper relationships
   */
  async getCachedPaperRelationships(paperId: string): Promise<any | null> {
    const relationshipsKey = this.generateRelationshipsKey(paperId);
    return await this.cacheManager.get<any>(relationshipsKey, CacheStrategy.METADATA);
  }

  /**
   * Cache paper enrichment data
   */
  async cachePaperEnrichment(
    paperId: string,
    enrichmentData: {
      crossrefData?: any;
      unpaywallData?: any;
      openalexData?: any;
    }
  ): Promise<void> {
    const enrichmentKey = this.generateEnrichmentKey(paperId);
    await this.cacheManager.set(enrichmentKey, enrichmentData, CacheStrategy.METADATA);
  }

  /**
   * Get cached paper enrichment data
   */
  async getCachedPaperEnrichment(paperId: string): Promise<any | null> {
    const enrichmentKey = this.generateEnrichmentKey(paperId);
    return await this.cacheManager.get<any>(enrichmentKey, CacheStrategy.METADATA);
  }

  /**
   * Invalidate paper cache
   */
  async invalidatePaperCache(paperId: string): Promise<void> {
    const patterns = [
      `paper:${paperId}`,
      `metadata:${paperId}`,
      `relationships:${paperId}`,
      `enrichment:${paperId}`
    ];
    
    for (const pattern of patterns) {
      await this.cacheManager.invalidatePattern(pattern);
    }
  }

  /**
   * Generate cache key for paper
   */
  private generatePaperKey(paperId: string): string {
    return this.cacheManager.generateKey('paper', paperId);
  }

  /**
   * Generate cache key for DOI
   */
  private generateDoiKey(doi: string): string {
    const normalizedDoi = doi.toLowerCase().trim();
    return this.cacheManager.generateKey('doi', normalizedDoi);
  }

  /**
   * Generate cache key for title
   */
  private generateTitleKey(title: string): string {
    const normalizedTitle = this.normalizeTitle(title);
    return this.cacheManager.generateKey('title', normalizedTitle);
  }

  /**
   * Generate cache key for metadata
   */
  private generateMetadataKey(paperId: string): string {
    return this.cacheManager.generateKey('metadata', paperId);
  }

  /**
   * Generate cache key for relationships
   */
  private generateRelationshipsKey(paperId: string): string {
    return this.cacheManager.generateKey('relationships', paperId);
  }

  /**
   * Generate cache key for enrichment data
   */
  private generateEnrichmentKey(paperId: string): string {
    return this.cacheManager.generateKey('enrichment', paperId);
  }

  /**
   * Normalize title for consistent caching
   */
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, '');
  }

  /**
   * Extract essential metadata from paper
   */
  private extractMetadata(paper: OARecord): any {
    return {
      id: paper.id,
      doi: paper.doi,
      title: paper.title,
      authors: paper.authors,
      year: paper.year,
      venue: paper.venue,
      source: paper.source,
      oaStatus: paper.oaStatus,
      citationCount: paper.citationCount,
      createdAt: paper.createdAt
    };
  }
}
