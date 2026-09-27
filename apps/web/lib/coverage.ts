import { isStructured, parseExpression } from '@open-access-explorer/shared';
import type { ProviderTotal, SearchFilters } from '@open-access-explorer/shared';

/**
 * What the reported total is a total *of*.
 *
 * `SearchResponse.total` is the length of the filtered set, and the filtered
 * set is built from a fixed number of records per provider — `SEARCH_DEPTH`,
 * 600 by default — not from everything that matched. The header called that
 * number "retrievable open-access papers", which reads as a count of the
 * corpus, and it is not one. Measured on `ai`, minutes apart, same query, same
 * day:
 *
 * | providers that answered | reported total |
 * |---|---|
 * | 3 | 1,716 |
 * | 5 | 2,891 |
 *
 * The number moved by 1,175 because two more sources answered, not because two
 * more days of literature appeared. It is `depth × providers that answered`,
 * less duplicates and less what the gates dropped, and a reader had nothing to
 * tell them that. The warning banner did not help: it appears only when a
 * provider fails, so its absence read as "this count is complete", when a
 * healthy search is bounded by depth in exactly the same way.
 *
 * So the page shows what matches rather than what was read — see `Matching` —
 * and it needs two facts from the per-provider reports to do it.
 */
export type Coverage = {
  /**
   * True when at least one source held more matches than this search read from
   * it — which is when `total` is a window and not an answer.
   *
   * False for a query narrow enough that every source was read to the end. The
   * count really is the whole set then, and saying otherwise would be its own
   * kind of lie.
   */
  truncated: boolean;
  /**
   * A floor on how many papers match, across all of them: the largest single
   * source's count.
   *
   * The largest rather than the sum, for the reason `ProviderCoverage` gives
   * for never adding these up — the corpora overlap heavily, so a sum counts
   * the same paper several times. The largest is the one figure that is
   * certainly not an overstatement: the union is at least as big as its biggest
   * member. Hence the `+`.
   *
   * Absent when nothing was truncated, and when no source reported a total at
   * all (bioRxiv declares `reportsTotal: false`, and a failed provider reports
   * nothing).
   */
  matching?: number;
};

/**
 * The one count the page shows for a search — in the header, in the search
 * history and in the pagination line alike.
 *
 * It used to be what this search read, and the header named the matching
 * figure beside it: "1,716 retrieved of 684,999+ matching". The retrieved half
 * is the number that moves with how many sources happened to answer, so it is
 * the one a reader should not be handed as the size of their search. What
 * matches is shown instead, everywhere, and the read depth is explained once,
 * in `ProviderCoverage`, where it bears on what the list and facets can hold.
 */
export type Matching = {
  count: number;
  /**
   * Where `count` came from, which decides whether it is a floor and how the
   * page explains it.
   *
   * - `exact` — every source was read to the end, so the count is the set.
   * - `source` — the largest single source's own count. A floor: see
   *   `Coverage.matching`.
   * - `read` — what this search read and kept. Also a floor, since every paper
   *   in it matches. Used when the sources' own counts do not describe the
   *   question (see `sourceCountsApply`), and when the reads outnumber the
   *   largest of them — several sources each read to depth can hold more
   *   between them than the biggest one reports.
   */
  basis: 'exact' | 'source' | 'read';
};

export function matchingOf(total: number, coverage: Coverage, sourceCountsApply: boolean): Matching {
  if (!coverage.truncated) return { count: total, basis: 'exact' };

  if (sourceCountsApply && coverage.matching !== undefined && coverage.matching > total) {
    return { count: coverage.matching, basis: 'source' };
  }

  return { count: total, basis: 'read' };
}

/**
 * Filters the API applies to what the sources returned, rather than sending to
 * them.
 *
 * `yearFrom` and `yearTo` are not here: they go into the query, and every
 * provider that reports a count expresses them upstream, so its count already
 * describes the range. Everything else is a facet, applied by the orchestrator
 * after the fan-out — no source's count knows about it.
 */
const LOCAL_FILTERS = ['source', 'year', 'oaStatus', 'venue', 'publisher', 'topics', 'publicationType'] as const;

/** True when a facet narrows the set after the sources have answered. */
export function filtersNarrow(filters: SearchFilters): boolean {
  return LOCAL_FILTERS.some(key => (filters[key]?.length ?? 0) > 0);
}

/**
 * Whether the sources' own counts are counts of what was asked.
 *
 * Two things narrow a search after the sources answer, and a source's count
 * knows about neither. A ticked facet is applied to the read, not sent. And a
 * structured query — a field tag, `OR`, `NOT` — is *widened* for every source
 * that cannot express it: OpenAIRE is asked `crispr` for `AU=Doudna AND
 * crispr`, and its count is then of every paper about CRISPR. Shown as the
 * size of that search, it would claim hundreds of thousands for a query that
 * matches a few hundred, and `#1 NOT #3` would read as the same size as `#1` —
 * a narrowing that did nothing, which is exactly what the search history's
 * counts exist to reveal.
 *
 * In either case the only count that is true of the question is the one taken
 * after the narrowing, which is the read.
 */
