import { OARecord, SearchParams } from '@open-access-explorer/shared';
import { CoreConnector } from '../sources/core';
import { OpenAIREConnector } from '../sources/openaire';
import { EuropePMCConnector } from '../sources/europepmc';
import { NCBIConnector } from '../sources/ncbi';
import { OpenCitationsConnector } from '../sources/opencitations';
import { DataCiteConnector } from '../sources/datacite';

export interface AggregatorResult {
  source: string;
  records: OARecord[];
  error?: string;
  latency: number;
}

export class AggregatorManager {
  private coreConnector: CoreConnector;
  private openaireConnector: OpenAIREConnector;
  private europepmcConnector: EuropePMCConnector;
  private ncbiConnector: NCBIConnector;
  private opencitationsConnector: OpenCitationsConnector;
  private dataciteConnector: DataCiteConnector;

  constructor() {
    this.coreConnector = new CoreConnector(
      process.env.CORE_BASE || 'https://api.core.ac.uk/v3',
      process.env.CORE_API_KEY || ''
    );
    
    this.openaireConnector = new OpenAIREConnector(
      process.env.OPENAIRE_BASE || 'https://api.openaire.eu/search'
    );
    
    this.europepmcConnector = new EuropePMCConnector(
      process.env.EUROPE_PMC_BASE || 'https://www.ebi.ac.uk/europepmc/webservices/rest'
    );
    
    this.ncbiConnector = new NCBIConnector(
      process.env.NCBI_EUTILS_BASE || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
      process.env.NCBI_API_KEY
    );
    
    this.opencitationsConnector = new OpenCitationsConnector(
      process.env.OPENCITATIONS_BASE || 'https://opencitations.net/index/coci/api/v1',
      process.env.OPENCITATIONS_API_KEY
    );
    
    this.dataciteConnector = new DataCiteConnector(
      process.env.DATACITE_BASE || 'https://api.datacite.org/dois',
      process.env.DATACITE_API_KEY
    );
  }

  /**
   * Search all aggregators in parallel with timeout and error handling
   */
  async searchAggregators(params: SearchParams): Promise<AggregatorResult[]> {
    const searchParams = {
      doi: params.doi,
      titleOrKeywords: params.q,
      yearFrom: params.filters?.yearFrom,
      yearTo: params.filters?.yearTo
    };

    const aggregators = [
      { name: 'core', connector: this.coreConnector },
      { name: 'openaire', connector: this.openaireConnector },
      { name: 'europepmc', connector: this.europepmcConnector },
      { name: 'ncbi', connector: this.ncbiConnector },
      { name: 'opencitations', connector: this.opencitationsConnector },
      { name: 'datacite', connector: this.dataciteConnector }
    ];

    const results = await Promise.allSettled(
      aggregators.map(async ({ name, connector }) => {
        const startTime = Date.now();
        try {
          const records = await this.withTimeout(
            connector.search(searchParams),
            10000 // 10 second timeout per aggregator
          );
          const latency = Date.now() - startTime;
          
          return {
            source: name,
            records,
            latency
          } as AggregatorResult;
        } catch (error) {
          const latency = Date.now() - startTime;
          return {
            source: name,
            records: [],
            error: error instanceof Error ? error.message : 'Unknown error',
            latency
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
   * Get aggregator statistics
   */
  getAggregatorStats(): Record<string, { enabled: boolean; baseUrl: string }> {
    return {
      core: {
        enabled: !!process.env.CORE_API_KEY,
        baseUrl: process.env.CORE_BASE || 'https://api.core.ac.uk/v3'
      },
      openaire: {
        enabled: true,
        baseUrl: process.env.OPENAIRE_BASE || 'https://api.openaire.eu/search'
      },
      europepmc: {
        enabled: true,
        baseUrl: process.env.EUROPE_PMC_BASE || 'https://www.ebi.ac.uk/europepmc/webservices/rest'
      },
      ncbi: {
        enabled: true,
        baseUrl: process.env.NCBI_EUTILS_BASE || 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
      },
      opencitations: {
        enabled: true,
        baseUrl: process.env.OPENCITATIONS_BASE || 'https://opencitations.net/index/coci/api/v1'
      },
      datacite: {
        enabled: true,
        baseUrl: process.env.DATACITE_BASE || 'https://api.datacite.org/dois'
      }
    };
  }
}
