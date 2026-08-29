/**
 * SALVAGED — ranking logic from the deleted `apps/api/src/lib/search-pipeline.ts`.
 *
 * Source: `git show 56817406:apps/api/src/lib/search-pipeline.ts` (1,275 lines),
 * lines 799-880. The file was deleted as part of the EnhancedSearchPipeline
 * rewrite; this logic had no equivalent in the replacement.
 *
 * Kept for phase 6 of the refactor (the orchestrator's rank step). Not compiled
 * — `docs/` is outside every tsconfig `include`.
 *
 * Two things to know before reusing this:
 *
 * 1. `mixResultsBySource` does not mix. Its own comment says it groups — OpenAlex
 *    first, then each other provider in turn. This is the origin of the
 *    contiguous per-provider blocks in the current output. Phase 6 replaces it
 *    with reciprocal rank fusion over `SourceRef.rank`; keep it here only as a
 *    record of the previous behaviour.
 *
 * 2. `calculateRelevanceScore` never looks at the query. It scores record
 *    completeness (abstract present, author count, recency, OA status, citation
 *    count), so it is a *quality* signal, not a relevance signal. Use it as a
 *    tiebreaker behind rank fusion, never as the primary sort.
 */

  /**
   * Group results by provider: OpenAlex first, then all other providers
   * This shows all OpenAlex results first, followed by all other provider results
   */
  private mixResultsBySource(records: EnrichedRecord[]): EnrichedRecord[] {
    // Group records by source
    const bySource = new Map<string, EnrichedRecord[]>();
    for (const record of records) {
      if (!bySource.has(record.source)) {
        bySource.set(record.source, []);
      }
      bySource.get(record.source)!.push(record);
    }

    // Sort each source's records by relevance score
    for (const [source, sourceRecords] of bySource) {
      sourceRecords.sort((a, b) => {
        const scoreA = this.calculateRelevanceScore(a);
        const scoreB = this.calculateRelevanceScore(b);
        return scoreB - scoreA;
      });
    }

    // Group by provider priority: OpenAlex first, then all others
    const openalexRecords = bySource.get('openalex') || [];
    const otherRecords: EnrichedRecord[] = [];
    
    // Collect all non-OpenAlex records
    for (const [source, sourceRecords] of bySource) {
      if (source !== 'openalex') {
        otherRecords.push(...sourceRecords);
      }
    }

    // Sort other records by relevance score
    otherRecords.sort((a, b) => {
      const scoreA = this.calculateRelevanceScore(a);
      const scoreB = this.calculateRelevanceScore(b);
      return scoreB - scoreA;
    });

    // Return OpenAlex results first, then all other provider results
    return [...openalexRecords, ...otherRecords];
  }

  /**
   * Calculate relevance score for sorting
   */
  private calculateRelevanceScore(record: EnrichedRecord): number {
    let score = 0;

    // Basic completeness
    if (record.title) score += 10;
    if (record.authors.length > 0) score += 10;
    if (record.year) score += 5;
    if (record.venue) score += 5;
    if (record.abstract) score += 10;

    // Enhanced fields
    if (record.canonicalTitle) score += 5;
    if (record.canonicalAuthors) score += 5;
    if (record.canonicalYear) score += 3;
    if (record.canonicalVenue) score += 3;
    if (record.canonicalAbstract) score += 5;

    // PDF availability
    if (record.pdfUrl) score += 15;
    if (record.pdfSource?.includes('publisher')) score += 5;

    // OA status
    if (record.oaStatus === 'published') score += 10;
    if (record.oaStatus === 'preprint') score += 5;

    // Licensing
    if (record.license) score += 5;
    if (record.isRedistributable) score += 3;

    // Citations
    if (record.citationCount) score += Math.min(record.citationCount / 10, 10);

    return score;
  }