export function sourceCountsApply(query: string, filters: SearchFilters): boolean {
  if (filtersNarrow(filters)) return false;

  try {
    // Parsed as the API parses it, so "structured" means the same thing here
    // as it does to the providers that widen it.
    return !isStructured(parseExpression(query));
  } catch {
    // The API accepted this query or there would be no count to label, so a
    // parse failure here is a disagreement between the two; the read is the
    // number that cannot overstate.
    return false;
  }
}

/** The count as a figure: `684,999+`, or `53` when it is the whole set. */
export function countLabel(matching: Matching): string {
  return `${matching.count.toLocaleString()}${matching.basis === 'exact' ? '' : '+'}`;
}

/**
 * The count, said in words that are true of it, for the header.
 *
 * A string rather than markup because it is one phrase either way, and because
 * a phrase is testable — including the singular, which an older wording got
 * wrong in a way nobody would notice until a DOI lookup matched one paper and
 * the header said "1 retrievable open-access papers".
 *
 * "Open-access" only for the exact count. That one is the set this service
 * holds, after the open-access gate; a floor from a source's own count is of
 * everything that source matched, readable or not.
 */
export function totalLabel(matching: Matching): string {
  const noun = matching.count === 1 ? 'paper' : 'papers';

  return matching.basis === 'exact'
    ? `${countLabel(matching)} open-access ${noun}`
    : `${countLabel(matching)} matching ${noun}`;
}

/** What the `+` means, for whoever hovers over it. */
export function matchingNote(matching: Matching): string | undefined {
  switch (matching.basis) {
    case 'exact':
      return undefined;
    case 'source':
      return 'At least this many: the largest single source’s own count. The sources overlap, so they are not added up — together they hold more.';
    case 'read':
      return 'At least this many: the papers read from each source that match. Each source is read only to a fixed depth, so more match than this.';
  }
}

/**
 * How `toSearchResponse` spells a skip.
 *
 * `ProviderTotal` has one field for "why this contributed nothing", so a skip
 * travels as a prefixed `error`. The prefix is the only thing separating "we
 * chose not to ask" from "we asked and it broke", and it was being compared
 * against a string literal at three call sites. One place knows the encoding.
 */
const SKIPPED = 'skipped: ';

/** Declined to guess: never asked, and not a sign of anything wrong. */
export function isSkipped(provider: ProviderTotal): boolean {
  return provider.error?.startsWith(SKIPPED) ?? false;
}

/** Asked, and did not answer. The one that makes the total a lower bound. */
export function isFailed(provider: ProviderTotal): boolean {
  return provider.error !== undefined && !isSkipped(provider);
}

/**
 * Skipped providers grouped by the reason they gave, in first-appearance
 * order.
 *
 * Grouped because the reasons repeat — six providers decline a DOI query for
 * one reason between them — and six lines saying the same thing is worse than
 * one line naming six providers. It is also why this cannot go back to a
 * single hardcoded sentence: on a keyword query the three that decline give
 * three different reasons, and only one of them is the one the panel used to
 * print for all of them.
 */
export function skipsByReason(
  providers: readonly ProviderTotal[]
): Array<{ reason: string; sources: string[] }> {
  const groups = new Map<string, string[]>();

  for (const provider of providers) {
    if (!isSkipped(provider)) continue;
    const reason = provider.error!.slice(SKIPPED.length).trim();
    const sources = groups.get(reason);
    if (sources) sources.push(provider.source);
    else groups.set(reason, [provider.source]);
  }

  // `Array.from` rather than a spread over the Map's iterator, which this
  // package's compilation target does not allow.
  return Array.from(groups, ([reason, sources]) => ({ reason, sources }));
}

/**
 * Reads the per-provider reports for what the header needs.
 *
 * A provider that errored or was skipped is ignored: it retrieved nothing and
 * its corpus count is unknown, so it can neither prove the read was truncated
 * nor raise the floor. That a failed source *also* makes the total a lower
 * bound is a separate statement, made separately — see `ProviderCoverage`.
 */
export function coverageOf(providers: readonly ProviderTotal[]): Coverage {
  const answered = providers.filter(p => !p.error && typeof p.totalHits === 'number');

  const truncated = answered.some(p => p.totalHits! > p.retrieved);
  if (!truncated) return { truncated: false };

  const matching = Math.max(...answered.map(p => p.totalHits!));

  // Zero is a real count — PLOS answers `ai` with it — but it cannot be a floor
  // that says anything, and `truncated` cannot be true on a zero-hit provider
  // anyway. Guarded so an odd report cannot put "0+ matching" on the page.
  return matching > 0 ? { truncated, matching } : { truncated };
}
