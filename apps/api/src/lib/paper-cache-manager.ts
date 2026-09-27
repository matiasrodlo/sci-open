import { CacheManager, CacheStrategy } from './cache-manager';
import type { Paper } from '@open-access-explorer/shared';

/**
 * Where a paper's details are cached: the `Paper` itself, which both versions
 * of `/api/paper/:id` are answered from.
 *
 * Its own namespace, because the one before it held `OARecord`s. An entry
 * lives in Redis for two hours, so reading the old key after a deploy would
 * hand the new code a record in the old shape — no `sources`, no `fullText` —
 * typed as the new one. A new name makes those entries misses instead, and
 * they expire on their own.
 */
const NAMESPACE = 'paper-v2';

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
   *
   * `id` is the id it was asked for, when that is not `paper.id` — the key
   * `getCachedPaper` will be asked for next time. See `recordFor` in `app.ts`.
   *
   * `partial` is a paper some authority failed or timed out on, and is held
   * for a minute in this process rather than two hours in Redis. Held like a
   * whole one, a passing Unpaywall outage pinned the paper without the copy
   * Unpaywall would have found — and the PDF route, which reads the same
   * entry, answered "no copy is known" — for two hours. Not held at all, a
   * deployment whose authority always fails (no `UNPAYWALL_EMAIL`) would ask
   * the provider again on every view.
   */
  async cachePaperDetails(paper: Paper, options: { partial?: boolean; id?: string } = {}): Promise<void> {
    const paperKey = this.generatePaperKey(options.id ?? paper.id);
    await this.cacheManager.set(
      paperKey,
      paper,
      options.partial ? CacheStrategy.PAPER_DETAILS_PARTIAL : CacheStrategy.PAPER_DETAILS
    );
  }

  /**
   * Get cached paper by ID
   */
  async getCachedPaper(paperId: string): Promise<Paper | null> {
    const paperKey = this.generatePaperKey(paperId);
    return await this.cacheManager.get<Paper>(paperKey, CacheStrategy.PAPER_DETAILS);
  }

  /**
   * Generate cache key for paper
   */
  private generatePaperKey(paperId: string): string {
    return this.cacheManager.generateKey(NAMESPACE, paperId);
  }
}
