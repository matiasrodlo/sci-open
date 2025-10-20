import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

/**
 * PLOS (Public Library of Science) API Integration
 * Access to 7 open access journals with full-text search
 * API Docs: https://api.plos.org/
 * Journals: PLOS ONE, PLOS Biology, PLOS Medicine, PLOS Computational Biology,
 *           PLOS Genetics, PLOS Pathogens, PLOS Neglected Tropical Diseases
 */

interface PLOSDoc {
  id: string;
  title?: string;
  title_display?: string;
  author?: string[];
  author_display?: string[];
  abstract?: string[];
  publication_date?: string;
  journal?: string;
  article_type?: string;
  doi?: string | string[]; // PLOS returns DOI as an array
  score?: number;
}

interface PLOSResponse {
  response: {
    numFound: number;
    start: number;
    docs: PLOSDoc[];
  };
}

export class PLOSConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.plos.org/search') {
    this.baseUrl = baseUrl;
  }

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    const { doi, titleOrKeywords, yearFrom, yearTo } = params;

    if (!doi && !titleOrKeywords) {
      return [];
    }

    try {
      let query = '';
      
      if (doi) {
        // Search by DOI
        query = `doi:"${doi}"`;
      } else if (titleOrKeywords) {
        // Search in title, abstract, and full text
        // Use everything query for comprehensive search
        query = `everything:${titleOrKeywords}`;
      } else {
        return [];
      }

      // Add year filter if provided
      if (yearFrom || yearTo) {
        const startYear = yearFrom || 2000;
        const endYear = yearTo || new Date().getFullYear();
        query += ` AND publication_date:[${startYear}-01-01T00:00:00Z TO ${endYear}-12-31T23:59:59Z]`;
      }

      const response = await axios.get<PLOSResponse>(this.baseUrl, {
        params: {
          q: query,
          rows: 50,
          start: 0,
          wt: 'json',
          fl: 'id,title,title_display,author,author_display,abstract,publication_date,journal,article_type,doi,score',
          // Only research articles (exclude corrections, retractions, etc.)
          fq: 'article_type:"Research Article" OR article_type:"Meta-Analysis" OR article_type:"Systematic Review"'
        },
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.data.response || !response.data.response.docs) {
        return [];
      }

      const docs = response.data.response.docs;
      console.log(`PLOS returned ${docs.length} results for query: ${query.substring(0, 50)}`);
      
      return docs.map(doc => this.normalizeResult(doc));
    } catch (error: any) {
      if (error.response?.status !== 404) {
        console.error('PLOS search error:', error.message);
      }
      return [];
    }
  }

  private normalizeResult(doc: PLOSDoc): OARecord {
    // Extract title
    const title = doc.title_display || doc.title || '';

    // Extract authors
    const authors = doc.author_display || doc.author || [];

    // Extract abstract
    const abstract = Array.isArray(doc.abstract) ? doc.abstract[0] : doc.abstract;

    // Extract year from publication_date (format: 2024-01-15T00:00:00Z)
    let year: number | undefined;
    if (doc.publication_date) {
      const yearMatch = doc.publication_date.match(/^(\d{4})/);
      if (yearMatch) {
        year = parseInt(yearMatch[1], 10);
      }
    }

    // Extract DOI - PLOS returns it as an array
    const doi = Array.isArray(doc.doi) ? doc.doi[0] : doc.doi;

    // Extract journal name
    const venue = doc.journal;

    // PLOS ID format: 10.1371/journal.pone.0123456
    const plosId = doc.id;

    // Construct PDF URL - PLOS provides direct PDF access
    // Format: https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0123456&type=printable
    const bestPdfUrl = doi ? `https://journals.plos.org/plosone/article/file?id=${doi}&type=printable` : undefined;

    // Construct landing page
    const landingPage = doi ? `https://doi.org/${doi}` : undefined;

    // Determine OA status - all PLOS papers are open access
    const oaStatus: 'published' = 'published';

    // Extract topics from article type
    const topics: string[] = [];
    if (doc.article_type) {
      topics.push(doc.article_type);
    }

    return {
      id: `plos:${plosId}`,
      doi,
      title,
      authors,
      year,
      venue,
      abstract,
      source: 'core', // Map to 'core' as PLOS is a publisher aggregator
      sourceId: plosId,
      oaStatus,
      bestPdfUrl,
      landingPage,
      topics,
      language: 'en',
      createdAt: doc.publication_date || new Date().toISOString(),
    };
  }
}

