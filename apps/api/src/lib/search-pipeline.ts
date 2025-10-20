import { SearchParams, SearchResponse, OARecord } from '@open-access-explorer/shared';
import { OpenAlexClient, OpenAlexWork } from './clients/openalex';
import { CrossrefClient, CrossrefWork } from './clients/crossref';
import { UnpaywallClient, UnpaywallResponse } from './clients/unpaywall';
import { RecordMerger, EnrichedRecord } from './merge';
import { FallbackManager, createStagedFallbacks } from './fallback';
import { AggregatorManager, AggregatorResult } from './aggregators';

export interface SearchPipelineOptions {
  userAgent: string;
  maxResults?: number;
  enableEnrichment?: boolean;
  enablePdfResolution?: boolean;
  enableCitations?: boolean;
}

export class SearchPipeline {
  private openalexClient: OpenAlexClient;
  private crossrefClient: CrossrefClient;
  private unpaywallClient: UnpaywallClient;
  private recordMerger: RecordMerger;
  private fallbackManager: FallbackManager;
  private aggregatorManager: AggregatorManager;
  private options: SearchPipelineOptions;

  constructor(options: SearchPipelineOptions) {
    this.options = {
      maxResults: 100,
      enableEnrichment: true,
      enablePdfResolution: true,
      enableCitations: false,
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
      retryAttempts: 2,
      retryDelayMs: 1000,
      failFast: false
    });
  }

  /**
   * Main search pipeline
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    const startTime = Date.now();
    
    try {
      // Step 1: Normalize input
      const normalizedQuery = this.normalizeQuery(params.q || '');
      const isDoiQuery = this.isDoiQuery(normalizedQuery);

      let enrichedRecords: EnrichedRecord[] = [];

      if (isDoiQuery) {
        // Direct DOI lookup
        enrichedRecords = await this.resolveDoi(normalizedQuery);
      } else {
        // Keyword search with discovery
        enrichedRecords = await this.searchByKeywords(normalizedQuery, params);
      }

      // Step 2: Apply filters
      const filteredRecords = this.applyFilters(enrichedRecords, params.filters);

      // Step 3: Sort results
      const sortedRecords = this.sortResults(filteredRecords, params.sort || 'relevance');

      // Step 4: Paginate results
      const page = params.page || 1;
      const pageSize = params.pageSize || 20;
      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedRecords = sortedRecords.slice(startIndex, endIndex);

      // Step 5: Generate facets
      const facets = this.generateFacets(sortedRecords);

      const duration = Date.now() - startTime;
      console.log(`Search pipeline completed in ${duration}ms, found ${sortedRecords.length} results`);

      return {
        hits: paginatedRecords,
        facets,
        page,
        total: sortedRecords.length,
        pageSize
      };

    } catch (error) {
      console.error('Search pipeline error:', error);
      throw error;
    }
  }

  /**
   * Normalize search query
   */
  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  /**
   * Check if query is a DOI
   */
  private isDoiQuery(query: string): boolean {
    // Simple DOI pattern matching
    const doiPattern = /^(https?:\/\/)?(dx\.)?doi\.org\/|^doi:|^10\./;
    return doiPattern.test(query);
  }

  /**
   * Resolve a single DOI
   */
  private async resolveDoi(doi: string): Promise<EnrichedRecord[]> {
    const normalizedDoi = this.normalizeDoi(doi);
    
    // Create fallbacks for DOI resolution
    const fallbacks = createStagedFallbacks({
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
    
    // Process results
    const records: OARecord[] = [];
    
    for (const result of results) {
      if (result.success && result.data) {
        const record = this.convertToOARecord(result.data, result.source, normalizedDoi);
        if (record) {
          records.push(record);
        }
      }
    }

    // Merge and enrich records
    return this.recordMerger.deduplicateByDOI(records);
  }

  /**
   * Search by keywords with discovery
   */
  private async searchByKeywords(query: string, params: SearchParams): Promise<EnrichedRecord[]> {
    // Step 1: Discovery via OpenAlex
    const discoveryResults = await this.discoverWorks(query, params);
    
    // Step 2: Search aggregators in parallel
    const aggregatorResults = await this.aggregatorManager.searchAggregators(params);
    
    // Step 3: Extract DOIs for enrichment
    const dois = discoveryResults
      .map(work => work.doi)
      .filter((doi): doi is string => Boolean(doi));

    // Step 4: Enrich with canonical metadata and OA resolution
    const enrichedRecords = await this.enrichWorks(discoveryResults, dois);
    
    // Step 5: Merge aggregator results
    const aggregatorRecords = this.mergeAggregatorResults(aggregatorResults);
    
    // Step 6: Combine and deduplicate all results
    const allRecords = [...enrichedRecords, ...aggregatorRecords];
    console.log(`Combined ${enrichedRecords.length} enriched + ${aggregatorRecords.length} aggregator records = ${allRecords.length} total`);
    
    const deduplicatedRecords = this.recordMerger.deduplicate(allRecords);
    console.log(`After deduplication: ${deduplicatedRecords.length} records`);

    return deduplicatedRecords;
  }

  /**
   * Discover works using OpenAlex
   */
  private async discoverWorks(query: string, params: SearchParams): Promise<OpenAlexWork[]> {
    try {
      const response = await this.openalexClient.searchWorks({
        query,
        perPage: Math.min(this.options.maxResults || 100, 100),
        filter: this.buildOpenAlexFilter(params.filters)
      });

      return response.results;
    } catch (error) {
      console.error('OpenAlex discovery error:', error);
      return [];
    }
  }

  /**
   * Build OpenAlex filter from search params
   */
  private buildOpenAlexFilter(filters?: any): string | undefined {
    const filterParts: string[] = [];

    if (filters?.yearFrom) {
      filterParts.push(`publication_year:>=${filters.yearFrom}`);
    }
    if (filters?.yearTo) {
      filterParts.push(`publication_year:<=${filters.yearTo}`);
    }
    if (filters?.source) {
      // Map source filters to OpenAlex concepts or types
      const sourceFilters = filters.source.map((s: string) => {
        switch (s) {
          case 'arxiv': return 'type:preprint';
          case 'plos': return 'primary_location.source.publisher:PLOS';
          case 'mdpi': return 'primary_location.source.publisher:MDPI';
          default: return null;
        }
      }).filter(Boolean);
      
      if (sourceFilters.length > 0) {
        filterParts.push(`(${sourceFilters.join(' OR ')})`);
      }
    }

    return filterParts.length > 0 ? filterParts.join(',') : undefined;
  }

  /**
   * Enrich works with canonical metadata and OA resolution
   */
  private async enrichWorks(works: OpenAlexWork[], dois: string[]): Promise<EnrichedRecord[]> {
    const records: OARecord[] = [];

    // Convert OpenAlex works to OARecords
    for (const work of works) {
      const record = this.convertOpenAlexToOARecord(work);
      if (record) {
        records.push(record);
      }
    }

    // Enrich with Crossref and Unpaywall data
    if (this.options.enableEnrichment && dois.length > 0) {
      await this.enrichWithCanonicalMetadata(records, dois);
    }

    // Resolve PDFs
    if (this.options.enablePdfResolution) {
      await this.resolvePdfs(records, dois);
    }

    // Merge and deduplicate
    return this.recordMerger.deduplicateByDOI(records);
  }

  /**
   * Enrich records with canonical metadata from Crossref
   */
  private async enrichWithCanonicalMetadata(records: OARecord[], dois: string[]): Promise<void> {
    const batchSize = 5;
    
    for (let i = 0; i < dois.length; i += batchSize) {
      const batch = dois.slice(i, i + batchSize);
      
      const promises = batch.map(async (doi) => {
        try {
          const crossrefWork = await this.crossrefClient.getWork(doi);
          if (crossrefWork) {
            this.mergeCrossrefData(records, crossrefWork);
          }
        } catch (error) {
          console.error(`Crossref enrichment error for ${doi}:`, error);
        }
      });

      await Promise.allSettled(promises);
      
      // Small delay between batches
      if (i + batchSize < dois.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Resolve PDFs using Unpaywall
   */
  private async resolvePdfs(records: OARecord[], dois: string[]): Promise<void> {
    const batchSize = 5;
    
    for (let i = 0; i < dois.length; i += batchSize) {
      const batch = dois.slice(i, i + batchSize);
      
      const promises = batch.map(async (doi) => {
        try {
          const unpaywallResponse = await this.unpaywallClient.resolveDOI(doi);
          if (unpaywallResponse) {
            this.mergeUnpaywallData(records, unpaywallResponse);
          }
        } catch (error) {
          console.error(`Unpaywall resolution error for ${doi}:`, error);
        }
      });

      await Promise.allSettled(promises);
      
      // Small delay between batches
      if (i + batchSize < dois.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Convert OpenAlex work to OARecord
   */
  private convertOpenAlexToOARecord(work: OpenAlexWork): OARecord | null {
    if (!work.title) return null;

    const authors = work.authorships?.map(authorship => authorship.author.display_name) || [];
    const year = work.publication_year;
    const venue = work.primary_location?.source?.display_name;
    const abstract = work.abstract_inverted_index ? 
      OpenAlexClient.reconstructAbstract(work.abstract_inverted_index) : undefined;
    const topics = work.concepts?.map(c => c.display_name) || [];

    return {
      id: `openalex:${work.id}`,
      doi: work.doi,
      title: work.title,
      authors,
      year,
      venue,
      abstract,
      source: 'openalex',
      sourceId: work.id,
      oaStatus: work.open_access?.is_oa ? 'published' : 'other',
      bestPdfUrl: work.open_access?.oa_url,
      landingPage: work.doi ? `https://doi.org/${work.doi}` : undefined,
      topics,
      language: work.language || 'en',
      citationCount: work.cited_by_count,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Convert external data to OARecord
   */
  private convertToOARecord(data: any, source: string, doi: string): OARecord | null {
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

  /**
   * Convert Crossref work to OARecord
   */
  private convertCrossrefToOARecord(work: CrossrefWork): OARecord | null {
    if (!work.title || work.title.length === 0) return null;

    const title = Array.isArray(work.title) ? work.title[0] : work.title;
    const authors = CrossrefClient.extractAuthors(work);
    const year = CrossrefClient.extractYear(work);
    const venue = Array.isArray(work['container-title']) ? work['container-title'][0] : work['container-title'];
    const pdfUrl = CrossrefClient.extractPdfLink(work);
    const license = CrossrefClient.extractLicense(work);

    return {
      id: `crossref:${work.DOI}`,
      doi: work.DOI,
      title,
      authors,
      year,
      venue,
      abstract: work.abstract,
      source: 'crossref',
      sourceId: work.DOI,
      oaStatus: license ? 'published' : 'other',
      bestPdfUrl: pdfUrl,
      landingPage: `https://doi.org/${work.DOI}`,
      topics: work.subject || [],
      language: work.language || 'en',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Convert Unpaywall response to OARecord
   */
  private convertUnpaywallToOARecord(response: UnpaywallResponse): OARecord | null {
    if (!response.title) return null;

    const authors = response.z_authors?.map(author => 
      `${author.given} ${author.family}`.trim()
    ) || [];
    const abstract = response.abstract_inverted_index ? 
      UnpaywallClient.reconstructAbstract(response.abstract_inverted_index) : undefined;
    const pdfUrl = UnpaywallClient.getBestPdfUrl(response);
    const license = UnpaywallClient.getLicense(response);

    return {
      id: `unpaywall:${response.doi}`,
      doi: response.doi,
      title: response.title,
      authors,
      year: response.year,
      venue: response.journal_name,
      abstract,
      source: 'unpaywall',
      sourceId: response.doi,
      oaStatus: response.is_oa ? 'published' : 'other',
      bestPdfUrl: pdfUrl,
      landingPage: response.best_oa_location?.url_for_landing_page || `https://doi.org/${response.doi}`,
      topics: [],
      language: 'en',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Merge Crossref data into existing records
   */
  private mergeCrossrefData(records: OARecord[], crossrefWork: CrossrefWork): void {
    const record = records.find(r => r.doi === crossrefWork.DOI);
    if (!record) return;

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

  /**
   * Apply search filters
   */
  private applyFilters(records: EnrichedRecord[], filters?: any): EnrichedRecord[] {
    if (!filters) return records;

    return records.filter(record => {
      // Source filter
      if (filters.source && filters.source.length > 0) {
        if (!filters.source.includes(record.source)) {
          return false;
        }
      }

      // Year filter
      if (filters.yearFrom && record.year && record.year < filters.yearFrom) {
        return false;
      }
      if (filters.yearTo && record.year && record.year > filters.yearTo) {
        return false;
      }

      // OA Status filter
      if (filters.oaStatus && filters.oaStatus.length > 0) {
        if (!filters.oaStatus.includes(record.oaStatus)) {
          return false;
        }
      }

      // Venue filter
      if (filters.venue && filters.venue.length > 0) {
        if (!record.venue || !filters.venue.includes(record.venue)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Sort results
   */
  private sortResults(records: EnrichedRecord[], sort: string): EnrichedRecord[] {
    switch (sort) {
      case 'date':
        return records.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'citations':
        return records.sort((a, b) => (b.citationCount || 0) - (a.citationCount || 0));
      case 'relevance':
      default:
        // Use round-robin mixing for diversity across sources
        return this.mixResultsBySource(records);
    }
  }

  /**
   * Mix results from different sources in round-robin fashion
   * This ensures diversity rather than all results from one high-scoring source
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

    // Round-robin merge
    const mixed: EnrichedRecord[] = [];
    const sources = Array.from(bySource.values());
    let maxLength = Math.max(...sources.map(s => s.length));

    for (let i = 0; i < maxLength; i++) {
      for (const sourceRecords of sources) {
        if (i < sourceRecords.length) {
          mixed.push(sourceRecords[i]);
        }
      }
    }

    return mixed;
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

  /**
   * Generate facets from results
   */
  private generateFacets(records: EnrichedRecord[]): Record<string, any> {
    const facets: Record<string, any> = {
      source: {},
      year: {},
      oaStatus: {},
      venue: {}
    };

    for (const record of records) {
      // Source facet
      facets.source[record.source] = (facets.source[record.source] || 0) + 1;

      // Year facet
      if (record.year) {
        facets.year[record.year.toString()] = (facets.year[record.year.toString()] || 0) + 1;
      }

      // OA Status facet
      if (record.oaStatus) {
        facets.oaStatus[record.oaStatus] = (facets.oaStatus[record.oaStatus] || 0) + 1;
      }

      // Venue facet
      if (record.venue) {
        facets.venue[record.venue] = (facets.venue[record.venue] || 0) + 1;
      }
    }

    return facets;
  }

  /**
   * Normalize DOI
   */
  private normalizeDoi(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//, '');
  }

  /**
   * Merge aggregator results into enriched records
   */
  private mergeAggregatorResults(aggregatorResults: AggregatorResult[]): EnrichedRecord[] {
    const enrichedRecords: EnrichedRecord[] = [];

    for (const result of aggregatorResults) {
      if (result.error) {
        console.warn(`Aggregator ${result.source} failed: ${result.error}`);
        continue;
      }

      console.log(`Aggregator ${result.source} returned ${result.records.length} records in ${result.latency}ms`);

      for (const record of result.records) {
        const enrichedRecord: EnrichedRecord = {
          ...record,
          // Add aggregator-specific metadata
          sourceMetadata: {
            source: result.source,
            latency: result.latency,
            enriched: false // Aggregator records are not enriched by default
          }
        };

        enrichedRecords.push(enrichedRecord);
        console.log(`Added aggregator record: ${record.title} (DOI: ${record.doi || 'none'})`);
      }
    }

    console.log(`Total aggregator records to merge: ${enrichedRecords.length}`);
    return enrichedRecords;
  }
}
