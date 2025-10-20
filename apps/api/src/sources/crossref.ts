import axios from 'axios';

/**
 * Crossref API Integration
 * Enriches paper metadata using DOIs
 * API Docs: https://api.crossref.org
 * No API key required for polite pool (with email in User-Agent)
 */

interface CrossrefWork {
  DOI: string;
  title?: string[];
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
  }>;
  'container-title'?: string[];
  published?: {
    'date-parts'?: number[][];
  };
  abstract?: string;
  URL?: string;
  link?: Array<{
    URL: string;
    'content-type': string;
    'intended-application': string;
  }>;
  publisher?: string;
  type?: string;
  'is-referenced-by-count'?: number;
  license?: Array<{
    URL: string;
  }>;
}

interface CrossrefResponse {
  status: string;
  'message-type': string;
  'message-version': string;
  message: CrossrefWork;
}

export class CrossrefEnricher {
  private baseUrl: string;
  private email: string;

  constructor(email: string = 'your-email@example.com', baseUrl: string = 'https://api.crossref.org') {
    this.baseUrl = baseUrl;
    this.email = email;
  }

  /**
   * Enrich a paper record using its DOI
   * Returns enrichment data or null if not found
   */
  async enrichByDoi(doi: string): Promise<{
    title?: string;
    authors?: string[];
    venue?: string;
    year?: number;
    abstract?: string;
    pdfUrl?: string;
    publisher?: string;
    citationCount?: number;
    license?: string;
  } | null> {
    if (!doi) {
      return null;
    }

    try {
      // Clean DOI (remove any prefixes)
      const cleanDoi = doi.replace(/^(doi:|https?:\/\/.*?doi\.org\/)/, '');

      const response = await axios.get<CrossrefResponse>(
        `${this.baseUrl}/works/${encodeURIComponent(cleanDoi)}`,
        {
          headers: {
            'User-Agent': `OpenAccessExplorer/1.0 (mailto:${this.email})`,
          },
          timeout: 5000,
        }
      );

      if (response.data.status !== 'ok' || !response.data.message) {
        return null;
      }

      const work = response.data.message;

      // Extract title
      const title = work.title?.[0];

      // Extract authors
      const authors = work.author?.map(author => {
        if (author.name) {
          return author.name;
        }
        const parts = [];
        if (author.given) parts.push(author.given);
        if (author.family) parts.push(author.family);
        return parts.join(' ');
      }).filter(Boolean) || [];

      // Extract venue (journal/conference)
      const venue = work['container-title']?.[0];

      // Extract year
      let year: number | undefined;
      const dateParts = work.published?.['date-parts']?.[0];
      if (dateParts && dateParts.length > 0) {
        year = dateParts[0];
      }

      // Extract abstract (often not available in Crossref)
      const abstract = work.abstract;

      // Extract PDF URL from links
      let pdfUrl: string | undefined;
      if (work.link) {
        const pdfLink = work.link.find(link => 
          link['content-type'] === 'application/pdf' ||
          link['intended-application'] === 'text-mining'
        );
        if (pdfLink) {
          pdfUrl = pdfLink.URL;
        }
      }

      // Extract publisher
      const publisher = work.publisher;

      // Extract citation count
      const citationCount = work['is-referenced-by-count'];

      // Extract license
      const license = work.license?.[0]?.URL;

      return {
        title,
        authors,
        venue,
        year,
        abstract,
        pdfUrl,
        publisher,
        citationCount,
        license,
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        // DOI not found in Crossref, this is expected for some DOIs
        return null;
      }
      console.error(`Crossref enrichment error for DOI ${doi}:`, error.message);
      return null;
    }
  }

  /**
   * Enrich multiple records in parallel with controlled concurrency
   * Returns a map of DOI -> enrichment data
   */
  async enrichBatch(
    dois: string[], 
    options: { 
      batchSize?: number;
      delayBetweenBatches?: number;
    } = {}
  ): Promise<Map<string, any>> {
    const { batchSize = 10, delayBetweenBatches = 100 } = options;
    const enrichmentMap = new Map();

    if (!this.email || this.email === 'your-email@example.com') {
      console.warn('Crossref: No valid email configured. Skipping enrichment for polite API access.');
      return enrichmentMap;
    }

    console.log(`Crossref: Starting enrichment for ${dois.length} DOIs (batches of ${batchSize})`);

    // Process in batches to avoid overwhelming the API
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < dois.length; i += batchSize) {
      const batch = dois.slice(i, i + batchSize);
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(dois.length / batchSize);

      const promises = batch.map(async (doi) => {
        try {
          const enrichment = await this.enrichByDoi(doi);
          if (enrichment) {
            enrichmentMap.set(doi, enrichment);
            successCount++;
            return { doi, success: true };
          }
          return { doi, success: false };
        } catch (error) {
          errorCount++;
          return { doi, success: false, error };
        }
      });

      await Promise.allSettled(promises);
      
      console.log(`Crossref: Batch ${batchNumber}/${totalBatches} complete (${successCount} enriched, ${errorCount} failed)`);
      
      // Be polite to Crossref API - add a small delay between batches
      if (i + batchSize < dois.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    console.log(`Crossref: Enrichment complete. ${successCount}/${dois.length} records enriched`);

    return enrichmentMap;
  }

  /**
   * Apply Crossref enrichment to an OARecord
   * Only fills in missing fields, never overwrites existing data
   */
  applyEnrichment(
    record: any,
    enrichment: {
      title?: string;
      authors?: string[];
      venue?: string;
      year?: number;
      abstract?: string;
      pdfUrl?: string;
      publisher?: string;
      citationCount?: number;
      license?: string;
    }
  ): void {
    // Only enrich missing fields
    if (!record.title && enrichment.title) {
      record.title = enrichment.title;
    }
    
    if ((!record.authors || record.authors.length === 0) && enrichment.authors && enrichment.authors.length > 0) {
      record.authors = enrichment.authors;
    }
    
    if (!record.venue && enrichment.venue) {
      record.venue = enrichment.venue;
    }
    
    if (!record.year && enrichment.year) {
      record.year = enrichment.year;
    }
    
    if (!record.abstract && enrichment.abstract) {
      record.abstract = enrichment.abstract;
    }
    
    if (!record.bestPdfUrl && enrichment.pdfUrl) {
      record.bestPdfUrl = enrichment.pdfUrl;
    }

    // Add additional metadata fields (these don't exist in OARecord by default)
    // Store as metadata if needed in the future
    if (enrichment.publisher) {
      (record as any).publisher = enrichment.publisher;
    }
    
    if (enrichment.citationCount !== undefined) {
      (record as any).citationCount = enrichment.citationCount;
    }
    
    if (enrichment.license) {
      (record as any).license = enrichment.license;
    }
  }
}

