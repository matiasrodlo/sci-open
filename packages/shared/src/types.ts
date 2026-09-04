// Every source a record can originate from. The first group are the source
// connectors; the second are the metadata/OA clients the pipeline resolves
// records from directly.
export type OASource =
  | "arxiv" | "core" | "europepmc" | "ncbi" | "openaire" | "biorxiv" | "medrxiv" | "doaj" | "plos" | "opencitations" | "datacite"
  | "openalex" | "crossref" | "unpaywall";

// Provenance attached by the pipeline when a record comes from an aggregator
export type SourceMetadata = {
  source?: string;
  latency?: number;
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
  /** Exact years from the year facet, as opposed to the yearFrom/yearTo bound. */
  year?: string[];
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

// Per-provider breakdown for one search. These are deliberately not summed:
// the corpora overlap heavily, so a total across providers would count the same
// paper many times and mean nothing.
export type ProviderTotal = {
  source: string;
  // The provider's own count of everything matching the query
  totalHits?: number;
  // How many records this search actually pulled back from it, before merging
  retrieved: number;
  error?: string;
};

export type SearchResponse = {
  hits: OARecord[];
  facets: Record<string, any>;
  page: number;
  total: number;
  pageSize: number;
  providerTotals?: ProviderTotal[];
  // Echoed back when the request set them, so a caller can see what applied
  filters?: SearchFilters;
  sort?: SearchSort;
  duration?: number;
  /**
   * False when a provider failed or timed out, which makes `total` a lower
   * bound rather than an answer.
   */
  complete?: boolean;
  /**
   * True when the rescue pass was cut short, which *also* makes `total` a lower
   * bound — for a different reason, and one `complete` cannot express.
   *
   * The open-access gate drops papers on fields the authorities supply, so the
   * papers it would drop are asked about before it drops them. That pass is
   * bounded in number and in time (`SEARCH_RESCUE_LIMIT`, and its own budget),
   * and whatever it did not reach is dropped unasked. So there may be more
   * retrievable open-access papers than `total` says, with every provider
   * having answered perfectly.
   *
   * Kept separate from `complete` rather than folded into it. They are read by
   * different consumers for different purposes: `complete` is the one that says
   * an answer is degraded and should not be *stored*, and a bounded rescue is
   * not degraded — ask again and the same limit cuts the same list at the same
   * place. Folding this in would mean never caching a search whose rescue hit
   * its limit, which for a broad query is most of them.
   */
  bounded?: boolean;
};

