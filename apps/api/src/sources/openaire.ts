import axios from 'axios';
import { OARecord, SourceConnector, SourceSearchParams, SourceSearchResult } from '@open-access-explorer/shared';
import { log } from '../lib/logger';

// OpenAIRE serves at most 100 results per page
const MAX_PAGE_SIZE = 100;

/**
 * OpenAIRE API Integration
 * European open access infrastructure aggregating research outputs
 * API Docs: https://graph.openaire.eu/develop/
 */

interface OpenAIREResult {
  header: {
    dri: {
      objIdentifier: string;
    };
  };
  metadata: {
    'oaf:entity': {
      'oaf:result': {
        title?: Array<{ $: string } | string>;
        creator?: Array<{ $: string } | string>;
        description?: Array<{ $: string } | string>;
        dateofacceptance?: { $: string } | string;
        publisher?: { $: string } | string;
        language?: { $: string } | string;
        // The JSON API returns attributes with an "@" prefix. The "$" shape is
        // what xml2js produces, so it is kept as a fallback for the XML path.
        bestaccessright?: {
          '@classname'?: string;
          '@classid'?: string;
          $?: { classname?: string };
        };
        pid?: Array<{
          $?: { classid?: string };
          _?: string;
        }>;
        children?: {
          instance?: Array<{
            webresource?: Array<{
              url?: { $: string } | string;
            }>;
            hostedby?: {
              $?: { name?: string };
            };
            accessright?: {
              $?: { classname?: string };
            };
          }>;
        };
      };
    };
  };
}

interface OpenAIREResponse {
  response: {
    header: {
      total: { $: string } | string;
    };
    results?: {
      result?: OpenAIREResult[];
    };
  };
}

export class OpenAIREConnector implements SourceConnector {
  private baseUrl: string;

  constructor(baseUrl: string = 'https://api.openaire.eu/search') {
    this.baseUrl = baseUrl;
  }

  async search(params: SourceSearchParams): Promise<SourceSearchResult> {
    const { doi, titleOrKeywords, yearFrom, yearTo, limit = 50, offset = 0 } = params;

    if (!doi && !titleOrKeywords) {
      return { records: [] };
    }

    try {
      let query = '';
      
      if (doi) {
        // Quoted. Sent as bare free text the slash is an operator to
        // OpenAIRE's query parser, which answers HTTP 409 with
        // "Syntax errors. expected boolean, got '/'" — so every DOI lookup
        // here failed.
        query = `"${doi}"`;
      } else if (titleOrKeywords) {
        // Search by keywords in title/abstract
        query = titleOrKeywords;
      }

      const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);

      const searchParams: any = {
        keywords: query,
        format: 'json',
        size,
        // Pages are 1-based, so an offset lands exactly on page boundaries
        page: Math.floor(offset / size) + 1,
        // Only open access results
        OA: 'true',
      };

      // Add year range if provided
      if (yearFrom) {
        searchParams.fromDateAccepted = `${yearFrom}-01-01`;
      }
      if (yearTo) {
        searchParams.toDateAccepted = `${yearTo}-12-31`;
      }

      const response = await axios.get<OpenAIREResponse>(`${this.baseUrl}/publications`, {
        params: searchParams,
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
        },
      });

      const results = response.data?.response?.results?.result || [];
      const totalField = response.data?.response?.header?.total;
      const reported = Number(typeof totalField === 'string' ? totalField : totalField?.$);

