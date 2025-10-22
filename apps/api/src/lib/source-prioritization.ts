import { SearchParams } from '@open-access-explorer/shared';

export interface SourceCharacteristics {
  name: string;
  strengths: string[];
  weaknesses: string[];
  averageLatency: number;
  reliability: number; // 0-1 score
  coverage: {
    biomedical: number;
    computerScience: number;
    physics: number;
    chemistry: number;
    mathematics: number;
    general: number;
  };
  queryTypes: {
    doiLookup: number;
    titleSearch: number;
    keywordSearch: number;
    authorSearch: number;
    citationSearch: number;
  };
  responseTime: {
    fast: number; // < 1s
    medium: number; // 1-3s
    slow: number; // > 3s
  };
}

// QueryAnalysis interface moved to query-analyzer.ts

export interface SourceSelectionStrategy {
  primary: string[];
  secondary: string[];
  fallback: string[];
  maxSources: number;
  timeoutMs: number;
}

export class SourcePrioritizationConfig {
  private sourceCharacteristics: Map<string, SourceCharacteristics> = new Map();
  private queryStrategies: Map<string, SourceSelectionStrategy> = new Map();

  constructor() {
    this.initializeSourceCharacteristics();
    this.initializeQueryStrategies();
  }

  private initializeSourceCharacteristics(): void {
    // OpenAlex - General purpose, good coverage
    this.sourceCharacteristics.set('openalex', {
      name: 'openalex',
      strengths: ['comprehensive', 'fast', 'good_metadata', 'citations'],
      weaknesses: ['limited_oa_status', 'newer_source'],
      averageLatency: 800,
      reliability: 0.95,
      coverage: {
        biomedical: 0.8,
        computerScience: 0.9,
        physics: 0.85,
        chemistry: 0.8,
        mathematics: 0.75,
        general: 0.9
      },
      queryTypes: {
        doiLookup: 0.9,
        titleSearch: 0.95,
        keywordSearch: 0.9,
        authorSearch: 0.85,
        citationSearch: 0.9
      },
      responseTime: {
        fast: 0.8,
        medium: 0.2,
        slow: 0.0
      }
    });

    // Crossref - DOI specialist, reliable
    this.sourceCharacteristics.set('crossref', {
      name: 'crossref',
      strengths: ['doi_authority', 'reliable', 'comprehensive_metadata'],
      weaknesses: ['slower', 'limited_oa_info'],
      averageLatency: 1200,
      reliability: 0.98,
      coverage: {
        biomedical: 0.9,
        computerScience: 0.85,
        physics: 0.8,
        chemistry: 0.85,
        mathematics: 0.8,
        general: 0.9
      },
      queryTypes: {
        doiLookup: 0.98,
        titleSearch: 0.8,
        keywordSearch: 0.7,
        authorSearch: 0.75,
        citationSearch: 0.6
      },
      responseTime: {
        fast: 0.3,
        medium: 0.6,
        slow: 0.1
      }
    });

    // EuropePMC - Biomedical specialist
    this.sourceCharacteristics.set('europepmc', {
      name: 'europepmc',
      strengths: ['biomedical_specialist', 'fast', 'good_oa_info'],
      weaknesses: ['limited_domains', 'smaller_coverage'],
      averageLatency: 600,
      reliability: 0.92,
      coverage: {
        biomedical: 0.95,
        computerScience: 0.3,
        physics: 0.2,
        chemistry: 0.4,
        mathematics: 0.1,
        general: 0.4
      },
      queryTypes: {
        doiLookup: 0.9,
        titleSearch: 0.9,
        keywordSearch: 0.85,
        authorSearch: 0.8,
        citationSearch: 0.7
      },
      responseTime: {
        fast: 0.9,
        medium: 0.1,
        slow: 0.0
      }
    });

    // NCBI - Biomedical and life sciences
    this.sourceCharacteristics.set('ncbi', {
      name: 'ncbi',
      strengths: ['biomedical_authority', 'comprehensive', 'good_metadata'],
      weaknesses: ['slower', 'complex_api'],
      averageLatency: 1500,
      reliability: 0.9,
      coverage: {
        biomedical: 0.98,
        computerScience: 0.2,
        physics: 0.1,
        chemistry: 0.3,
        mathematics: 0.05,
        general: 0.3
      },
      queryTypes: {
        doiLookup: 0.85,
        titleSearch: 0.9,
        keywordSearch: 0.85,
        authorSearch: 0.8,
        citationSearch: 0.6
      },
      responseTime: {
        fast: 0.2,
        medium: 0.6,
        slow: 0.2
      }
    });

    // ArXiv - Preprints, physics, math, CS
    this.sourceCharacteristics.set('arxiv', {
      name: 'arxiv',
      strengths: ['preprints', 'fast', 'open_access', 'physics_math_cs'],
      weaknesses: ['limited_domains', 'preprints_only'],
      averageLatency: 400,
      reliability: 0.88,
      coverage: {
        biomedical: 0.1,
        computerScience: 0.8,
        physics: 0.9,
        chemistry: 0.2,
        mathematics: 0.85,
        general: 0.3
      },
      queryTypes: {
        doiLookup: 0.7,
        titleSearch: 0.8,
        keywordSearch: 0.85,
        authorSearch: 0.8,
        citationSearch: 0.5
      },
      responseTime: {
        fast: 0.95,
        medium: 0.05,
        slow: 0.0
      }
    });

    // CORE - Open access specialist
    this.sourceCharacteristics.set('core', {
      name: 'core',
      strengths: ['open_access', 'comprehensive_oa', 'good_pdf_links'],
      weaknesses: ['variable_quality', 'limited_metadata'],
      averageLatency: 1000,
      reliability: 0.85,
      coverage: {
        biomedical: 0.6,
        computerScience: 0.7,
        physics: 0.5,
        chemistry: 0.6,
        mathematics: 0.6,
        general: 0.7
      },
      queryTypes: {
        doiLookup: 0.8,
        titleSearch: 0.8,
        keywordSearch: 0.8,
        authorSearch: 0.7,
        citationSearch: 0.4
      },
      responseTime: {
        fast: 0.4,
        medium: 0.5,
        slow: 0.1
      }
    });
  }

