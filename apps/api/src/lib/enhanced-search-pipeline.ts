import { SearchParams, SearchResponse, OARecord, SearchSort, ProviderTotal } from '@open-access-explorer/shared';
import { OpenAlexClient, OpenAlexWork } from './clients/openalex';
import { CrossrefClient, CrossrefWork } from './clients/crossref';
import { UnpaywallClient, UnpaywallResponse } from './clients/unpaywall';
import { RecordMerger, EnrichedRecord } from './merge';
import { FallbackManager, createStagedFallbacks } from './fallback';
import { AggregatorManager, AggregatorResult } from './aggregators';

// OpenAlex will not return more than 200 works in one response
const OPENALEX_MAX_PER_PAGE = 200;

// How many records to read from each source per search. The OA and
// PDF-availability filters discard a large share of what comes back, so this
// sits well above the number of results a page actually shows.
const MAX_FETCH_DEPTH = 600;

/**
 * How many buckets an open-ended facet may carry.
 *
 * A result set of a few thousand records produces a bucket per distinct venue,
 * publisher and topic — measured, a topics facet of 3,079 buckets, with the
 * facets outweighing the results they describe by five to one. The panel
 * renders ten to fifteen of each, so the rest was decoded and cached on every
 * request to be discarded by the browser.
 *
 * Set above what the UI shows so a "show more" affordance has something to
 * expand into without another round trip. The generators sort by count first,
 * so what survives is the head of the distribution — the buckets a reader
 * would actually narrow by.
 */
const MAX_FACET_BUCKETS = 25;

function truncateFacet(buckets: Array<{ value: unknown; count: number }>) {
  return buckets.length > MAX_FACET_BUCKETS ? buckets.slice(0, MAX_FACET_BUCKETS) : buckets;
}

// Records retrieved for one search, alongside what each provider reported
type SourcedRecords = {
  records: EnrichedRecord[];
  providerTotals: ProviderTotal[];
};

export interface EnhancedSearchPipelineOptions {
  userAgent: string;
  maxResults?: number;
  enableEnrichment?: boolean;
  enablePdfResolution?: boolean;
  enableCitations?: boolean;
  enableTotalCount?: boolean;
}

export class EnhancedSearchPipeline {
  private openalexClient: OpenAlexClient;
  private crossrefClient: CrossrefClient;
  private unpaywallClient: UnpaywallClient;
  private recordMerger: RecordMerger;
  private fallbackManager: FallbackManager;
  private aggregatorManager: AggregatorManager;
  private options: EnhancedSearchPipelineOptions;

  constructor(options: EnhancedSearchPipelineOptions) {
    this.options = {
      maxResults: 100,
      enableEnrichment: true,
      enablePdfResolution: true,
      enableCitations: false,
      enableTotalCount: true,
      ...options
    };

    this.openalexClient = new OpenAlexClient(options.userAgent);
    this.crossrefClient = new CrossrefClient(options.userAgent);
    this.unpaywallClient = new UnpaywallClient(options.userAgent);
    this.recordMerger = new RecordMerger();
    this.aggregatorManager = new AggregatorManager();
    
    this.fallbackManager = new FallbackManager({
      maxConcurrency: 12,
      timeoutMs: 10000,
      retryDelayMs: 1000,
      failFast: false
    });

    // Configure adaptive learning
  }

