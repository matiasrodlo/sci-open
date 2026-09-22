import type { ProviderId, Query } from '@open-access-explorer/shared';
import type { ProviderEntry } from './registry';

/**
 * Which providers can serve this query.
 *
 * Capability filtering only: no scoring, no predicted latency, no coverage
 * estimate. Everything capable is asked. The layer this replaces ranked
 * sources on guesses, learned from observed performance, and then did not
 * change which providers were queried — 1,553 lines deleted in phase 02.
 *
 * Selection can come back later, but only once ProviderReport has produced
 * evidence that some provider is reliably not worth asking. That is a
 * different thing from predicting it in advance.
 */

export type SkippedProvider = {
  provider: ProviderId;
  /**
   * Why, in the provider's own words — `capabilities.skipReason`.
   *
   * It used to be the name of the missing capability, which is the mechanical
   * fact and not a reason: "no keywordSearch capability" says a flag is false
   * and nothing about why. The panel then supplied a why of its own, the same
   * one for every skip, and got it wrong for two of the three providers it
   * regularly names. The reason travels from the provider now.
   *
   * The fallback below is the backstop for a capability declared false with no
   * reason beside it. `capabilities.test.ts` makes that a failing test rather
   * than a string a reader has to interpret.
   */
  reason: string;
};

export type Plan = {
  planned: ProviderEntry[];
  skipped: SkippedProvider[];
};

export function plan(query: Query, providers: readonly ProviderEntry[]): Plan {
  const planned: ProviderEntry[] = [];
  const skipped: SkippedProvider[] = [];

  for (const provider of providers) {
    const { capabilities: caps, id } = provider;

    if (query.doi) {
      if (caps.doiLookup) planned.push(provider);
      else skipped.push({ provider: id, reason: caps.skipReason?.doiLookup ?? 'no doiLookup capability' });
      continue;
    }

    if (!caps.keywordSearch) {
      skipped.push({ provider: id, reason: caps.skipReason?.keywordSearch ?? 'no keywordSearch capability' });
      continue;
    }

    /**
     * A query with nothing left for a keyword-only provider to search.
     *
     * `Query.terms` and `Query.phrases` are the flat, field-less form of the
     * query, and `flatten` only puts a clause there when searching it as body
     * text would be *wider* than the clause — so `AU=Doudna` contributes
     * nothing to them, because requiring "Doudna" in a title is a different and
     * narrower question. A provider that cannot express the field either is
     * left with an empty query.
     *
     * It used to be asked anyway. It answered `retrieved: 0`, and the coverage
     * panel printed `0 · 0` beside its name — which a reader takes as "this
     * source has nothing by that author", a claim the provider never made and
     * nobody checked. Skipping it says the true thing instead, in the
     * provider's own words.
     *
     * Only when the query is *entirely* field-scoped. `AU=Doudna AND TS=crispr`
     * still goes to everyone as `crispr`, and `matchesQuery` applies the author
     * clause to what comes back.
     */
    if (query.expression && !caps.fieldedSearch && query.terms.length === 0 && query.phrases.length === 0) {
      skipped.push({ provider: id, reason: caps.skipReason?.fieldedSearch ?? 'no fieldedSearch capability' });
      continue;
    }

    // A year bound a provider cannot express is not disqualifying — it reads
    // wider, and `applyPolicy` drops the out-of-range papers afterwards for
    // every provider alike, so nothing here has to say so. A
    // `filterYearsLocally` flag used to be computed at this line and read by
    // nobody: the post-filter it described was already unconditional.
    planned.push(provider);
  }

  return { planned, skipped };
}