  private initializeQueryStrategies(): void {
    // DOI lookup strategy - prioritize DOI authorities
    this.queryStrategies.set('doi', {
      primary: ['crossref', 'openalex'],
      secondary: ['europepmc', 'core'],
      fallback: ['ncbi', 'arxiv'],
      maxSources: 3,
      timeoutMs: 5000
    });

    // Biomedical queries
    this.queryStrategies.set('biomedical', {
      primary: ['europepmc', 'ncbi', 'openalex'],
      secondary: ['crossref', 'core'],
      fallback: ['arxiv'],
      maxSources: 4,
      timeoutMs: 8000
    });

    // Computer Science queries
    this.queryStrategies.set('computerScience', {
      primary: ['openalex', 'arxiv', 'crossref'],
      secondary: ['core'],
      fallback: ['europepmc', 'ncbi'],
      maxSources: 3,
      timeoutMs: 6000
    });

    // Physics queries
    this.queryStrategies.set('physics', {
      primary: ['arxiv', 'openalex', 'crossref'],
      secondary: ['core'],
      fallback: ['europepmc', 'ncbi'],
      maxSources: 3,
      timeoutMs: 6000
    });

    // General queries
    this.queryStrategies.set('general', {
      primary: ['openalex', 'crossref'],
      secondary: ['core', 'europepmc'],
      fallback: ['ncbi', 'arxiv'],
      maxSources: 4,
      timeoutMs: 8000
    });

    // Fast queries (time-sensitive)
    this.queryStrategies.set('fast', {
      primary: ['openalex', 'europepmc'],
      secondary: ['arxiv'],
      fallback: ['crossref', 'core'],
      maxSources: 2,
      timeoutMs: 3000
    });
  }

  getSourceCharacteristics(sourceName: string): SourceCharacteristics | undefined {
    return this.sourceCharacteristics.get(sourceName);
  }

  getAllSources(): string[] {
    return Array.from(this.sourceCharacteristics.keys());
  }

  getQueryStrategy(queryAnalysis: QueryAnalysis): SourceSelectionStrategy {
    // Determine strategy based on query analysis
    if (queryAnalysis.type === 'doi') {
      return this.queryStrategies.get('doi')!;
    }

    if (queryAnalysis.timeSensitivity === 'high') {
      return this.queryStrategies.get('fast')!;
    }

    // Domain-specific strategies
    switch (queryAnalysis.domain) {
      case 'biomedical':
        return this.queryStrategies.get('biomedical')!;
      case 'computerScience':
        return this.queryStrategies.get('computerScience')!;
      case 'physics':
        return this.queryStrategies.get('physics')!;
      default:
        return this.queryStrategies.get('general')!;
    }
  }
}
