import { CacheManager, CacheStrategy } from './cache-manager';
import { OARecord } from '@open-access-explorer/shared';

export class PaperCacheManager {
  private cacheManager: CacheManager;

  constructor(cacheManager: CacheManager) {
    this.cacheManager = cacheManager;
  }

  /**
   * Cache one paper under the key it is looked up by.
   *
   * It used to write four, then two. The title-hash copy and a separately
   * extracted metadata blob went first, with the readers that never had
   * callers. The DOI copy has now gone the same way: `/api/paper/:id` takes
   * `source:nativeId`, which is what `docs/api.md` documents and the only thing
   * the frontend sends, and the route's DOI probe in front of it was gated on
   * `id.includes('10.')` — true of any arXiv id from 2010 on — so it spent a
   * Redis round trip per request on a key that only a bare DOI could match. A
   * bare DOI is not resolvable here anyway: `splitPaperId` finds no provider
   * prefix and the lookup returns null, so the entry made the endpoint answer
   * 200 while it lived and 404 once it expired. Asking about a DOI is what
   * `POST /api/search` with `{ doi }` is for.
   */
  async cachePaperDetails(paper: OARecord): Promise<void> {
    const paperKey = this.generatePaperKey(paper.id);
    await this.cacheManager.set(paperKey, paper, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Get cached paper by ID
   */
  async getCachedPaper(paperId: string): Promise<OARecord | null> {
    const paperKey = this.generatePaperKey(paperId);
    return await this.cacheManager.get<OARecord>(paperKey, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Generate cache key for paper
   */
  private generatePaperKey(paperId: string): string {
    return this.cacheManager.generateKey('paper', paperId);
  }
}
