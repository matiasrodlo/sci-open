import { OARecord, OASource } from '@open-access-explorer/shared';
import { log } from './logger';

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
   * Merge a group of records describing the same work, best source first
   */
  private mergeGroup(records: OARecord[]): EnrichedRecord {
    const sortedRecords = this.sortBySourcePriority(records);
    const merged: EnrichedRecord = this.enrichRecord(sortedRecords[0]);

    for (let i = 1; i < sortedRecords.length; i++) {
      this.mergeFields(merged, sortedRecords[i]);
    }

    return merged;
  }

  /**
   * Identity for records carrying no DOI. arXiv and other preprint sources
   * never supply one, so without a fallback key they bypass deduplication
   * entirely and the same paper can appear repeatedly in one result set.
   */
  private identityKey(record: OARecord): string {
    const title = (record.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (title) {
      return `title:${title}|${record.year ?? ''}`;
    }
    if (record.source && record.sourceId) {
      return `src:${record.source}:${record.sourceId}`.toLowerCase();
    }
    return `id:${record.id}`;
  }

  /**
   * Merge a group of records with the same DOI
   */
  private mergeDoiGroup(doi: string, records: OARecord[]): EnrichedRecord {
    const merged = this.mergeGroup(records);

    // Ensure DOI is normalized
    merged.doi = doi;

    return merged;
  }

  /**
   * Sort records by source priority (canonical sources first)
   */
  private sortBySourcePriority(records: OARecord[]): OARecord[] {
    // One entry per source that can actually produce a record. Ranked by how
    // trustworthy that source's metadata is when two of them describe the same
    // work: the record from the lower number supplies the merged fields.
    const sourcePriority: Record<OASource, number> = {
      'crossref': 1,       // canonical publisher metadata
      'openalex': 2,       // broad coverage, good structure
      'unpaywall': 3,      // authority on OA status and best PDF
      'europepmc': 4,      // rich biomedical records
      'core': 5,           // repository aggregator
      'openaire': 6,       // EU research aggregator
      'plos': 7,           // publisher, full text
      'arxiv': 8,          // preprints, no DOI
      'biorxiv': 9,        // preprints
      'medrxiv': 10,       // preprints
      'doaj': 11,          // directory, journal-level metadata
      'ncbi': 12,          // limited metadata, no DOI extracted yet
      'datacite': 13,      // registry items, sparse article metadata
      'opencitations': 14  // citation counts only
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

    // Merge PDF URL (prefer publisher PDFs). bestPdfUrl is the field consumers
    // read off OARecord, so it has to track pdfUrl — a record that only carried
    // the merged-in URL on pdfUrl reads as having no PDF at all.
    if (secondary.bestPdfUrl) {
      if (this.options.preferPublisherPdf && secondary.source.includes('publisher')) {
        primary.pdfUrl = secondary.bestPdfUrl;
        primary.bestPdfUrl = secondary.bestPdfUrl;
        primary.pdfSource = secondary.source;
      } else if (!primary.pdfUrl) {
        primary.pdfUrl = secondary.bestPdfUrl;
        primary.bestPdfUrl = primary.bestPdfUrl || secondary.bestPdfUrl;
        primary.pdfSource = secondary.source;
      }
    }

    // Merge landing page (prefer canonical)
    if (!primary.landingPage && secondary.landingPage) {
      primary.landingPage = secondary.landingPage;
    }
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
  deduplicateByDOI(records: OARecord[]): EnrichedRecord[] {
    log.debug(`[Dedup] Starting with ${records.length} records`);
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

    log.debug(`[Dedup] ${doiGroups.size} DOI groups, ${nonDoiRecords.length} non-DOI records`);

    const mergedRecords: EnrichedRecord[] = [];

    // Merge DOI groups
    for (const [doi, group] of doiGroups) {
      mergedRecords.push(this.mergeDoiGroup(doi, group));
    }

    // Add non-DOI records as-is
    for (const record of nonDoiRecords) {
      mergedRecords.push(this.enrichRecord(record));
    }

    log.debug(`[Dedup] Returning ${mergedRecords.length} merged records`);
    return mergedRecords;
  }

  /**
   * Deduplicate records by DOI and merge them
   */
  deduplicate(records: OARecord[]): EnrichedRecord[] {
    if (records.length === 0) {
      return [];
    }

    // Group records by DOI where there is one, and by title/year where there
    // is not, so that no source can contribute the same work twice
    const doiGroups = new Map<string, OARecord[]>();
    const nonDoiGroups = new Map<string, OARecord[]>();

    for (const record of records) {
      const group = record.doi ? doiGroups : nonDoiGroups;
      const key = record.doi ? this.normalizeDOI(record.doi) : this.identityKey(record);

      if (!group.has(key)) {
        group.set(key, []);
      }
      group.get(key)!.push(record);
    }

    const deduplicatedRecords: EnrichedRecord[] = [];

    for (const [doi, group] of doiGroups) {
      deduplicatedRecords.push(
        group.length === 1 ? this.enrichRecord(group[0]) : this.mergeDoiGroup(doi, group)
      );
    }

    for (const group of nonDoiGroups.values()) {
      deduplicatedRecords.push(
        group.length === 1 ? this.enrichRecord(group[0]) : this.mergeGroup(group)
      );
    }

    return deduplicatedRecords;
  }
}
