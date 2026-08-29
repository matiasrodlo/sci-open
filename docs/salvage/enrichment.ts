/**
 * SALVAGED — cross-source enrichment from the deleted
 * `apps/api/src/lib/search-pipeline.ts`.
 *
 * Source: `git show 56817406:apps/api/src/lib/search-pipeline.ts` (1,275 lines),
 * lines 576-645. Merged Crossref and Unpaywall metadata onto records already
 * found. The EnhancedSearchPipeline rewrite dropped this; no equivalent exists,
 * which is why cross-source enrichment is currently missing entirely.
 *
 * Kept for phase 9 of the refactor (authorities and enrichment). Not compiled
 * — `docs/` is outside every tsconfig `include`.
 *
 * Note for phase 9: `mergeUnpaywallData` is the shape the authority interface
 * (`lookup(doi) -> Partial<Paper>`) should replace, and it already reads
 * Unpaywall's `is_oa` and graded `oa_status` correctly — which is exactly the
 * fix phase 9 has to apply to the Crossref path, where OA status is currently
 * inferred from the presence of any license entry.
 */

  /**
   * Merge Crossref data into existing records
   */
  private mergeCrossrefData(records: OARecord[], crossrefWork: CrossrefWork): void {
    const record = records.find(r => r.doi === crossrefWork.DOI);
    if (!record) {
      console.log(`No matching record found for DOI: ${crossrefWork.DOI}`);
      return;
    }
    console.log(`Merging Crossref data for DOI: ${crossrefWork.DOI}, publisher: ${crossrefWork.publisher}`);

    // Update record with Crossref data (prefer Crossref for canonical metadata)
    if (!record.title || record.title === 'Untitled') {
      record.title = Array.isArray(crossrefWork.title) ? crossrefWork.title[0] : crossrefWork.title;
    }
    
    if (record.authors.length === 0) {
      record.authors = CrossrefClient.extractAuthors(crossrefWork);
    }
    
    if (!record.year) {
      record.year = CrossrefClient.extractYear(crossrefWork);
    }
    
    if (!record.venue) {
      record.venue = Array.isArray(crossrefWork['container-title']) ? 
        crossrefWork['container-title'][0] : crossrefWork['container-title'];
    }
    
    if (!record.abstract) {
      record.abstract = crossrefWork.abstract;
    }
    
    if (!record.bestPdfUrl) {
      record.bestPdfUrl = CrossrefClient.extractPdfLink(crossrefWork);
    }
    
    // Add citation count from Crossref
    const citationCount = CrossrefClient.extractCitationCount(crossrefWork);
    if (citationCount !== undefined) {
      record.citationCount = citationCount;
    }
    
    // Add publisher from Crossref
    if (crossrefWork.publisher) {
      (record as any).publisher = crossrefWork.publisher;
    }
  }

  /**
   * Merge Unpaywall data into existing records
   */
  private mergeUnpaywallData(records: OARecord[], unpaywallResponse: UnpaywallResponse): void {
    const record = records.find(r => r.doi === unpaywallResponse.doi);
    if (!record) return;

    // Update record with Unpaywall data (prefer for OA status and PDF)
    if (unpaywallResponse.is_oa) {
      record.oaStatus = 'published';
    }
    
    if (!record.bestPdfUrl) {
      record.bestPdfUrl = UnpaywallClient.getBestPdfUrl(unpaywallResponse);
    }
    
    if (!record.landingPage) {
      record.landingPage = unpaywallResponse.best_oa_location?.url_for_landing_page || 
        `https://doi.org/${unpaywallResponse.doi}`;
    }
  }
