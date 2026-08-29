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

export type PlannedProvider = {
  provider: ProviderEntry;
  /** Set when the provider cannot express a year bound and we will filter after. */
  filterYearsLocally: boolean;
};

export type SkippedProvider = {
  provider: ProviderId;
  /** Names the capability that was missing, so a skip is explainable. */
  reason: string;
};

export type Plan = {
  planned: PlannedProvider[];
  skipped: SkippedProvider[];
};

export function plan(query: Query, providers: readonly ProviderEntry[]): Plan {
  const planned: PlannedProvider[] = [];
  const skipped: SkippedProvider[] = [];

  for (const provider of providers) {
    const { capabilities: caps, id } = provider;

    if (query.doi) {
      if (caps.doiLookup) planned.push({ provider, filterYearsLocally: false });
      else skipped.push({ provider: id, reason: 'no doiLookup capability' });
      continue;
    }

    if (!caps.keywordSearch) {
      skipped.push({ provider: id, reason: 'no keywordSearch capability' });
      continue;
    }

    // A year bound a provider cannot express is not disqualifying — it reads
    // wider and the orchestrator filters afterwards. Recorded so the cost is
    // visible rather than accidental.
    const wantsYears = query.years?.from !== undefined || query.years?.to !== undefined;
    planned.push({ provider, filterYearsLocally: wantsYears && !caps.yearFilter });
  }

  return { planned, skipped };
}
