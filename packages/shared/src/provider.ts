import type { ProviderId, ProvenancedField } from './paper';

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
  };
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
};

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
