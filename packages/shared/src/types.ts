export type OARecord = {
  id: string;                 // stable hash or source:id
  doi?: string;
  title: string;
  authors: string[];
  year?: number;
  venue?: string;             // journal/conference
  abstract?: string;
  source: "arxiv" | "core" | "europepmc" | "ncbi" | "openaire" | "biorxiv" | "medrxiv" | "doaj" | "opencitations" | "datacite";
  sourceId: string;
  oaStatus?: "preprint" | "accepted" | "published" | "other";
  bestPdfUrl?: string;        // if known
  landingPage?: string;       // canonical page
  topics?: string[];
  language?: string;
  citationCount?: number;     // number of citations
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
  openAccessOnly?: boolean;
};

export type SearchParams = {
  q?: string;
  doi?: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "date" | "date_asc" | "citations" | "citations_asc" | "author" | "author_desc" | "venue" | "venue_desc" | "title" | "title_desc";
};

export type SearchResponse = {
  hits: OARecord[];
  facets: Record<string, any>;
  page: number;
  total: number;
  pageSize: number;
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
    sort?: "relevance" | "date" | "date_asc" | "citations" | "citations_asc" | "author" | "author_desc" | "venue" | "venue_desc" | "title" | "title_desc";
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
