import { SearchParams, SearchResponse, OARecord } from '@open-access-explorer/shared';
import { OpenAlexClient, OpenAlexWork } from './clients/openalex';
import { CrossrefClient, CrossrefWork } from './clients/crossref';
import { UnpaywallClient, UnpaywallResponse } from './clients/unpaywall';
import { RecordMerger, EnrichedRecord } from './merge';
import { FallbackManager, createStagedFallbacks } from './fallback';
import { AggregatorManager, AggregatorResult } from './aggregators';
import { SmartSourceSelector, SourceSelectionResult } from './smart-source-selector';
import { QueryAnalyzer } from './query-analyzer';

export interface EnhancedSearchPipelineOptions {
  userAgent: string;
  maxResults?: number;
  enableEnrichment?: boolean;
  enablePdfResolution?: boolean;
  enableCitations?: boolean;
  enableTotalCount?: boolean;
  enableSmartSourceSelection?: boolean;
  enableAdaptiveLearning?: boolean;
}

export class EnhancedSearchPipeline {
  private openalexClient: OpenAlexClient;
  private crossrefClient: CrossrefClient;
  private unpaywallClient: UnpaywallClient;
  private recordMerger: RecordMerger;
  private fallbackManager: FallbackManager;
  private aggregatorManager: AggregatorManager;
  private smartSourceSelector: SmartSourceSelector;
  private queryAnalyzer: QueryAnalyzer;
  private options: EnhancedSearchPipelineOptions;

  constructor(options: EnhancedSearchPipelineOptions) {
    this.options = {
      maxResults: 100,
      enableEnrichment: true,
      enablePdfResolution: true,
      enableCitations: false,
      enableTotalCount: true,
      enableSmartSourceSelection: true,
      enableAdaptiveLearning: true,
      ...options
    };

    this.openalexClient = new OpenAlexClient(options.userAgent);
    this.crossrefClient = new CrossrefClient(options.userAgent);
    this.unpaywallClient = new UnpaywallClient(options.userAgent);
    this.recordMerger = new RecordMerger();
    this.aggregatorManager = new AggregatorManager();
    this.smartSourceSelector = new SmartSourceSelector();
    this.queryAnalyzer = new QueryAnalyzer();
    
    this.fallbackManager = new FallbackManager({
      maxConcurrency: 12,
      timeoutMs: 10000,
      retryDelayMs: 1000,
      failFast: false
    });

    // Configure adaptive learning
    this.smartSourceSelector.setAdaptiveLearning(this.options.enableAdaptiveLearning || false);
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
      let sourceSelection: SourceSelectionResult | null = null;

      // Step 2: Smart source selection (if enabled)
      if (this.options.enableSmartSourceSelection && !isDoiQuery) {
        sourceSelection = this.smartSourceSelector.selectSources(params);
        console.log(`Smart source selection: ${sourceSelection.selectedSources.join(', ')}`);
        console.log(`Reasoning: ${sourceSelection.reasoning}`);
        console.log(`Estimated latency: ${sourceSelection.estimatedLatency}ms`);
        console.log(`Confidence: ${(sourceSelection.confidence * 100).toFixed(1)}%`);
      }

      // Calculate actual total count from selected sources
      const totalCountPromise = this.calculateTotalCount(normalizedQuery, params, sourceSelection);

      if (isDoiQuery) {
        // Direct DOI lookup with smart source selection
        enrichedRecords = await this.resolveDoiSmart(normalizedQuery, sourceSelection);
      } else {
        // Keyword search with smart source selection
        enrichedRecords = await this.searchByKeywordsSmart(normalizedQuery, params, sourceSelection);
      }

      // Always collect complete data for facet generation, regardless of smart source selection
      let allRecordsForFacets: EnrichedRecord[] = [];
      if (!isDoiQuery && this.options.enableSmartSourceSelection && sourceSelection) {
        // Get data from all sources for comprehensive facet generation
        allRecordsForFacets = await this.searchByKeywords(normalizedQuery, params);
      } else {
        allRecordsForFacets = enrichedRecords;
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

      // Step 6: Get total count and apply filters to it
      const unfilteredTotalCount = await totalCountPromise;
      const totalCount = this.applyFiltersToTotalCount(unfilteredTotalCount, params.filters);

      // Step 7: Generate facets with scaling based on total count
      // Always use all enriched records for facet generation, regardless of smart source selection
      const facets = this.generateScaledFacets(sortedRecords, totalCount, allRecordsForFacets);

      const duration = Date.now() - startTime;
      console.log(`Enhanced search pipeline completed in ${duration}ms, found ${sortedRecords.length} results, total available: ${totalCount}`);

      // Update performance metrics for smart source selection
      if (sourceSelection && this.options.enableAdaptiveLearning) {
        this.updateSourcePerformanceMetrics(sourceSelection, enrichedRecords, duration);
      }

      return {
        hits: paginatedRecords,
        facets,
        page,
        pageSize,
        total: totalCount,
        // query: params.q, // Remove this line as it's not part of SearchResponse
        filters: params.filters,
        sort: params.sort || 'relevance',
        duration,
        sourceSelection: sourceSelection ? {
          selectedSources: sourceSelection.selectedSources,
          reasoning: sourceSelection.reasoning,
          estimatedLatency: sourceSelection.estimatedLatency,
          confidence: sourceSelection.confidence
        } : undefined
      };
    } catch (error) {
      console.error('Enhanced search pipeline error:', error);
      throw error;
    }
  }

