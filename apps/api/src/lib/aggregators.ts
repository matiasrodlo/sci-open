import { OARecord, OASource, SearchParams, SourceConnector } from '@open-access-explorer/shared';
import { CoreConnector } from '../sources/core';
import { OpenAIREConnector } from '../sources/openaire';
import { EuropePMCConnector } from '../sources/europepmc';
import { NCBIConnector } from '../sources/ncbi';
import { ArxivConnector } from '../sources/arxiv';
import { OpenCitationsConnector } from '../sources/opencitations';
import { DataCiteConnector } from '../sources/datacite';
import { DOAJConnector } from '../sources/doaj';
import { PLOSConnector } from '../sources/plos';
import { BiorxivConnector } from '../sources/biorxiv';

export interface AggregatorResult {
  source: string;
  records: OARecord[];
  // The provider's own count of everything matching the query, when it reports
  // one. Unrelated to records.length, which is only what this request retrieved.
  totalHits?: number;
  error?: string;
  latency: number;
}

/**
 * One entry per provider. Adding a source means adding a row here — the search
 * fan-out and the reported stats both read from this list, so the two can no
 * longer disagree about which providers are live.
 */
export interface ProviderDefinition {
  name: OASource;
  connector: SourceConnector;
  baseUrl: string;
  // False for connectors with no keyword endpoint; they are never fanned out to
  keywordSearch: boolean;
  // Set when the provider cannot run, e.g. missing credentials
  unavailable?: string;
  note?: string;
}

export class AggregatorManager {
  private providers: ProviderDefinition[];

