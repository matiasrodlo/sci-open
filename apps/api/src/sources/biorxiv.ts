import axios from 'axios';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';

/**
 * bioRxiv and medRxiv API Integration
 * Preprint servers for biology and medicine
 * API Docs: https://api.biorxiv.org/
 *
 * The API has no keyword endpoint. Keyword search is therefore a scan of a
 * recent date window, filtered client-side, so it only ever surfaces preprints
 * posted in the last RECENT_WINDOW_DAYS days. That is a real coverage limit,
 * not a bug to work around here.
 */

// The details endpoint returns a fixed 30 records per cursor page, and cursor
// is a record offset that advances in the same steps.
const PAGE_SIZE = 30;

// Ceiling on pages read per server. Deep pagination is one request per 30
// records, so this bounds a keyword scan to a request count the aggregator's
// timeout budget can absorb.
const MAX_PAGES_PER_SERVER = 5;

// How far back a keyword scan reads
const RECENT_WINDOW_DAYS = 30;

const SERVERS = ['biorxiv', 'medrxiv'] as const;
type BiorxivServer = (typeof SERVERS)[number];

interface BiorxivResult {
  doi: string;
  title: string;
  authors: string;
  author_corresponding?: string;
  date: string;
  version?: string;
  type?: string;
  category?: string;
  jatsxml?: string;
  abstract?: string;
  published?: string;
  server: 'biorxiv' | 'medrxiv';
}

interface BiorxivResponse {
  messages: Array<{
    status: string;
    count: string;
    total: string;
  }>;
  collection: BiorxivResult[];
}

export class BiorxivConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.biorxiv.org') {
    this.baseUrl = baseUrl;
  }

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50 } = params;

    try {
      const results: OARecord[] = [];

      // If DOI is provided, search by DOI
      if (doi) {
        results.push(...await this.searchByDoi(doi));
      }

      // Both servers are separate endpoints, so they are read concurrently
      // rather than one after the other
      if (titleOrKeywords) {
        const perServer = await Promise.all(
          SERVERS.map(server =>
            this.searchByKeywords(titleOrKeywords, server, limit, yearFrom, yearTo)
          )
        );
        for (const serverResults of perServer) {
          results.push(...serverResults);
        }
      }

      // The API exposes date windows, not a searchable index, so it reports
      // no corpus-wide hit count for a keyword query.
      return { records: results.slice(0, Math.max(limit, 1)) };
    } catch (error) {
      console.error('bioRxiv/medRxiv search error:', error);
      return { records: [] };
    }
  }

  private async searchByDoi(doi: string): Promise<OARecord[]> {
    try {
      const results: OARecord[] = [];

      for (const server of SERVERS) {
        try {
          const response = await axios.get<BiorxivResponse>(
            `${this.baseUrl}/details/${server}/${doi}`,
            { timeout: 5000 }
          );

          if (response.data.collection && response.data.collection.length > 0) {
            const normalized = response.data.collection.map(item =>
              this.normalizeResult(item, server)
            );
            results.push(...normalized);
          }
        } catch (error: any) {
          // 404 is expected if DOI not found in this server
          if (error.response?.status !== 404) {
            console.error(`${server} DOI search error:`, error.message);
          }
        }
      }

      return results;
    } catch (error) {
      console.error('bioRxiv/medRxiv DOI search error:', error);
      return [];
    }
  }

  private async searchByKeywords(
    keywords: string,
    server: BiorxivServer,
    limit: number,
    yearFrom?: number,
    yearTo?: number
  ): Promise<OARecord[]> {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - RECENT_WINDOW_DAYS);

    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    const windowUrl = `${this.baseUrl}/details/${server}/${startDateStr}/${endDateStr}`;

    // The filter runs client-side, so the corpus it sees is only as wide as the
    // number of pages read. One page is 30 records out of thousands in the
    // window, which matches almost nothing — read up to the caller's limit,
    // bounded by MAX_PAGES_PER_SERVER.
    const pageCount = Math.min(
      Math.max(Math.ceil(Math.max(limit, 1) / PAGE_SIZE), 1),
      MAX_PAGES_PER_SERVER
    );

    const pages = await Promise.all(
      Array.from({ length: pageCount }, (_, i) => this.fetchWindowPage(windowUrl, i * PAGE_SIZE, server))
    );

    // The API has no query language, so matching happens here. Every term has
    // to appear somewhere in the title or abstract, rather than the whole query
    // appearing as one contiguous string — a phrase match means a multi-word
    // query such as "crispr gene editing" matches nothing, since those words
    // rarely sit adjacent in that order.
    const terms = keywords.toLowerCase().split(/\s+/).filter(Boolean);
    const matched: BiorxivResult[] = [];

    for (const page of pages) {
      for (const item of page) {
        const haystack = `${item.title ?? ''} ${item.abstract ?? ''}`.toLowerCase();

        if (!terms.every(term => haystack.includes(term))) continue;

        if (yearFrom || yearTo) {
          const itemYear = new Date(item.date).getFullYear();
          if (yearFrom && itemYear < yearFrom) continue;
          if (yearTo && itemYear > yearTo) continue;
        }

        matched.push(item);
      }
    }

    return matched.slice(0, Math.max(limit, 1)).map(item => this.normalizeResult(item, server));
  }

  /**
   * Read one cursor page of the date window. A page that fails is dropped
   * rather than failing the whole scan, so a single bad response still leaves
   * the other pages usable.
   */
  private async fetchWindowPage(
    windowUrl: string,
    cursor: number,
    server: BiorxivServer
  ): Promise<BiorxivResult[]> {
    try {
      const response = await axios.get<BiorxivResponse>(windowUrl, {
        // This endpoint answers in ~4s on its own and slower while the rest of
        // the sweep is competing for the network. At 10s every page timed out
        // during a full sweep and the source returned nothing; the aggregator
        // allows this connector 20s in total.
        timeout: 15000,
        params: { cursor, format: 'json' }
      });

      return response.data.collection ?? [];
    } catch (error: any) {
      // A cursor past the end of the window 404s, which is expected
      if (error.response?.status !== 404) {
        console.error(`${server} keyword search error at cursor ${cursor}:`, error.message);
      }
      return [];
    }
  }

  private normalizeResult(result: BiorxivResult, server: BiorxivServer): OARecord {
    // Parse authors string (format: "LastName1, FirstName1; LastName2, FirstName2")
    const authors = result.authors
      ? result.authors.split(';').map(author => author.trim()).filter(Boolean)
      : [];

    // Extract year from date
    const year = result.date ? new Date(result.date).getFullYear() : undefined;

    // Construct PDF URL
    const pdfUrl = `https://www.${server}.org/content/${result.doi}v${result.version || '1'}.full.pdf`;

    return {
      id: `${server}:${result.doi}`,
      doi: result.doi,
      title: result.title,
      authors,
      year,
      venue: server === 'biorxiv' ? 'bioRxiv' : 'medRxiv',
      abstract: result.abstract,
      source: server,
      sourceId: result.doi,
      oaStatus: 'preprint',
      bestPdfUrl: pdfUrl,
      landingPage: `https://www.${server}.org/content/${result.doi}v${result.version || '1'}`,
      topics: result.category ? [result.category] : [],
      language: 'en',
      createdAt: result.date || new Date().toISOString(),
      updatedAt: result.published || result.date,
    };
  }
}


