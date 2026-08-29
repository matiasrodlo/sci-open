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

export function applyPolicy(
  papers: readonly Paper[],
  filters: UserFilters = {},
  options: PolicyOptions = {}
): Paper[] {
  const { requireFullText = true, requireOpenAccess = true } = options;

  return papers.filter(paper => {
    if (requireOpenAccess && !isOpen(paper)) return false;
    if (requireFullText && !paper.fullText) return false;

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

    if (!matches(filters.oaStatus, paper.oaStatus)) return false;
    if (!matches(filters.stage, paper.stage)) return false;
    if (!matches(filters.venue, paper.venue)) return false;
    if (!matches(filters.publisher, paper.publisher)) return false;

    if (filters.topics?.length) {
      if (!paper.topics.some(t => filters.topics!.includes(t))) return false;
    }

    return true;
  });
}