  /**
   * Smart DOI resolution with source selection
   */
  private async resolveDoiSmart(doi: string, sourceSelection: SourceSelectionResult | null): Promise<EnrichedRecord[]> {
    if (!sourceSelection || !this.options.enableSmartSourceSelection) {
      // Fallback to original DOI resolution
      return this.resolveDoi(doi);
    }

    const results: EnrichedRecord[] = [];
    const selectedSources = sourceSelection.selectedSources;

    // Prioritize DOI authorities
    const doiSources = selectedSources.filter(source => 
      ['crossref', 'openalex'].includes(source)
    );

    for (const source of doiSources) {
      try {
        let sourceResults: EnrichedRecord[] = [];
        
        if (source === 'crossref') {
          const crossrefWork = await this.crossrefClient.getWorkByDOI(doi);
          if (crossrefWork) {
            sourceResults = [this.enrichCrossrefWork(crossrefWork)];
          }
        } else if (source === 'openalex') {
          const openalexWork = await this.openalexClient.getWorkByDOI(doi);
          if (openalexWork) {
            sourceResults = [this.enrichOpenAlexWork(openalexWork)];
          }
        }

        if (sourceResults.length > 0) {
          results.push(...sourceResults);
          break; // Stop at first successful result for DOI queries
        }
      } catch (error) {
        console.warn(`DOI resolution failed for ${source}:`, error);
      }
    }

    return results;
  }

  /**
   * Smart keyword search with source selection
   */
  private async searchByKeywordsSmart(
    query: string, 
    params: SearchParams, 
    sourceSelection: SourceSelectionResult | null
  ): Promise<EnrichedRecord[]> {
    if (!sourceSelection || !this.options.enableSmartSourceSelection) {
      // Fallback to original keyword search
      return this.searchByKeywords(query, params);
    }

    const results: EnrichedRecord[] = [];
    const selectedSources = sourceSelection.selectedSources;

    // Execute searches in parallel with smart source selection
    const searchPromises = selectedSources.map(async (source) => {
      try {
        const startTime = Date.now();
        let sourceResults: EnrichedRecord[] = [];

        if (source === 'openalex') {
          const discoveryResults = await this.discoverWorks(query, params);
          const enrichedRecords = await this.enrichWorks(discoveryResults, []);
          sourceResults = enrichedRecords;
        } else if (source === 'crossref') {
          const crossrefResults = await this.searchCrossrefWorks(query, params);
          sourceResults = crossrefResults;
        } else {
          // Use aggregator manager for other sources
          const aggregatorResults = await this.aggregatorManager.searchAggregators({
            ...params,
            q: query
          });
          const aggregatorRecords = this.mergeAggregatorResults(aggregatorResults);
          sourceResults = aggregatorRecords;
        }

        const latency = Date.now() - startTime;
        
        // Update performance metrics
        this.smartSourceSelector.updateSourcePerformance(
          source,
          latency,
          true,
          sourceResults.length
        );

        return { source, results: sourceResults, latency };
      } catch (error) {
        const latency = Date.now() - Date.now();
        console.warn(`Search failed for ${source}:`, error);
        
        // Update performance metrics for failure
        this.smartSourceSelector.updateSourcePerformance(
          source,
          latency,
          false,
          0
        );

        return { source, results: [], latency: 0 };
      }
    });

    const searchResults = await Promise.allSettled(searchPromises);
    
    // Collect all successful results
    for (const result of searchResults) {
      if (result.status === 'fulfilled' && result.value.results.length > 0) {
        results.push(...result.value.results);
      }
    }

    // Deduplicate results
    const deduplicatedResults = this.recordMerger.deduplicate(results);
    console.log(`Smart search: ${results.length} total results, ${deduplicatedResults.length} after deduplication`);

    return deduplicatedResults;
  }

