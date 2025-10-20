import { OARecord } from '@open-access-explorer/shared';

export interface EnrichedRecord extends OARecord {
  // Enhanced fields from enrichment
  canonicalTitle?: string;
  canonicalAuthors?: string[];
  canonicalYear?: number;
  canonicalVenue?: string;
  canonicalPublisher?: string;
  canonicalAbstract?: string;
  
  // Licensing information
  license?: string;
  licenseUrl?: string;
  isRedistributable?: boolean;
  
  // PDF information
  pdfUrl?: string;
  pdfSource?: string;
  pdfVersion?: string;
  
  // Citation information
  citationCount?: number;
  referenceCount?: number;
  
  // Source metadata
  sourceMetadata?: Record<string, any>;
}

export interface MergeOptions {
  preferCanonical?: boolean;
  preferPublisherPdf?: boolean;
  preferPublishedVersion?: boolean;
  maxSources?: number;
}

export class RecordMerger {
  private options: MergeOptions;

  constructor(options: MergeOptions = {}) {
    this.options = {
      preferCanonical: true,
      preferPublisherPdf: true,
      preferPublishedVersion: true,
      maxSources: 5,
      ...options
    };
  }

  /**
   * Merge multiple records with the same DOI into a single enriched record
   */
  mergeRecords(records: OARecord[]): EnrichedRecord {
    if (records.length === 0) {
      throw new Error('Cannot merge empty record list');
    }

    if (records.length === 1) {
      return this.enrichRecord(records[0]);
    }

    // Group by DOI for deduplication
    const doiGroups = new Map<string, OARecord[]>();
    const nonDoiRecords: OARecord[] = [];

    for (const record of records) {
      if (record.doi) {
        const doi = this.normalizeDOI(record.doi);
        if (!doiGroups.has(doi)) {
          doiGroups.set(doi, []);
        }
        doiGroups.get(doi)!.push(record);
      } else {
        nonDoiRecords.push(record);
      }
    }

    // Merge DOI groups
    const mergedRecords: EnrichedRecord[] = [];
    for (const [doi, group] of doiGroups) {
      mergedRecords.push(this.mergeDoiGroup(doi, group));
    }

    // Add non-DOI records as-is
    for (const record of nonDoiRecords) {
      mergedRecords.push(this.enrichRecord(record));
    }

    // If we have multiple merged records, pick the best one
    if (mergedRecords.length === 1) {
      return mergedRecords[0];
    }

    return this.selectBestRecord(mergedRecords);
  }

  /**
   * Merge a group of records with the same DOI
   */
  private mergeDoiGroup(doi: string, records: OARecord[]): EnrichedRecord {
    // Sort records by source priority
    const sortedRecords = this.sortBySourcePriority(records);
    const primaryRecord = sortedRecords[0];

    // Start with the primary record
    const merged: EnrichedRecord = this.enrichRecord(primaryRecord);

    // Merge fields from other records
    for (let i = 1; i < sortedRecords.length; i++) {
      const record = sortedRecords[i];
      this.mergeFields(merged, record);
    }

    // Ensure DOI is normalized
    merged.doi = doi;

    return merged;
  }

  /**
   * Sort records by source priority (canonical sources first)
   */
  private sortBySourcePriority(records: OARecord[]): OARecord[] {
    const sourcePriority: Record<string, number> = {
      'crossref': 1,    // Highest priority - canonical metadata
      'openalex': 2,    // High priority - comprehensive data
      'unpaywall': 3,   // High priority - OA resolution
      'europepmc': 4,   // Good priority - biomedical focus
      'core': 5,        // Good priority - repository aggregator
      'openaire': 6,    // Good priority - EU research
      'plos': 7,        // Publisher priority
      'mdpi': 8,        // Publisher priority
      'elife': 9,       // Publisher priority
      'frontiers': 10,  // Publisher priority
      'arxiv': 11,      // Repository priority
      'biorxiv': 12,    // Repository priority
      'medrxiv': 13,    // Repository priority
      'zenodo': 14,     // Repository priority
      'osf': 15,        // Repository priority
      'hal': 16,        // Repository priority
      'scielo': 17,     // Regional priority
      'redalyc': 18,    // Regional priority
      'doaj': 19,       // Directory priority
      'ncbi': 20,       // Lower priority - limited metadata
      'opencitations': 21, // Lowest priority - citations only
    };

    return records.sort((a, b) => {
      const priorityA = sourcePriority[a.source] || 100;
      const priorityB = sourcePriority[b.source] || 100;
      return priorityA - priorityB;
    });
  }