  /**
   * Enhanced search with smart source selection
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    const startTime = Date.now();
    
    try {
      // Step 1: Normalize input
      const normalizedQuery = this.normalizeQuery(params.q || '');
      const isDoiQuery = this.isDoiQuery(normalizedQuery);

      let enrichedRecords: EnrichedRecord[] = [];
      let providerTotals: ProviderTotal[] = [];

      if (isDoiQuery) {
        enrichedRecords = await this.resolveDoi(normalizedQuery);
      } else {
        const sourced = await this.searchByKeywords(normalizedQuery, params);
        enrichedRecords = sourced.records;
        providerTotals = sourced.providerTotals;
      }

      // Step 3: Apply filters
      const filteredRecords = this.applyFilters(enrichedRecords, params.filters);

      // Step 4: Sort results
      const sortedRecords = this.sortResults(filteredRecords, params.sort || 'relevance');

      // Step 5: Paginate results
      const page = params.page || 1;
      const pageSize = params.pageSize || 20;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedRecords = sortedRecords.slice(startIndex, endIndex);

      // Step 6: The total is what we actually hold. Upstream sources report
      // counts for their own corpus, which overlap and are not comparable
      // across sources, so summing them produces a number no page of results
      // can ever back up. Pagination is derived from this, so it has to be the
      // real length of the result set.
      const totalCount = sortedRecords.length;

      // Step 7: Facets describe the results being returned, so they are counted
      // over the same filtered set that produced `hits`.
      const facets = this.generateFacets(sortedRecords);

      const duration = Date.now() - startTime;
      console.log(`Enhanced search pipeline completed in ${duration}ms, found ${totalCount} results`);

      return {
        hits: paginatedRecords,
        facets,
        page,
        pageSize,
        total: totalCount,
        // Reported per provider, never summed: the corpora overlap, so adding
        // them would count the same paper repeatedly.
        providerTotals: providerTotals.length ? providerTotals : undefined,
        // query: params.q, // Remove this line as it's not part of SearchResponse
        filters: params.filters,
        sort: params.sort || 'relevance',
        duration
      };
    } catch (error) {
      console.error('Enhanced search pipeline error:', error);
      throw error;
    }
  }

  /**
   * Resolve a single DOI.
   *
   * All three authorities are consulted rather than stopping at the first hit:
   * Crossref carries the canonical metadata, Unpaywall is the authority on OA
   * status and the best PDF, and OpenAlex fills in citations and topics. Merging
   * them by DOI is what produces a record that survives the OA/PDF filters.
   */
  private async resolveDoi(doi: string): Promise<EnrichedRecord[]> {
    const normalizedDoi = this.normalizeDoi(doi);

    // Each stage resolves a different shape; convertToOARecord dispatches on source
    const fallbacks = createStagedFallbacks<CrossrefWork | UnpaywallResponse | OpenAlexWork | null>({
      fast: [
        {
          name: 'crossref',
          fn: () => this.crossrefClient.getWork(normalizedDoi),
          timeout: 2000
        },
        {
          name: 'unpaywall',
          fn: () => this.unpaywallClient.resolveDOI(normalizedDoi),
          timeout: 2000
        }
      ],
      medium: [
        {
          name: 'openalex',
          fn: () => this.openalexClient.getWorkByDOI(normalizedDoi),
          timeout: 5000
        }
      ],
      slow: []
    });

    const results = await this.fallbackManager.executeInStages(fallbacks);

    const records: OARecord[] = [];
    for (const result of results) {
      if (result.success && result.data) {
        const record = this.convertToOARecord(result.data, result.source);
        if (record) {
          records.push(record);
        }
      }
    }

    return this.recordMerger.deduplicateByDOI(records);
  }

  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//, '');
  }

  /**
   * Convert a DOI-authority response to an OARecord, dispatching on the source
   * that produced it.
   */
  private convertToOARecord(data: any, source: string): OARecord | null {
    switch (source) {
      case 'crossref':
        return this.convertCrossrefToOARecord(data as CrossrefWork);
      case 'unpaywall':
        return this.convertUnpaywallToOARecord(data as UnpaywallResponse);
      case 'openalex':
        return this.convertOpenAlexToOARecord(data as OpenAlexWork);
      default:
        return null;
    }
  }

  private convertCrossrefToOARecord(work: CrossrefWork): OARecord | null {
    if (!work.title || work.title.length === 0) return null;

    const title = Array.isArray(work.title) ? work.title[0] : work.title;
    const venue = Array.isArray(work['container-title']) ? work['container-title'][0] : work['container-title'];
    const license = CrossrefClient.extractLicense(work);

    return {
      id: `crossref:${work.DOI}`,
      doi: work.DOI,
      title,
      authors: CrossrefClient.extractAuthors(work),
      year: CrossrefClient.extractYear(work),
      venue,
      publisher: work.publisher,
      abstract: work.abstract,
      source: 'crossref',
      sourceId: work.DOI,
      oaStatus: license ? 'published' : 'other',
      bestPdfUrl: CrossrefClient.extractPdfLink(work),
      landingPage: `https://doi.org/${work.DOI}`,
      topics: work.subject || [],
      language: work.language || 'en',
      citationCount: CrossrefClient.extractCitationCount(work),
      createdAt: new Date().toISOString()
    };
  }

  private convertUnpaywallToOARecord(response: UnpaywallResponse): OARecord | null {
    if (!response.title) return null;

    const authors = response.z_authors?.map(author =>
      `${author.given} ${author.family}`.trim()
    ) || [];

    return {
      id: `unpaywall:${response.doi}`,
      doi: response.doi,
      title: response.title,
      authors,
      year: response.year,
      venue: response.journal_name,
      abstract: response.abstract_inverted_index
        ? UnpaywallClient.reconstructAbstract(response.abstract_inverted_index)
        : undefined,
      source: 'unpaywall',
      sourceId: response.doi,
      oaStatus: response.is_oa ? 'published' : 'other',
      bestPdfUrl: UnpaywallClient.getBestPdfUrl(response),
      landingPage: response.best_oa_location?.url_for_landing_page || `https://doi.org/${response.doi}`,
      topics: [],
      language: 'en',
      createdAt: new Date().toISOString()
    };
  }

  private convertOpenAlexToOARecord(work: OpenAlexWork): OARecord | null {
    if (!work.title) return null;

    const venue = work.host_venue?.display_name || work.primary_location?.source?.display_name;

    return {
      id: `openalex:${work.id}`,
      doi: work.doi,
      title: work.title,
      authors: work.authorships?.map(a => a.author.display_name) || [],
      year: work.publication_year,
      venue,
      publisher: work.host_venue?.publisher,
      abstract: work.abstract_inverted_index
        ? this.reconstructAbstract(work.abstract_inverted_index)
        : undefined,
      source: 'openalex',
      sourceId: work.id,
      oaStatus: work.open_access?.is_oa ? 'published' : 'other',
      bestPdfUrl: work.open_access?.oa_url,
      landingPage: work.doi ? `https://doi.org/${work.doi}` : work.id,
      topics: work.concepts?.map(c => c.display_name) || [],
      language: work.language || 'en',
      citationCount: work.cited_by_count,
      createdAt: work.created_date || new Date().toISOString()
    };
  }



  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  private isDoiQuery(query: string): boolean {
    const doiPattern = /^10\.\d{4,}\/[^\s]+$/i;
    return doiPattern.test(query);
  }

  private sortResults(records: EnrichedRecord[], sort: SearchSort): EnrichedRecord[] {
    switch (sort) {
      case 'date':
        return records.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'date_asc':
        return records.sort((a, b) => (a.year || 0) - (b.year || 0));
      case 'citations':
        return records.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
      case 'citations_asc':
        return records.sort((a, b) => (a.citationCount || 0) - (b.citationCount || 0));
      case 'author':
        return records.sort((a, b) => (a.authors?.[0] || '').localeCompare(b.authors?.[0] || ''));
      case 'author_desc':
        return records.sort((a, b) => (b.authors?.[0] || '').localeCompare(a.authors?.[0] || ''));
      case 'venue':
        return records.sort((a, b) => (a.venue || '').localeCompare(b.venue || ''));
      case 'venue_desc':
        return records.sort((a, b) => (b.venue || '').localeCompare(a.venue || ''));
      case 'title':
        return records.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
      case 'title_desc':
        return records.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
      case 'relevance':
      default:
        return records;
    }
  }

  /**
   * Count each facet over the records being returned. Every bucket therefore
   * sums to at most the reported total, and selecting one narrows the result
   * set by exactly the count shown.
   */
  private generateFacets(records: EnrichedRecord[]): any {
    return {
      // Bounded by the provider list and the status vocabulary, so these are
      // small however many records came back and are sent whole.
      source: this.generateSourceFacets(records),
      oaStatus: this.generateOaStatusFacets(records),
      year: this.generateYearFacets(records),
      // Open-ended: one bucket per distinct value across the whole result set.
      venue: truncateFacet(this.generateVenueFacets(records)),
      publisher: truncateFacet(this.generatePublisherFacets(records)),
      topics: truncateFacet(this.generateTopicsFacets(records))
    };
  }

  private generateSourceFacets(records: EnrichedRecord[]): any[] {
    const sourceCounts = new Map<string, number>();
    records.forEach(record => {
      const count = sourceCounts.get(record.source) || 0;
      sourceCounts.set(record.source, count + 1);
    });

    return Array.from(sourceCounts.entries()).map(([source, count]) => ({
      value: source,
      count
    }));
  }

  private generateYearFacets(records: EnrichedRecord[]): any[] {
    const yearCounts = new Map<number, number>();
    records.forEach(record => {
      if (record.year) {
        const count = yearCounts.get(record.year) || 0;
        yearCounts.set(record.year, count + 1);
      }
    });

    return Array.from(yearCounts.entries())
      .sort(([a], [b]) => b - a)
      .slice(0, 10)
      .map(([year, count]) => ({
        value: year,
        count
      }));
  }

  private generateOaStatusFacets(records: EnrichedRecord[]): any[] {
    // oaStatus is optional, so undefined is a real bucket here
    const statusCounts = new Map<string | undefined, number>();
    records.forEach(record => {
      const count = statusCounts.get(record.oaStatus) || 0;
      statusCounts.set(record.oaStatus, count + 1);
    });

    return Array.from(statusCounts.entries()).map(([status, count]) => ({
      value: status,
      count
    }));
  }

  // Include other necessary methods from original SearchPipeline
  private async searchByKeywords(query: string, params: SearchParams): Promise<SourcedRecords> {
    const depth = this.fetchDepth();

    // Step 1: Discovery via OpenAlex
    const discovery = await this.discoverWorks(query, params, depth);

    // Step 2: Search aggregators in parallel
    const aggregatorResults = await this.aggregatorManager.searchAggregators(
      { ...params, q: query },
      { limit: depth, offset: 0 }
    );

    // Step 3: Extract DOIs for enrichment
    const dois = discovery.works
      .map(work => work.doi)
      .filter((doi): doi is string => Boolean(doi));

    // Step 4: Enrich with canonical metadata and OA resolution
    const enrichedRecords = await this.enrichWorks(discovery.works, dois);

    // Step 5: Merge aggregator results
    const aggregatorRecords = this.mergeAggregatorResults(aggregatorResults);

    // Step 6: Combine and deduplicate all results
    const allRecords = [...enrichedRecords, ...aggregatorRecords];
    const deduplicatedRecords = this.recordMerger.deduplicate(allRecords);
    console.log(`Combined ${allRecords.length} records, ${deduplicatedRecords.length} after deduplication`);

    return {
      records: deduplicatedRecords,
      providerTotals: [
        { source: 'openalex', totalHits: discovery.totalHits, retrieved: discovery.works.length },
        ...aggregatorResults.map(r => ({
          source: r.source,
          totalHits: r.totalHits,
          retrieved: r.records.length,
          error: r.error
        }))
      ]
    };
  }

  /**
   * How deep to read into each source.
   *
   * Deliberately independent of which page is being viewed: the depth defines
   * the result set, so letting it grow with the page would change the reported
   * total as the user pages through it. Every page therefore answers from the
   * same window, and `total` is a stable property of the query.
   */
  private fetchDepth(): number {
    return this.options.maxResults || MAX_FETCH_DEPTH;
  }

  private async discoverWorks(
    query: string,
    params: SearchParams,
    depth: number
  ): Promise<{ works: OpenAlexWork[]; totalHits?: number }> {
    const filter = this.buildOpenAlexFilter(params.filters);
    const pageCount = Math.ceil(depth / OPENALEX_MAX_PER_PAGE);

    // OpenAlex caps a single response at 200. The depth is known up front, so
    // the pages go out together rather than one after another — walking them
    // in sequence put the whole round trip on the critical path once per page.
    const requests = Array.from({ length: pageCount }, (_, index) => {
      const page = index + 1;
      const perPage = Math.min(depth - index * OPENALEX_MAX_PER_PAGE, OPENALEX_MAX_PER_PAGE);

      return this.openalexClient
        .searchWorks({ query, page, perPage, filter })
        .then(response => ({ results: response.results, count: response.meta?.count }))
        .catch(error => {
          console.error(`OpenAlex discovery error (page ${page}):`, error);
          return { results: [] as OpenAlexWork[], count: undefined };
        });
    });

    const pages = await Promise.all(requests);

    return {
      works: pages.flatMap(p => p.results),
      // Every page reports the same corpus-wide count; take the first that came back
      totalHits: pages.find(p => typeof p.count === 'number')?.count
    };
  }

  private buildOpenAlexFilter(filters: any): any {
    const filterParts: string[] = [];
    
    // Always filter for open access works
    filterParts.push('is_oa:true');
    
    if (filters?.yearFrom) {
      filterParts.push(`publication_year:>=${filters.yearFrom}`);
    }
    if (filters?.yearTo) {
      filterParts.push(`publication_year:<=${filters.yearTo}`);
    }
    
    return filterParts.join(',');
  }

  private async enrichWorks(works: OpenAlexWork[], dois: string[]): Promise<EnrichedRecord[]> {
    const enrichedRecords: EnrichedRecord[] = [];
    
    for (const work of works) {
      try {
        // Skip non-open access works
        if (!work.open_access?.is_oa) {
          continue;
        }

        // Skip works without PDF URLs
        if (!work.open_access?.oa_url) {
          continue;
        }

        // Basic enrichment - in a real implementation, you'd add more enrichment logic
        const enrichedRecord: EnrichedRecord = {
          id: `openalex:${work.id}`,
          doi: work.doi,
          title: work.title || '',
          authors: work.authorships?.map(a => a.author.display_name) || [],
          year: work.publication_year,
          venue: work.host_venue?.display_name || work.primary_location?.source?.display_name,
          abstract: work.abstract_inverted_index ? this.reconstructAbstract(work.abstract_inverted_index) : undefined,
          source: 'openalex',
          sourceId: work.id,
          oaStatus: 'published', // Only open access works reach here
          bestPdfUrl: work.open_access?.oa_url,
          landingPage: work.id,
          topics: work.concepts?.map(c => c.display_name) || [],
          language: work.language || 'en',
          createdAt: work.created_date || new Date().toISOString(),
          citationCount: work.cited_by_count,
          publisher: work.host_venue?.publisher,
          canonicalTitle: work.title,
          canonicalAuthors: work.authorships?.map(a => a.author.display_name) || [],
          canonicalYear: work.publication_year,
          canonicalVenue: work.host_venue?.display_name || work.primary_location?.source?.display_name,
          canonicalAbstract: work.abstract_inverted_index ? this.reconstructAbstract(work.abstract_inverted_index) : undefined,
          pdfUrl: work.open_access?.oa_url,
          pdfSource: 'openalex',
          isRedistributable: true // Only open access works reach here
        };
        
        enrichedRecords.push(enrichedRecord);
      } catch (error) {
        console.error('Error enriching work:', error);
      }
    }
    
    return enrichedRecords;
  }

  private reconstructAbstract(abstractInvertedIndex: any): string {
    if (!abstractInvertedIndex) return '';
    
    const words: { [key: number]: string } = {};
    for (const [word, positions] of Object.entries(abstractInvertedIndex)) {
      for (const pos of positions as number[]) {
        words[pos] = word;
      }
    }
    
    return Object.keys(words)
      .map(Number)
      .sort((a, b) => a - b)
      .map(pos => words[pos])
      .join(' ');
  }

  private mergeAggregatorResults(aggregatorResults: AggregatorResult[]): EnrichedRecord[] {
    const allRecords: EnrichedRecord[] = [];
    
    for (const result of aggregatorResults) {
      if (result.records && result.records.length > 0) {
        allRecords.push(...result.records);
      }
    }
    
    return allRecords;
  }

  private generateVenueFacets(records: EnrichedRecord[]): any[] {
    const venueCounts = new Map<string, number>();
    records.forEach(record => {
      // Check both venue and canonicalVenue fields
      const venue = record.venue || record.canonicalVenue;
      if (venue && venue.trim()) {
        const count = venueCounts.get(venue) || 0;
        venueCounts.set(venue, count + 1);
      }
    });

    return Array.from(venueCounts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  private generatePublisherFacets(records: EnrichedRecord[]): any[] {
    const publisherCounts = new Map<string, number>();
    records.forEach(record => {
      if (record.publisher) {
        const count = publisherCounts.get(record.publisher) || 0;
        publisherCounts.set(record.publisher, count + 1);
      }
    });

    return Array.from(publisherCounts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  private generateTopicsFacets(records: EnrichedRecord[]): any[] {
    const topicCounts = new Map<string, number>();
    records.forEach(record => {
      if (record.topics && Array.isArray(record.topics)) {
        record.topics.forEach((topic: string) => {
          if (topic && topic.trim()) {
            const count = topicCounts.get(topic) || 0;
            topicCounts.set(topic, count + 1);
          }
        });
      }
    });

    return Array.from(topicCounts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Apply search filters including open access filtering
   */
  private applyFilters(records: EnrichedRecord[], filters?: any): EnrichedRecord[] {
    return records.filter(record => {
      // Source filter
      if (filters?.source && filters.source.length > 0) {
        if (!filters.source.includes(record.source)) {
          return false;
        }
      }

      // Year range filter
      if (filters?.yearFrom && record.year && record.year < filters.yearFrom) {
        return false;
      }
      if (filters?.yearTo && record.year && record.year > filters.yearTo) {
        return false;
      }

      // Year exact match filter
      if (filters?.year && filters.year.length > 0) {
        if (!filters.year.includes(record.year?.toString())) {
          return false;
        }
      }

      // Open Access filter - CRITICAL: Only show open access papers
      if (record.oaStatus !== 'published' && record.oaStatus !== 'preprint') {
        return false;
      }

      // PDF availability filter - Only show papers with downloadable PDFs
      if (!record.bestPdfUrl && !record.pdfUrl) {
        return false;
      }

      // Venue filter
      if (filters?.venue && filters.venue.length > 0) {
        if (!record.venue || !filters.venue.includes(record.venue)) {
          return false;
        }
      }

      // Publisher filter
      if (filters?.publisher && filters.publisher.length > 0) {
        const publisher = record.publisher;
        if (!publisher || !filters.publisher.includes(publisher)) {
          return false;
        }
      }

      // Topics filter
      if (filters?.topics && filters.topics.length > 0) {
        if (!record.topics || !record.topics.some(topic => filters.topics.includes(topic))) {
          return false;
        }
      }

      // Publication type filter
      if (filters?.publicationType && filters.publicationType.length > 0) {
        const isPeerReviewed = ['europepmc', 'ncbi'].includes(record.source);
        const isPreprint = ['arxiv'].includes(record.source);
        
        if (filters.publicationType.includes('peer-reviewed') && !isPeerReviewed) {
          return false;
        }
        if (filters.publicationType.includes('preprint') && !isPreprint) {
          return false;
        }
      }

      return true;
    });
  }
}