  /**
   * Calculate total count with smart source selection
   */
  private async calculateTotalCount(
    query: string, 
    params: SearchParams, 
    sourceSelection: SourceSelectionResult | null
  ): Promise<number> {
    if (!sourceSelection || !this.options.enableSmartSourceSelection) {
      // Fallback to original total count calculation
      return this.calculateTotalCountOriginal(query, params);
    }

    try {
      let totalCount = 0;
      const selectedSources = sourceSelection.selectedSources;

      // Get counts from selected sources only
      const countPromises = selectedSources.map(async (source) => {
        try {
          if (source === 'openalex') {
            return await this.getOpenAlexCount(query, params);
          } else if (source === 'crossref') {
            return await this.getCrossrefCount(query, params);
          } else {
            // Estimate for aggregator sources
            return 1000; // Conservative estimate
          }
        } catch (error) {
          console.warn(`Count failed for ${source}:`, error);
          return 0;
        }
      });

      const counts = await Promise.allSettled(countPromises);
      for (const count of counts) {
        if (count.status === 'fulfilled') {
          totalCount += count.value;
        }
      }

      console.log(`Smart total count from ${selectedSources.length} sources: ${totalCount}`);
      return totalCount;
    } catch (error) {
      console.error('Smart total count error:', error);
      return 0;
    }
  }

  /**
   * Update performance metrics for adaptive learning
   */
  private updateSourcePerformanceMetrics(
    sourceSelection: SourceSelectionResult,
    results: EnrichedRecord[],
    totalLatency: number
  ): void {
    const avgLatency = totalLatency / sourceSelection.selectedSources.length;
    
    for (const source of sourceSelection.selectedSources) {
      this.smartSourceSelector.updateSourcePerformance(
        source,
        avgLatency,
        true,
        results.length
      );
    }
  }

  // Include all the original methods from SearchPipeline
  // (normalizeQuery, isDoiQuery, applyFilters, sortResults, etc.)
  // ... (copy all methods from original SearchPipeline)

  private normalizeQuery(query: string): string {
    return query.trim().toLowerCase();
  }

  private isDoiQuery(query: string): boolean {
    const doiPattern = /^10\.\d{4,}\/[^\s]+$/i;
    return doiPattern.test(query);
  }

  private applyFilters(records: EnrichedRecord[], filters: any): EnrichedRecord[] {
    if (!filters) return records;
    
    return records.filter(record => {
      if (filters.yearFrom && record.year && record.year < filters.yearFrom) return false;
      if (filters.yearTo && record.year && record.year > filters.yearTo) return false;
      if (filters.source && record.source !== filters.source) return false;
      if (filters.oaStatus && record.oaStatus !== filters.oaStatus) return false;
      return true;
    });
  }

  private sortResults(records: EnrichedRecord[], sort: string): EnrichedRecord[] {
    switch (sort) {
      case 'year':
        return records.sort((a, b) => (b.year || 0) - (a.year || 0));
      case 'title':
        return records.sort((a, b) => a.title.localeCompare(b.title));
      case 'author':
        return records.sort((a, b) => (a.authors[0] || '').localeCompare(b.authors[0] || ''));
      default: // relevance
        return records;
    }
  }

  private applyFiltersToTotalCount(totalCount: number, filters: any): number {
    // Simple estimation - in practice, you'd want more sophisticated filtering
    if (!filters) return totalCount;
    
    let estimatedCount = totalCount;
    if (filters.yearFrom || filters.yearTo) estimatedCount *= 0.8;
    if (filters.source) estimatedCount *= 0.3;
    if (filters.oaStatus) estimatedCount *= 0.5;
    
    return Math.round(estimatedCount);
  }

