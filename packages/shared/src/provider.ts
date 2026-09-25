import type { PaperStage, ProviderId, ProvenancedField } from './paper';

/**
 * What happened when the orchestrator asked one provider, and what that
 * provider is able to do in the first place.
 */

/**
 * `ProviderTotal` records a count; this records an outcome as well.
 *
 * The distinction is not academic. Measured during phase 01: Europe PMC
 * returned `retrieved: 0` on one run and 600 on the next, and nothing in the
 * response distinguished a timeout from a query that genuinely matched
 * nothing. A user cannot tell a quiet corpus from a broken one, and neither
 * could we.
 */
export type ProviderStatus = 'ok' | 'timeout' | 'error' | 'skipped';

export type ProviderReport = {
  provider: ProviderId;
  status: ProviderStatus;
  /** Records this request actually pulled back, before merging. */
  retrieved: number;
  /**
   * The provider's own count of everything matching, when it reports one.
   * Never summed across providers: the corpora overlap heavily, so a total
   * would count the same paper many times over.
   */
  totalHits?: number;
  /** Present when `status` is `error` or `timeout`. */
  error?: string;
  latency: number;
  /** Why it was not asked. Present when `status` is `skipped`. */
  skipReason?: string;
  /**
   * Why this provider's whole-index facet counts are missing, when it was
   * asked for them and did not supply them.
   *
   * Kept apart from `error` because the two failures mean different things. A
   * failed search is a hole in the results and makes the search incomplete; a
   * failed count only lowers a floor — every facet bucket is the largest single
   * source's count, so losing one source can make a bucket smaller and never
   * wrong — and the search it came with is whole.
   */
  facetError?: string;
};

/**
 * What a provider's API can do — facts, not predictions.
 *
 * Strictly descriptive on purpose. The layer this replaces scored sources on
 * estimated latency and expected coverage, adjusted those estimates from
 * observed performance, and then did not change which providers were queried;
 * 1,553 lines of it were deleted in phase 02. Anything here should be
 * checkable against the provider's documentation, so that when the
 * orchestrator skips a provider it can say exactly which capability was
 * missing.
 */
export type ProviderCapabilities = {
  /**
   * Worth sending a keyword query to.
   *
   * Not the same as "has a keyword index", which is what this used to say and
   * what the UI went on to tell readers. Three providers declare it false and
   * only one of them lacks an index: bioRxiv's API offers date windows and
   * nothing else, while CORE is too slow to answer inside the budget and
   * DataCite's records never survive the retrievability filter. Both of those
   * have a perfectly good index and are declined for a reason of our own.
   *
   * So a `false` here says nothing about why, and `skipReason` has to.
   */
  keywordSearch: boolean;
  /** Can resolve a DOI to a single record. */
  doiLookup: boolean;
  /**
   * Why this provider declines a capability, in words a reader can be shown.
   *
   * Required for each of `keywordSearch` and `doiLookup` that is false —
   * enforced by `capabilities.test.ts`, since the type cannot say "required
   * when that other field is false" without turning this object into a union.
   *
   * It exists because the reason was being invented at the far end. `plan.ts`
   * produced "no keywordSearch capability", which is the mechanical fact and
   * not a reason, and the panel rendered every skip as "no keyword index for
   * it" — true of bioRxiv, false of the other two, and unfalsifiable from
   * where it was written. The provider knows why it is being skipped; nothing
   * downstream does, so nothing downstream should be guessing.
   *
   * Kept short: it is shown after the provider's name in one muted line.
   */
  skipReason?: {
    keywordSearch?: string;
    doiLookup?: string;
    fieldedSearch?: string;
  };
  /**
   * Can scope a clause to a field — `AU=`, `SO=`, `TI=` — in its own query
   * syntax.
   *
   * False for the two providers whose API has nowhere to put one: OpenAIRE
   * takes keywords and no query language at all, and OpenAlex takes filters
   * whose search keys cannot be combined with `OR` or negated.
   *
   * It decides whether the provider is asked, and only for a query that is
   * *entirely* field-scoped. `AU=Doudna AND TS=crispr` still goes to both of
   * them, as `crispr`, and the evaluator applies the author clause afterwards;
   * `AU=Doudna` alone leaves them nothing to search for. Before this existed
   * they were asked anyway, answered `retrieved: 0`, and the coverage panel
   * printed `0 · 0` beside their names — which reads as "this source has no
   * papers by that author" and is a statement nobody made.
   */
  fieldedSearch: boolean;
  /** Fields this provider actually populates. */
  fields: readonly ProvenancedField[];
  /** Can express a year bound in the query, rather than us filtering after. */
  yearFilter: boolean;
  /** Largest page the API will serve in one request. */
  maxPageSize: number;
  /** Reports a corpus-wide match count, so `totalHits` can be filled in. */
  reportsTotal: boolean;
  /** Supplies a citation count. */
  suppliesCitations: boolean;
  /**
   * The versions of a work this provider's records can be — what `normalize`
   * sets `Paper.stage` to — and whether a query can ask for only some of them.
   *
   * `holds` is what lets `plan` skip a provider rather than ask it something it
   * cannot answer: arXiv holds only preprints, so a search for peer-reviewed
   * papers has nothing to send it. `filter` is whether the provider can narrow
   * to a stage when it holds more than one; a provider that holds one stage
   * never needs to, since asking it at all is the whole of the narrowing.
   */
  stages: {
    holds: readonly PaperStage[];
    filter: boolean;
  };
  /**
   * The facets this provider can count over **everything it matches**, rather
   * than over the records a search reads from it.
   *
   * The read is the top `depth` records, and a facet counted over it describes
   * the top of the answer: on `ai`, OpenAlex matched 983,815 open papers and
   * the year facet said 964 of them were from 2026, where OpenAlex's own count
   * for that year is 424,757. A reader looking at the panel to see how much
   * work there is on a topic was being shown the size of our read.
   *
   * Only what the API can actually answer. Two providers aggregate natively —
   * OpenAlex's `group_by` and PLOS's Solr facets — and answer every facet they
   * list in one request each. The rest can only be asked for a count, so a year
   * facet costs them one request per year and they list it only where that is
   * affordable: arXiv asks for three seconds between requests, so it lists only
   * `stage` — every record it holds is a preprint, so that count is its total,
   * which its search already reports.
   */
  facets: readonly CountedFacet[];
};

/**
 * The facets a provider can count across its whole index. The names are the
 * facet keys the search response carries.
 */
export type CountedFacet = 'year' | 'stage' | 'venue' | 'publisher' | 'topics';

/** One value of a facet and how many papers carry it. */
export type FacetCount = { value: string | number; count: number };

/**
 * One provider's counts across everything it matches, per facet. A facet it was
 * not asked for, or could not count, is absent rather than empty: empty says
 * the provider has no papers carrying any value of it, which is a claim.
 */
export type SourceFacets = Partial<Record<CountedFacet, FacetCount[]>>;

/** True when the provider can serve this query at all. */
export function canServe(
  capabilities: ProviderCapabilities,
  query: { doi?: string; years?: { from?: number; to?: number } }
): boolean {
  if (query.doi) return capabilities.doiLookup;
  if (!capabilities.keywordSearch) return false;
  // A year bound the provider cannot express is not disqualifying on its own —
  // the orchestrator can filter afterwards — so it is not tested here. The
  // capability exists so that decision is explicit rather than accidental.
  return true;
}
