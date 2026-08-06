// Every source a record can originate from. The first group are the source
// connectors; the second are the metadata/OA clients the pipeline resolves
// records from directly.
export type OASource =
  | "arxiv" | "core" | "europepmc" | "ncbi" | "openaire" | "biorxiv" | "medrxiv" | "doaj" | "opencitations" | "datacite"
  | "openalex" | "crossref" | "unpaywall";

// Provenance attached by the pipeline when a record comes from an aggregator
export type SourceMetadata = {
  source?: string;
  latency?: number;
  enriched?: boolean;
};

export type OARecord = {
  id: string;                 // stable hash or source:id
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;             // journal/conference
  publisher?: string;
  abstract?: string;
  source: OASource;
  sourceId: string;
  oaStatus?: "preprint" | "accepted" | "published" | "other";
  bestPdfUrl?: string;        // if known
  landingPage?: string;       // canonical page
  topics?: string[];
  language?: string;
  citationCount?: number;     // number of citations
  sourceMetadata?: SourceMetadata;
  createdAt: string;          // iso
  updatedAt?: string;         // iso
};

export type SearchFilters = {
  source?: string[];
  yearFrom?: number;
  yearTo?: number;
  oaStatus?: string[];
  venue?: string[];
  publisher?: string[];
  topics?: string[];
  publicationType?: string[];
  openAccessOnly?: boolean;
};

export type SearchSort = "relevance" | "date" | "date_asc" | "citations" | "citations_asc" | "author" | "author_desc" | "venue" | "venue_desc" | "title" | "title_desc";

export type SearchParams = {
  q?: string;
  doi?: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: SearchSort;
};

// Describes which sources the smart selector picked for a query
export type SourceSelectionSummary = {
  selectedSources: string[];
  reasoning: string;
  estimatedLatency: number;
  confidence: number;
};

export type SearchResponse = {
  hits: OARecord[];
  facets: Record<string, any>;
  page: number;
  total: number;
  pageSize: number;
  // Echoed back by the enhanced pipeline; absent from the basic pipeline
  filters?: SearchFilters;
  sort?: SearchSort;
  duration?: number;
  sourceSelection?: SourceSelectionSummary;
};

export type PaperResponse = {
  record: OARecord;
  pdf: {
    url?: string;
    status: "ok" | "not_found" | "error";
  };
};

export interface SearchAdapter {
  ensureIndex(): Promise<void>;
  upsertMany(records: OARecord[]): Promise<void>;
  search(params: {
    q?: string;
    filters?: Record<string, string[] | number[]>;
    page?: number;
    pageSize?: number;
    sort?: SearchSort;
  }): Promise<{ hits: OARecord[]; total: number; facets: Record<string, any> }>;
}

export type SourceConnector = {
  search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]>;
};