      return {
        records: results.map(result => this.normalizeResult(result)),
        totalHits: Number.isFinite(reported) ? reported : undefined
      };
    } catch (error: any) {
      // Don't log 404s as errors
      if (error.response?.status !== 404) {
        log.error('OpenAIRE search error:', error.message);
      }
      return { records: [] };
    }
  }

  private normalizeResult(result: OpenAIREResult): OARecord {
    const metadata = result.metadata?.['oaf:entity']?.['oaf:result'];
    
    if (!metadata) {
      throw new Error('Invalid OpenAIRE result structure');
    }

    // Extract title
    const titleData = metadata.title;
    let title = '';
    if (Array.isArray(titleData)) {
      const firstTitle = titleData[0];
      title = typeof firstTitle === 'string' ? firstTitle : (firstTitle?.$ || '');
    } else if (typeof titleData === 'string') {
      title = titleData;
    } else if (titleData && typeof titleData === 'object' && '$' in titleData) {
      title = (titleData as any).$ || '';
    }

    // Extract authors
    const creatorData = metadata.creator;
    let authors: string[] = [];
    if (Array.isArray(creatorData)) {
      authors = creatorData.map(creator => 
        typeof creator === 'string' ? creator : (creator?.$ || '')
      ).filter(Boolean);
    } else if (typeof creatorData === 'string') {
      authors = [creatorData];
    } else if (creatorData && typeof creatorData === 'object' && '$' in creatorData) {
      authors = [(creatorData as any).$ || ''];
    }

    // Extract abstract
    const descriptionData = metadata.description;
    let abstract = '';
    if (Array.isArray(descriptionData)) {
      const firstDesc = descriptionData[0];
      abstract = typeof firstDesc === 'string' ? firstDesc : (firstDesc?.$ || '');
    } else if (typeof descriptionData === 'string') {
      abstract = descriptionData;
    } else if (descriptionData && typeof descriptionData === 'object' && '$' in descriptionData) {
      abstract = (descriptionData as any).$ || '';
    }
    
    // OpenAIRE puts stray values in the description list — one record carries
    // `[{"$": 75}, {"$": "Alzheimer's disease is…"}]`, where the abstract is
    // the second entry. Reading the first gave a number, which is truthy and
    // has no `.replace`, so the throw escaped to the search-level catch and
    // cost every record on the page: OpenAIRE returned nothing for that query
    // and reported no error.
    if (typeof abstract !== 'string' || /^\d+$/.test(abstract.trim())) {
      const alternative = (Array.isArray(descriptionData) ? descriptionData : [])
        .map(d => (typeof d === 'string' ? d : (d as any)?.$))
        .find(v => typeof v === 'string' && !/^\d+$/.test(v.trim()));
      abstract = typeof alternative === 'string' ? alternative : '';
    }

    // Clean up HTML/XML tags from abstract
    if (abstract) {
      abstract = abstract
        .replace(/<[^>]*>/g, '') // Remove HTML/XML tags
        .replace(/&lt;/g, '<')   // Decode HTML entities
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        // `&apos;` is a standard XML entity OpenAIRE emits, and it was missing
        // from this list, so abstracts read "Alzheimer&apos;s disease".
        .replace(/&apos;/g, "'")
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&') // last, so `&amp;quot;` is not decoded twice
        .replace(/\s+/g, ' ')    // Normalize whitespace
        .trim();
    }

    // Extract year
    let year: number | undefined;
    const dateData = metadata.dateofacceptance;
    const dateString = typeof dateData === 'string' ? dateData : (dateData?.$ || '');
    if (dateString) {
      const yearMatch = dateString.match(/^\d{4}/);
      if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
      }
    }

    // Extract DOI
    let doi: string | undefined;
    if (Array.isArray(metadata.pid)) {
      for (const pidItem of metadata.pid) {
        const classid = pidItem.$?.classid;
        if (classid === 'doi') {
          doi = pidItem._ || '';
          break;
        }
      }
    }

    // Extract publisher/venue
    const publisherData = metadata.publisher;
    const venue = typeof publisherData === 'string' ? publisherData : (publisherData?.$ || undefined);
    const publisher = venue; // Use the same value for publisher

    // Extract language
    const languageData = metadata.language;
    const language = typeof languageData === 'string' ? languageData : (languageData?.$ || 'en');

    // Determine OA status
    let oaStatus: 'preprint' | 'accepted' | 'published' | 'other' = 'other';
    const bestAccessRight = metadata.bestaccessright;
    const accessRight = (
      bestAccessRight?.['@classname'] ||
      bestAccessRight?.['@classid'] ||
      bestAccessRight?.$?.classname ||
      ''
    ).toLowerCase();
    if (accessRight.includes('open')) {
      oaStatus = 'published';
    }

    // Extract PDF URL from instances
    let bestPdfUrl: string | undefined;
    let landingPage: string | undefined;
    
    const instances = Array.isArray(metadata.children?.instance) 
      ? metadata.children.instance 
      : (metadata.children?.instance ? [metadata.children.instance] : []);
    
    for (const instance of instances) {
      // webresource can be a single object or an array
      const webresources = Array.isArray(instance.webresource)
        ? instance.webresource
        : (instance.webresource ? [instance.webresource] : []);
      
      for (const webresource of webresources) {
        const urlData = webresource.url;
        const url = typeof urlData === 'string' ? urlData : (urlData?.$ || '');
        
        if (url) {
          // Prefer PDF URLs
          if (url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf')) {
            bestPdfUrl = url;
            break;
          }
          // Otherwise use as landing page
          if (!landingPage) {
            landingPage = url;
          }
        }
      }
      if (bestPdfUrl) break;
    }

    // Extract OpenAIRE ID - handle both string and object formats
    let openAireId: string;
    const idData = result.header?.dri?.objIdentifier;
    
    if (typeof idData === 'string') {
      openAireId = idData;
    } else if (idData && typeof idData === 'object' && '$' in idData) {
      openAireId = (idData as any).$ || '';
    } else {
      // Fallback to DOI or title-based ID
      openAireId = doi || title.substring(0, 50).replace(/\s+/g, '-');
    }

    const record: OARecord = {
      id: `openaire:${openAireId}`,
      doi,
      title,
      authors,
      year,
      venue,
      abstract,
      source: 'openaire',
      sourceId: openAireId,
      oaStatus,
      bestPdfUrl,
      landingPage: landingPage || (openAireId ? `https://explore.openaire.eu/search/publication?articleId=${openAireId}` : undefined),
      topics: [],
      language,
      createdAt: dateString || new Date().toISOString(),
    };

    // Add publisher if available
    if (publisher) {
      record.publisher = publisher;
    }

    return record;
  }
}