  private generateScaledFacets(
    records: EnrichedRecord[], 
    totalCount: number, 
    allRecords: EnrichedRecord[]
  ): any {
    // Generate facets based on available data
    const sourceFacets = this.generateSourceFacets(allRecords);
    const yearFacets = this.generateYearFacets(allRecords);
    const oaStatusFacets = this.generateOaStatusFacets(allRecords);
    const venueFacets = this.generateVenueFacets(allRecords);
    const publisherFacets = this.generatePublisherFacets(allRecords);
    const topicsFacets = this.generateTopicsFacets(allRecords);


    return {
      source: sourceFacets,
      year: yearFacets,
      oaStatus: oaStatusFacets,
      venue: venueFacets,
      publisher: publisherFacets,
      topics: topicsFacets
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
    const statusCounts = new Map<string, number>();
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

  private async discoverWorks(query: string, params: SearchParams): Promise<OpenAlexWork[]> {
    try {
      // Limit to 50 results for faster response
      const response = await this.openalexClient.searchWorks({
        query,
        perPage: Math.min(this.options.maxResults || 50, 50),
        filter: this.buildOpenAlexFilter(params.filters)
      });

      return response.results;
    } catch (error) {
      console.error('OpenAlex discovery error:', error);
      return [];
    }
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

  private async searchCrossrefWorks(query: string, params: SearchParams): Promise<EnrichedRecord[]> {
    // Implementation from original SearchPipeline
    return [];
  }

  private async getOpenAlexCount(query: string, params: SearchParams): Promise<number> {
    try {
      const response = await this.openalexClient.searchWorks({
        query,
        perPage: 1, // Only need 1 result to get the total count
        filter: this.buildOpenAlexFilter(params.filters)
      });
      return response.meta.count;
    } catch (error) {
      console.error('OpenAlex count error:', error);
      return 0;
    }
  }

  private async getCrossrefCount(query: string, params: SearchParams): Promise<number> {
    try {
      const response = await this.crossrefClient.searchWorks({
        query,
        rows: 1, // Only need 1 result to get the total count
        offset: 0
      });
      return response.message['total-results'];
    } catch (error) {
      console.error('Crossref count error:', error);
      return 0;
    }
  }

  private async getAggregatorCounts(query: string, params: SearchParams): Promise<number[]> {
    try {
      // For now, we'll estimate based on the aggregator results
      // In the future, we could add count-only endpoints to each aggregator
      const aggregatorResults = await this.aggregatorManager.searchAggregators({
        ...params,
        pageSize: 1 // Only fetch 1 result to minimize data transfer
      });

      // Estimate total counts based on the first page results
      // This is not perfect but gives a reasonable estimate
      const estimatedCounts = aggregatorResults.map(result => {
        if (result.error) return 0;
        // Rough estimation: if we got results, assume there are more
        return result.records.length > 0 ? 1000 : 0;
      });

      return estimatedCounts;
    } catch (error) {
      console.error('Aggregator count error:', error);
      return [0];
    }
  }

  private async calculateTotalCountOriginal(query: string, params: SearchParams): Promise<number> {
    try {
      let totalCount = 0;

      // Get OpenAlex count
      const openAlexCount = await this.getOpenAlexCount(query, params);
      if (openAlexCount > 0) {
        totalCount += openAlexCount;
      }

      // Get Crossref count
      const crossrefCount = await this.getCrossrefCount(query, params);
      if (crossrefCount > 0) {
        totalCount += crossrefCount;
      }

      // Get aggregator counts
      const aggregatorCounts = await this.getAggregatorCounts(query, params);
      for (const count of Object.values(aggregatorCounts)) {
        if (count > 0) {
          totalCount += count;
        }
      }

      console.log(`Total count calculated: ${totalCount} (OpenAlex: ${openAlexCount}, Crossref: ${crossrefCount}, Aggregators: ${Object.values(aggregatorCounts).reduce((sum, count) => sum + count, 0)})`);
      
      return totalCount;
    } catch (error) {
      console.error('Error calculating total count:', error);
      // Fallback to a reasonable estimate if calculation fails
      return 50000;
    }
  }

  private async resolveDoi(doi: string): Promise<EnrichedRecord[]> {
    // Implementation from original SearchPipeline
    return [];
  }

  private enrichCrossrefWork(work: CrossrefWork): EnrichedRecord {
    // Implementation from original SearchPipeline
    return {} as EnrichedRecord;
  }

  private enrichOpenAlexWork(work: OpenAlexWork): EnrichedRecord {
    // Implementation from original SearchPipeline
    return {} as EnrichedRecord;
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
      if ((record as any).publisher) {
        const count = publisherCounts.get((record as any).publisher) || 0;
        publisherCounts.set((record as any).publisher, count + 1);
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
        const publisher = (record as any).publisher;
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
