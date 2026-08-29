import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { getPooledClient } from '../http-client-factory';
import { extractContactEmail } from '../contact-email';
import { getServiceConfig as getHttpServiceConfig } from '../http-pool-config';
import { log } from '../logger';

export interface OpenAlexWork {
  id: string;
  doi?: string;
  title: string;
  authorships: Array<{
    author: {
      display_name: string;
      orcid?: string;
    };
    institutions?: Array<{
      display_name: string;
    }>;
  }>;
  publication_year?: number;
  primary_location?: {
    source: {
      display_name: string;
      issn?: string[];
      publisher?: string;
      host_organization_name?: string;
    };
  };
  // Legacy OpenAlex field, superseded by primary_location. Not included in the
  // `select` list below, so it is absent from searchWorks() responses.
  host_venue?: {
    display_name?: string;
    publisher?: string;
  };
  concepts: Array<{
    display_name: string;
    score: number;
  }>;
  abstract_inverted_index?: Record<string, number[]>;
  open_access?: {
    is_oa: boolean;
    oa_status?: string;
    oa_url?: string;
  };
  cited_by_count?: number;
  // Also outside the `select` list; only present on full getWork() responses.
  created_date?: string;
  type: string;
  language?: string;
}

export interface OpenAlexResponse {
  results: OpenAlexWork[];
  meta: {
    count: number;
    page: number;
    per_page: number;
  };
}

/**
 * OpenAlex answered, but not with the page that was asked for.
 *
 * The pooled client sets `validateStatus: status < 500`, so a 429 resolves as
 * a success and its body — an error object with no `results` key — was handed
 * on as though it were a result page. Discovery flattened the missing array to
 * `undefined`, read `.doi` off it, and every keyword search returned 500 while
 * the quota was spent, even though the other eight providers were answering
 * normally.
 *
 * Throwing is what lets the fan-out degrade to those eight and report OpenAlex
 * as errored — a shape `providerTotals` already had a field for.
 */
export class OpenAlexUnavailableError extends Error {
  readonly status: number;
  /** Seconds until the quota resets, when OpenAlex says so. */
  readonly retryAfterSeconds: number | undefined;

  constructor(status: number, detail: string, retryAfterSeconds?: number) {
    super(`OpenAlex ${status}: ${detail}`);
    this.name = 'OpenAlexUnavailableError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Whether a resolved response is actually the thing it was asked for.
 *
 * The status alone does not answer that here, and neither does the absence of
 * a thrown error: both a rate-limited 429 and a well-formed page arrive as
 * resolved responses. The shape is what distinguishes them, so it is checked
 * rather than assumed.
 */
function assertUsable(response: AxiosResponse, expected: 'results' | 'work'): void {
  const body = response.data as Record<string, unknown> | undefined;

  if (response.status >= 400) {
    const detail =
      typeof body?.message === 'string' ? body.message
      : typeof body?.error === 'string' ? body.error
      : response.statusText || 'no message given';
    const retryAfter = typeof body?.retryAfter === 'number' ? body.retryAfter : undefined;
    throw new OpenAlexUnavailableError(response.status, detail, retryAfter);
  }

  if (expected === 'results' && !Array.isArray(body?.results)) {
    throw new OpenAlexUnavailableError(response.status, 'a 2xx response carrying no results array');
  }

  if (expected === 'work' && typeof body?.id !== 'string') {
    throw new OpenAlexUnavailableError(response.status, 'a 2xx response carrying no work');
  }
}

export class OpenAlexClient {
  private baseUrl = 'https://api.openalex.org';
  private userAgent: string;
  private contactEmail?: string;
  private httpClient: AxiosInstance;

  constructor(userAgent: string) {
    this.userAgent = userAgent;
    // OpenAlex routes callers who identify themselves into a faster pool with
    // a higher rate limit. It reads either the User-Agent or a `mailto`
    // parameter; sending both is what the API documents as the polite path.
    this.contactEmail = extractContactEmail(userAgent);
    // Initialize pooled HTTP client with OpenAlex-specific configuration
    this.httpClient = getPooledClient(this.baseUrl, getHttpServiceConfig('openalex'));
  }

  async searchWorks(params: {
    query?: string;
    doi?: string;
    page?: number;
    perPage?: number;
    filter?: string;
  }): Promise<OpenAlexResponse> {
    const { query, doi, page = 1, perPage = 25, filter } = params;

    let searchQuery = '';
    if (doi) {
      searchQuery = `doi:${doi}`;
    } else if (query) {
      searchQuery = query;
    } else {
      throw new Error('Either query or doi must be provided');
    }

    const searchParams: any = {
      search: searchQuery,
      page,
      per_page: perPage,
      // Request only essential fields for performance
      select: 'id,doi,title,authorships,publication_year,primary_location,concepts,abstract_inverted_index,open_access,cited_by_count,type,language'
    };

    if (this.contactEmail) {
      searchParams.mailto = this.contactEmail;
    }

    if (filter) {
      searchParams.filter = filter;
    }

    const response = await this.httpClient.get('/works', {
      params: searchParams,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      }
    });

    assertUsable(response, 'results');

    return response.data;
  }

  async getWork(workId: string): Promise<OpenAlexWork> {
    const response = await this.httpClient.get(`/works/${workId}`, {
      params: this.contactEmail ? { mailto: this.contactEmail } : undefined,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'application/json'
      }
    });

    assertUsable(response, 'work');

    return response.data;
  }

  async getWorkByDOI(doi: string): Promise<OpenAlexWork | null> {
    try {
      const response = await this.searchWorks({ doi, perPage: 1 });
      return response.results[0] || null;
    } catch (error) {
      log.error('OpenAlex DOI lookup error:', error);
      return null;
    }
  }

  // Helper method to reconstruct abstract from inverted index
  static reconstructAbstract(invertedIndex: Record<string, number[]>): string {
    if (!invertedIndex) return '';
    
    const words: Array<{ word: string; position: number }> = [];
    
    for (const [word, positions] of Object.entries(invertedIndex)) {
      for (const position of positions) {
        words.push({ word, position });
      }
    }
    
    words.sort((a, b) => a.position - b.position);
    return words.map(w => w.word).join(' ');
  }
}