  /**
   * Merge fields from a secondary record into the primary record
   */
  private mergeFields(primary: EnrichedRecord, secondary: OARecord): void {
    // Merge title (prefer canonical if available)
    if (this.options.preferCanonical && !primary.canonicalTitle && secondary.title) {
      primary.canonicalTitle = secondary.title;
    } else if (!primary.title && secondary.title) {
      primary.title = secondary.title;
    }

    // Merge authors (prefer canonical if available)
    if (this.options.preferCanonical && !primary.canonicalAuthors && secondary.authors.length > 0) {
      primary.canonicalAuthors = secondary.authors;
    } else if (primary.authors.length === 0 && secondary.authors.length > 0) {
      primary.authors = secondary.authors;
    }

    // Merge year (prefer canonical if available)
    if (this.options.preferCanonical && !primary.canonicalYear && secondary.year) {
      primary.canonicalYear = secondary.year;
    } else if (!primary.year && secondary.year) {
      primary.year = secondary.year;
    }

    // Merge venue (prefer canonical if available)
    if (this.options.preferCanonical && !primary.canonicalVenue && secondary.venue) {
      primary.canonicalVenue = secondary.venue;
    } else if (!primary.venue && secondary.venue) {
      primary.venue = secondary.venue;
    }

    // Merge abstract (prefer canonical if available)
    if (this.options.preferCanonical && !primary.canonicalAbstract && secondary.abstract) {
      primary.canonicalAbstract = secondary.abstract;
    } else if (!primary.abstract && secondary.abstract) {
      primary.abstract = secondary.abstract;
    }

    // Merge topics (combine unique topics)
    if (secondary.topics && secondary.topics.length > 0) {
      const existingTopics = new Set(primary.topics || []);
      const newTopics = secondary.topics.filter(topic => !existingTopics.has(topic));
      primary.topics = [...(primary.topics || []), ...newTopics];
    }

    // Merge PDF URL (prefer publisher PDFs)
    if (secondary.bestPdfUrl) {
      if (this.options.preferPublisherPdf && secondary.source.includes('publisher')) {
        primary.pdfUrl = secondary.bestPdfUrl;
        primary.pdfSource = secondary.source;
      } else if (!primary.pdfUrl) {
        primary.pdfUrl = secondary.bestPdfUrl;
        primary.pdfSource = secondary.source;
      }
    }

    // Merge landing page (prefer canonical)
    if (!primary.landingPage && secondary.landingPage) {
      primary.landingPage = secondary.landingPage;
    }
  }

  /**
   * Select the best record from multiple candidates
   */
  private selectBestRecord(records: EnrichedRecord[]): EnrichedRecord {
    // Score records based on completeness and quality
    const scoredRecords = records.map(record => ({
      record,
      score: this.scoreRecord(record)
    }));

    // Sort by score (highest first)
    scoredRecords.sort((a, b) => b.score - a.score);

    return scoredRecords[0].record;
  }

  /**
   * Score a record based on completeness and quality
   */
  private scoreRecord(record: EnrichedRecord): number {
    let score = 0;

    // Basic fields
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

    // Licensing information
    if (record.license) score += 5;
    if (record.isRedistributable) score += 3;

    // Citation information
    if (record.citationCount) score += 3;
    if (record.referenceCount) score += 2;

    // Source quality bonus
    const sourceBonus: Record<string, number> = {
      'crossref': 10,
      'openalex': 8,
      'unpaywall': 7,
      'europepmc': 6,
      'core': 5,
      'openaire': 5,
      'plos': 4,
      'mdpi': 4,
      'elife': 4,
      'frontiers': 4,
      'arxiv': 3,
      'biorxiv': 3,
      'medrxiv': 3,
      'zenodo': 3,
      'osf': 3,
      'hal': 3,
      'scielo': 2,
      'redalyc': 2,
      'doaj': 2,
      'ncbi': 1,
    };

    score += sourceBonus[record.source] || 0;

    return score;
  }

  /**
   * Enrich a single record with additional metadata
   */
  private enrichRecord(record: OARecord): EnrichedRecord {
    return {
      ...record,
      canonicalTitle: record.title,
      canonicalAuthors: record.authors,
      canonicalYear: record.year,
      canonicalVenue: record.venue,
      canonicalAbstract: record.abstract,
      pdfUrl: record.bestPdfUrl,
      pdfSource: record.source,
      isRedistributable: this.isRedistributable(record),
    };
  }

  /**
   * Check if a record is redistributable based on license
   */
  private isRedistributable(record: OARecord): boolean {
    // This would be enhanced with actual license checking
    // For now, assume most open access content is redistributable
    return record.oaStatus === 'published' || record.oaStatus === 'preprint';
  }

  /**
   * Normalize DOI for consistent comparison
   */
  private normalizeDOI(doi: string): string {
    return doi.toLowerCase().trim().replace(/^https?:\/\/doi\.org\//, '');
  }

  /**
   * Deduplicate records by DOI
   */
  deduplicate(records: OARecord[]): EnrichedRecord[] {
    return this.deduplicateByDOI(records);
  }

  /**
   * Deduplicate records by DOI
   */
  deduplicateByDOI(records: OARecord[]): EnrichedRecord[] {
    const doiGroups = new Map<string, OARecord[]>();
    const nonDoiRecords: OARecord[] = [];

    // Group records by DOI
    for (const record of records) {
      if (record.doi) {
        const doi = this.normalizeDOI(record.doi);
        if (!doiGroups.has(doi)) {
          doiGroups.set(doi, []);
        }
        doiGroups.get(doi)!.push(record);
      } else {
        nonDoiRecords.push(record);
      }
    }

    const mergedRecords: EnrichedRecord[] = [];

    // Merge DOI groups
    for (const [doi, group] of doiGroups) {
      mergedRecords.push(this.mergeDoiGroup(doi, group));
    }

    // Add non-DOI records as-is
    for (const record of nonDoiRecords) {
      mergedRecords.push(this.enrichRecord(record));
    }

    return mergedRecords;
  }
}
