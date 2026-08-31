import type { OaRoute, Paper, PaperStage } from '@open-access-explorer/shared';

/**
 * What the caller asked to see, and what the service will serve.
 *
 * Two things used to be tangled here. The OA and retrievability rules were
 * hard filters buried in the middle of `applyFilters`, applied to every search
 * whether or not it asked for them and invisible from outside; and
 * `filters.oaStatus` was declared, documented, and faceted, but never read, so
 * filtering on it silently returned everything.
 *
 * Both are request options now, with defaults that preserve the previous
 * behaviour.
 *
 * The two halves are separable — `matchesFilters` for what the caller ticked,
 * `passesPolicy` for the two gates the service applies on its own — because
 * only the second half asks questions an authority can answer. See
 * `partitionByPolicy` and `rescue.ts`.
 */

export type PolicyOptions = {
  /** Only papers with a retrievable copy. Default true — this is what made `total` mean "retrievable". */
  requireFullText?: boolean;
  /** Only papers that are open by some route or stage. Default true. */
  requireOpenAccess?: boolean;
};

export type UserFilters = {
  source?: string[];
  yearFrom?: number;
  yearTo?: number;
  /**
   * Exact years, as sent by the year facet. Distinct from the `yearFrom`/
   * `yearTo` bound: the facet offers a set of discrete years to tick, not a
   * range. Both apply when both are present.
   */
  year?: string[];
  oaStatus?: string[];
  stage?: string[];
  venue?: string[];
  publisher?: string[];
  topics?: string[];
};

const OPEN_ROUTES: readonly OaRoute[] = ['gold', 'green', 'hybrid', 'bronze'];
const OPEN_STAGES: readonly PaperStage[] = ['preprint', 'accepted', 'published'];

/**
 * Whether a paper counts as open.
 *
 * A route from Unpaywall settles it. Without one — everything before
 * enrichment runs — fall back to the stage, which is what the old hard filter
 * used. `closed` is believed: it is a positive statement, not a missing value.
 */
export function isOpen(paper: Paper): boolean {
  if (paper.oaStatus === 'closed') return false;
  if (OPEN_ROUTES.includes(paper.oaStatus)) return true;
  return OPEN_STAGES.includes(paper.stage);
}

function matches(values: string[] | undefined, candidate: string | undefined): boolean {
  if (!values || values.length === 0) return true;
  return candidate !== undefined && values.includes(candidate);
}

/**
 * The filters the caller ticked.
 *
 * Every one of these reads a field the providers supplied, so the answer does
 * not change between the fan-out and enrichment — which is what lets the
 * partition below treat a paper that fails one of these as settled.
 */
export function matchesFilters(paper: Paper, filters: UserFilters = {}): boolean {
  // A paper is attributed to any provider that returned it, so filtering by
  // source keeps it if any of them match — the old shape could only ever
  // match the single source it recorded.
  if (filters.source?.length) {
    if (!paper.sources.some(s => filters.source!.includes(s.provider))) return false;
  }

  // An undated paper is excluded by a year bound rather than passing it.
  // The old filter guarded on `record.year` being present, so a record with
  // no year satisfied every year filter.
  if (filters.yearFrom !== undefined || filters.yearTo !== undefined) {
    if (paper.year === undefined) return false;
    if (filters.yearFrom !== undefined && paper.year < filters.yearFrom) return false;
    if (filters.yearTo !== undefined && paper.year > filters.yearTo) return false;
  }

  // The year facet ticks exact years. Compared as strings because that is
  // what the facet emits and what arrives in the query string; `p.year` is a
  // number, so one side has to be converted either way.
  if (filters.year?.length) {
    if (paper.year === undefined) return false;
    if (!filters.year.includes(String(paper.year))) return false;
  }

  if (!matches(filters.oaStatus, paper.oaStatus)) return false;
  if (!matches(filters.stage, paper.stage)) return false;
  if (!matches(filters.venue, paper.venue)) return false;
  if (!matches(filters.publisher, paper.publisher)) return false;

  if (filters.topics?.length) {
    if (!paper.topics.some(t => filters.topics!.includes(t))) return false;
  }

  return true;
}

/** The two gates the service applies whether or not the caller mentioned them. */
export function passesPolicy(paper: Paper, options: PolicyOptions = {}): boolean {
  const { requireFullText = true, requireOpenAccess = true } = options;
  if (requireOpenAccess && !isOpen(paper)) return false;
  if (requireFullText && !paper.fullText) return false;
  return true;
}

export function applyPolicy(
  papers: readonly Paper[],
  filters: UserFilters = {},
  options: PolicyOptions = {}
): Paper[] {
  return papers.filter(paper => passesPolicy(paper, options) && matchesFilters(paper, filters));
}

export type PolicyPartition = {
  /** Passes everything. Returned without anyone being asked about it. */
  kept: Paper[];
  /**
   * Fails only a gate an authority could still answer differently, in the
   * ranked order they arrived in.
   */
  candidates: Paper[];
};

/**
 * Splits the ranked set into what is already admitted and what is only
 * excluded by a gate an authority might reopen.
 *
 * `passesPolicy` reads `fullText`, `oaStatus` and `stage`, and all three are
 * fields the authorities fill — so a paper failing that check has not been
 * judged on what is knowable about it, only on what the providers happened to
 * say. `matchesFilters` reads nothing an authority supplies first, so a paper
 * failing *that* is settled and is neither kept nor a candidate.
 *
 * A candidate must carry a DOI, because that is the only key the authorities
 * are asked by. A paper with no DOI and no copy is excluded exactly as before;
 * there is no question left to ask about it.
 */
export function partitionByPolicy(
  papers: readonly Paper[],
  filters: UserFilters = {},
  options: PolicyOptions = {}
): PolicyPartition {
  const kept: Paper[] = [];
  const candidates: Paper[] = [];

  for (const paper of papers) {
    if (!matchesFilters(paper, filters)) continue;
    if (passesPolicy(paper, options)) kept.push(paper);
    else if (paper.doi) candidates.push(paper);
  }

  return { kept, candidates };
}
