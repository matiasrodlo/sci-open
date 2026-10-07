// Every source the engine asks: the providers a search fans out to, then the
// authorities asked about a paper by DOI. `ProviderId` and `AuthorityId` are
// its two halves, and OpenAlex is in both.
export type SourceId =
  | "arxiv" | "core" | "europepmc" | "ncbi" | "openaire" | "biorxiv" | "medrxiv" | "doaj" | "plos" | "datacite" | "openalex"
  | "crossref" | "unpaywall" | "opencitations" | "preprints";

export type SearchFilters = {
  source?: string[];
  yearFrom?: number;
  yearTo?: number;
  publicationType?: string[];
  openAccessOnly?: boolean;
};

export type SearchSort = "relevance" | "date" | "date_asc" | "citations" | "citations_asc";

/** An order a source can be asked to read in: every sort but relevance, which
 * is the order every source reads in unless asked otherwise. */
export type SourceSort = Exclude<SearchSort, "relevance">;

export type SearchParams = {
  q?: string;
  doi?: string;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: SearchSort;
};
