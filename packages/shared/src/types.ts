// Every source a record can originate from. The first group are the source
// connectors; the second are the metadata/OA clients the pipeline resolves
// records from directly.
export type OASource =
  | "arxiv" | "core" | "europepmc" | "ncbi" | "openaire" | "biorxiv" | "medrxiv" | "doaj" | "plos" | "opencitations" | "datacite"
  | "openalex" | "crossref" | "unpaywall" | "preprints";

export type SearchFilters = {
  source?: string[];
  yearFrom?: number;
  yearTo?: number;
  publicationType?: string[];
  openAccessOnly?: boolean;
};

export type SearchSort = "relevance" | "date" | "date_asc" | "citations" | "citations_asc";

export type SearchParams = {
  q?: string;
  doi?: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: SearchSort;
};