  constructor() {
    const coreKey = process.env.CORE_API_KEY;
    const coreConfigured = !!coreKey && !coreKey.includes('your_') && coreKey.trim() !== '';

    const url = (envVar: string | undefined, fallback: string) => envVar || fallback;

    const europepmcBase = url(process.env.EUROPE_PMC_BASE, 'https://www.ebi.ac.uk/europepmc/webservices/rest');
    const ncbiBase = url(process.env.NCBI_EUTILS_BASE, 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils');
    const arxivBase = url(process.env.ARXIV_BASE, 'https://export.arxiv.org/api/query');
    const doajBase = url(process.env.DOAJ_BASE, 'https://doaj.org/api');
    const plosBase = url(process.env.PLOS_BASE, 'https://api.plos.org/search');
    const openaireBase = url(process.env.OPENAIRE_BASE, 'https://api.openaire.eu/search');
    const coreBase = url(process.env.CORE_BASE, 'https://api.core.ac.uk/v3');
    const dataciteBase = url(process.env.DATACITE_BASE, 'https://api.datacite.org/dois');
    const biorxivBase = url(process.env.BIORXIV_BASE, 'https://api.biorxiv.org');
    const opencitationsBase = url(process.env.OPENCITATIONS_BASE, 'https://opencitations.net/index/coci/api/v1');

    this.providers = [
      {
        name: 'europepmc',
        connector: new EuropePMCConnector(europepmcBase),
        baseUrl: europepmcBase,
        keywordSearch: true
      },
      {
        name: 'ncbi',
        connector: new NCBIConnector(ncbiBase, process.env.NCBI_API_KEY),
        baseUrl: ncbiBase,
        keywordSearch: true
      },
      {
        name: 'arxiv',
        connector: new ArxivConnector(arxivBase),
        baseUrl: arxivBase,
        keywordSearch: true
      },
      {
        name: 'doaj',
        connector: new DOAJConnector(
          doajBase,
          // The shipped example value is a placeholder; DOAJ search works unauthenticated
          process.env.DOAJ_API_KEY?.includes('your_') ? undefined : process.env.DOAJ_API_KEY
        ),
        baseUrl: doajBase,
        keywordSearch: true
      },
      {
        name: 'plos',
        connector: new PLOSConnector(plosBase),
        baseUrl: plosBase,
        keywordSearch: true
      },
      {
        name: 'openaire',
        connector: new OpenAIREConnector(openaireBase),
        baseUrl: openaireBase,
        keywordSearch: true
      },
      {
        name: 'core',
        connector: new CoreConnector(coreBase, coreKey || ''),
        baseUrl: coreBase,
        keywordSearch: true,
        unavailable: coreConfigured ? undefined : 'CORE_API_KEY not set'
      },
      {
        name: 'datacite',
        connector: new DataCiteConnector(
          dataciteBase,
          // The shipped example value is a placeholder, and sending it as a
          // bearer token makes DataCite answer 401. Search works unauthenticated.
          process.env.DATACITE_API_KEY?.includes('your_') ? undefined : process.env.DATACITE_API_KEY
        ),
        baseUrl: dataciteBase,
        keywordSearch: true,
        note: 'Registry of repository items; returns datasets and software alongside papers'
      },
      {
        name: 'biorxiv',
        connector: new BiorxivConnector(biorxivBase),
        baseUrl: biorxivBase,
        keywordSearch: true,
        note: 'Scans a recent date window rather than an index, so coverage is the last few weeks of preprints'
      },
      {
        name: 'opencitations',
        connector: new OpenCitationsConnector(opencitationsBase, process.env.OPENCITATIONS_API_KEY),
        baseUrl: opencitationsBase,
        keywordSearch: false,
        note: 'Resolves citations for a known DOI; has no keyword endpoint'
      }
    ];
  }

  /** Providers a keyword search actually fans out to */
  private activeProviders(): ProviderDefinition[] {
    return this.providers.filter(p => p.keywordSearch && !p.unavailable);
  }

  /**
   * Search all aggregators in parallel with timeout and error handling
   */
  async searchAggregators(params: SearchParams, depth?: { limit: number; offset: number }): Promise<AggregatorResult[]> {
    const searchParams = {
      doi: params.doi,
      titleOrKeywords: params.q,
      yearFrom: params.filters?.yearFrom,
      yearTo: params.filters?.yearTo,
      limit: depth?.limit,
      offset: depth?.offset
    };

    // The operative per-provider budget. It has to cover more than network
    // time: every connector parses its payload on the same thread, so a deep
    // fan-out stalls each of them while the others decode multi-megabyte JSON
    // and XML. Connectors keep their own ceilings above this so that this
    // budget, not an individual connector's timer, is what gives up first.
    const timeoutMs = Math.min(8000 + (depth?.limit ?? 50) * 30, 30000);

    const results = await Promise.allSettled(
      this.activeProviders().map(async ({ name, connector }) => {
        const startTime = Date.now();
        try {
          const result = await this.withTimeout(
            connector.search(searchParams),
            timeoutMs
          );

          return {
            source: name,
            records: result.records,
            totalHits: result.totalHits,
            latency: Date.now() - startTime
          } as AggregatorResult;
        } catch (error) {
          return {
            source: name,
            records: [],
            error: error instanceof Error ? error.message : 'Unknown error',
            latency: Date.now() - startTime
          } as AggregatorResult;
        }
      })
    );

    return results
      .filter((result): result is PromiseFulfilledResult<AggregatorResult> => 
        result.status === 'fulfilled'
      )
      .map(result => result.value);
  }

  /**
   * Add timeout wrapper to prevent slow aggregators from blocking
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error('Aggregator timeout')), timeoutMs)
      )
    ]);
  }

  /**
   * Report each provider's wiring, derived from the same registry the search
   * fan-out uses. `enabled` therefore means the source really is queried,
   * rather than being a hand-maintained claim that can drift out of date.
   */
  getAggregatorStats(): Record<string, { enabled: boolean; baseUrl: string; note?: string }> {
    const stats: Record<string, { enabled: boolean; baseUrl: string; note?: string }> = {};

    for (const provider of this.providers) {
      const note = provider.unavailable
        ? `${provider.unavailable}; not queried`
        : !provider.keywordSearch
          ? provider.note
          : provider.note;

      stats[provider.name] = {
        enabled: provider.keywordSearch && !provider.unavailable,
        baseUrl: provider.baseUrl,
        ...(note ? { note } : {})
      };
    }

    return stats;
  }

  /** Provider names a keyword search will fan out to */
  getActiveProviderNames(): string[] {
    return this.activeProviders().map(p => p.name);
  }
}
