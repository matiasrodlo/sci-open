import axios from 'axios';
import { OARecord, SourceConnector } from '@open-access-explorer/shared';

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
        bestaccessright?: {
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
        query = doi;
      } else if (titleOrKeywords) {
        // Search by keywords in title/abstract
        query = titleOrKeywords;
      }

      const searchParams: any = {
        keywords: query,
        format: 'json',
        size: 50,
        page: 1,
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
      console.log(`OpenAIRE returned ${results.length} results for query: ${query}`);
      
      return results.map(result => this.normalizeResult(result));
    } catch (error: any) {
      // Don't log 404s as errors
      if (error.response?.status !== 404) {
        console.error('OpenAIRE search error:', error.message);
      }
      return [];
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
    
    // Clean up HTML/XML tags from abstract
    if (abstract) {
      abstract = abstract
        .replace(/<[^>]*>/g, '') // Remove HTML/XML tags
        .replace(/&lt;/g, '<')   // Decode HTML entities
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
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
    const accessRight = metadata.bestaccessright?.$?.classname?.toLowerCase() || '';
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
      (record as any).publisher = publisher;
    }

    return record;
  }
}

