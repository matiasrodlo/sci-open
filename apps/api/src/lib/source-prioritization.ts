import { SearchParams } from '@open-access-explorer/shared';
import { QueryAnalysis } from './query-analyzer';

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

    // DataCite - Repository DOI registry, mostly non-article content
    this.sourceCharacteristics.set('datacite', {
      name: 'datacite',
      strengths: ['repository_items', 'doi_authority', 'datasets_and_software'],
      weaknesses: ['few_articles', 'wildcard_title_query_only', 'sparse_pdf_links'],
      averageLatency: 1900,
      reliability: 0.85,
      coverage: {
        biomedical: 0.4,
        computerScience: 0.5,
        physics: 0.4,
        chemistry: 0.4,
        mathematics: 0.3,
        general: 0.5
      },
      queryTypes: {
        doiLookup: 0.85,
        titleSearch: 0.6,
        keywordSearch: 0.5,
        authorSearch: 0.3,
        citationSearch: 0.1
      },
      responseTime: {
        fast: 0.2,
        medium: 0.7,
        slow: 0.1
      }
    });

    // bioRxiv/medRxiv - Preprints, recency-limited keyword scan
    this.sourceCharacteristics.set('biorxiv', {
      name: 'biorxiv',
      strengths: ['preprints', 'biomedical', 'open_access', 'direct_pdf_links'],
      weaknesses: ['no_keyword_endpoint', 'recent_window_only', 'client_side_filtering'],
      averageLatency: 2700,
      reliability: 0.8,
      coverage: {
        biomedical: 0.9,
        computerScience: 0.1,
        physics: 0.05,
        chemistry: 0.15,
        mathematics: 0.05,
        general: 0.2
      },
      queryTypes: {
        doiLookup: 0.9,
        titleSearch: 0.3,
        keywordSearch: 0.3,
        authorSearch: 0.1,
        citationSearch: 0.0
      },
      responseTime: {
        fast: 0.1,
        medium: 0.4,
        slow: 0.5
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

    // DOAJ - Directory of open access journals, broad and fast
    this.sourceCharacteristics.set('doaj', {
      name: 'doaj',
      strengths: ['open_access_only', 'fast', 'broad_disciplines', 'vetted_journals'],
      weaknesses: ['no_citation_data', 'article_metadata_only', 'caps_at_100_per_page'],
      averageLatency: 450,
      reliability: 0.9,
      coverage: {
        biomedical: 0.6,
        computerScience: 0.5,
        physics: 0.5,
        chemistry: 0.55,
        mathematics: 0.5,
        general: 0.7
      },
      queryTypes: {
        doiLookup: 0.7,
        titleSearch: 0.8,
        keywordSearch: 0.8,
        authorSearch: 0.7,
        citationSearch: 0.1
      },
      responseTime: {
        fast: 0.9,
        medium: 0.1,
        slow: 0.0
      }
    });

    // PLOS - Single publisher, Solr-backed full-text search, biology and medicine
    this.sourceCharacteristics.set('plos', {
      name: 'plos',
      strengths: ['full_text_search', 'open_access', 'deep_paging', 'good_metadata'],
      weaknesses: ['single_publisher', 'narrow_corpus', 'limited_domains'],
      averageLatency: 1500,
      reliability: 0.9,
      coverage: {
        biomedical: 0.9,
        computerScience: 0.2,
        physics: 0.15,
        chemistry: 0.3,
        mathematics: 0.1,
        general: 0.3
      },
      queryTypes: {
        doiLookup: 0.85,
        titleSearch: 0.9,
        keywordSearch: 0.9,
        authorSearch: 0.8,
        citationSearch: 0.2
      },
      responseTime: {
        fast: 0.2,
        medium: 0.7,
        slow: 0.1
      }
    });

    // OpenAIRE - EU research aggregator, broad coverage but the slowest source
    this.sourceCharacteristics.set('openaire', {
      name: 'openaire',
      strengths: ['eu_research', 'broad_disciplines', 'repository_aggregation'],
      weaknesses: ['slow', 'small_pages', 'variable_metadata'],
      averageLatency: 6000,
      reliability: 0.85,
      coverage: {
        biomedical: 0.65,
        computerScience: 0.7,
        physics: 0.65,
        chemistry: 0.65,
        mathematics: 0.6,
        general: 0.75
      },
      queryTypes: {
        doiLookup: 0.8,
        titleSearch: 0.75,
        keywordSearch: 0.75,
        authorSearch: 0.65,
        citationSearch: 0.3
      },
      responseTime: {
        fast: 0.0,
        medium: 0.2,
        slow: 0.8
      }
    });
  }

  private initializeQueryStrategies(): void {
    // Every strategy references the full registered source set across its three
    // tiers, so adaptive learning can promote or demote any source it has
    // metrics for rather than only the handful that used to be listed.
    //
    // `primary` is deliberately left as the narrow, hand-picked set: the
    // pipeline queries openalex and crossref directly, and everything else is
    // served by one aggregator sweep, so dropping either of those two out of
    // the selection is the one change here that would actually lose results.
    // Breadth is added in `secondary` and `fallback`, and maxSources is raised
    // so those tiers are reachable instead of being truncated away.
    //
    // Sources whose domain coverage is below the suitability floor are still
    // filtered out per query by isSourceSuitable, so listing a source here
    // makes it eligible, not guaranteed.

    // DOI lookup strategy - prioritize DOI authorities
    this.queryStrategies.set('doi', {
      primary: ['crossref', 'openalex'],
      // DataCite is a DOI registry in its own right, so it earns a place here
      secondary: ['europepmc', 'datacite'],
      fallback: ['core', 'doaj', 'openaire', 'ncbi', 'arxiv', 'plos', 'biorxiv'],
      maxSources: 5,
      timeoutMs: 5000
    });

    // Biomedical queries
    this.queryStrategies.set('biomedical', {
      primary: ['europepmc', 'ncbi', 'openalex'],
      secondary: ['crossref', 'plos'],
      fallback: ['core', 'biorxiv', 'doaj', 'openaire', 'datacite', 'arxiv'],
      maxSources: 7,
      timeoutMs: 8000
    });

    // Computer Science queries
    this.queryStrategies.set('computerScience', {
      primary: ['openalex', 'arxiv', 'crossref'],
      secondary: ['core', 'doaj'],
      fallback: ['openaire', 'datacite', 'europepmc', 'ncbi'],
      maxSources: 6,
      timeoutMs: 6000
    });

    // Physics queries
    this.queryStrategies.set('physics', {
      primary: ['arxiv', 'openalex', 'crossref'],
      secondary: ['core', 'doaj'],
      fallback: ['openaire', 'datacite', 'europepmc', 'ncbi'],
      maxSources: 6,
      timeoutMs: 6000
    });

    // General queries - also serves chemistry and mathematics, which have no
    // strategy of their own and fall through to this one
    this.queryStrategies.set('general', {
      primary: ['openalex', 'crossref'],
      secondary: ['core', 'europepmc'],
      fallback: ['doaj', 'openaire', 'datacite', 'ncbi', 'arxiv', 'plos'],
      maxSources: 7,
      timeoutMs: 8000
    });

    // Fast queries (time-sensitive). The cap stays tight on purpose; the wider
    // tiers exist so learning can reorder them, not so more get selected.
    this.queryStrategies.set('fast', {
      primary: ['openalex', 'europepmc'],
      // DOAJ answers in ~450ms, which is the point of this strategy
      secondary: ['arxiv', 'doaj'],
      fallback: ['crossref', 'core', 'plos', 'datacite', 'openaire', 'ncbi', 'biorxiv'],
      maxSources: 3,
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
