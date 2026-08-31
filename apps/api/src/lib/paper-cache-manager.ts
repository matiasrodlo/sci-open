import { CacheManager, CacheStrategy } from './cache-manager';
import { OARecord } from '@open-access-explorer/shared';

export class PaperCacheManager {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Cache one paper under both keys it can be looked up by.
   *
   * Two copies, because `/api/paper/:id` is reached by either — a `source:id`
   * from a result set, or a bare DOI. Both entries are the whole record, so
   * either route answers without a second fetch.
   *
   * It used to write four. A title-hash copy and a separately extracted
   * metadata blob went out on every detail view, and the methods that read
   * them back had no callers — so two of every four writes were paid for and
   * never collected. They were removed with their readers.
   */
  async cachePaperDetails(paper: OARecord): Promise<void> {
    const paperKey = this.generatePaperKey(paper.id);
    await this.cacheManager.set(paperKey, paper, CacheStrategy.PAPER_DETAILS);

    if (paper.doi) {
      const doiKey = this.generateDoiKey(paper.doi);
      await this.cacheManager.set(doiKey, paper, CacheStrategy.PAPER_DETAILS);
    }
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
}
