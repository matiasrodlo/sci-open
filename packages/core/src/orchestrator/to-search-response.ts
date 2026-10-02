import { toOARecord } from '@open-access-explorer/shared';
import type { ProviderTotal, SearchFilters, SearchResponse, SearchResponseV2, SearchSort } from '@open-access-explorer/shared';
import type { OrchestratorResult } from './index';

/**
 * Orchestrator result -> version 1 of the response.
 *
 * Version 1's contract is `OARecord`, so the orchestrator's `Paper`s are
 * flattened on the way out. Everything richer that it knows — field
 * provenance, every provider that returned a paper, the access route — is
 * dropped here; `toSearchResponseV2` below is where it is kept.
 *
 * `complete` is the one addition. It is optional, and a consumer that does
 * not know about it is unaffected.
 *
 * `result.authorities` is deliberately not folded into `providerTotals`. An
 * authority never returns a paper, so it has no `retrieved` to report, and
 * listing it beside the search providers would put a row in the response that
 * the source facet and `filters.source` both disagree with. Version 2 reports
 * authorities in a list of their own.
 */
export function toSearchResponse(
  result: OrchestratorResult,
  echo: { filters?: SearchFilters; sort?: SearchSort } = {}
): SearchResponse {
  const providerTotals: ProviderTotal[] = result.reports.map(report => ({
    source: report.provider,
    ...(report.totalHits !== undefined ? { totalHits: report.totalHits } : {}),
    retrieved: report.retrieved,
    // A skipped provider is not an error, but the reason belongs in the one
    // field the old shape has for saying why a provider contributed nothing.
    ...(report.error !== undefined
      ? { error: report.error }
      : report.skipReason !== undefined
        ? { error: `skipped: ${report.skipReason}` }
        : {})
  }));

  return {
    hits: result.papers.map(toOARecord),
    facets: result.facets as Record<string, any>,
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
    providerTotals,
    ...(echo.filters !== undefined ? { filters: echo.filters } : {}),
    ...(echo.sort !== undefined ? { sort: echo.sort } : {}),
    duration: result.duration,
    complete: result.complete,
    // The other reason `total` can be a lower bound, and the one `complete` has
    // no way to say. It was previously visible only in a debug log, so a reader
    // was shown a bounded count with nothing to indicate it was one. The rest of
    // `RescueReport` — how many candidates there were, how many were examined —
    // stays internal: it describes the work, and this describes the answer.
    bounded: result.rescue.bounded,
    // Whether `providerTotals[].totalHits` counts this search or a larger one.
    // The facets need no flag beside them: each bucket names the source its
    // count came from, and one taken from the read names none.
    countsFromSources: result.countsFromSources
  };
}

/**
 * Orchestrator result -> version 2 of the response: the page's `Paper`s as the
 * pipeline holds them, the facets typed, and every provider's and authority's
 * report whole. See `SearchResponseV2` for what version 1 loses on the way.
 */
export function toSearchResponseV2(
  result: OrchestratorResult,
  echo: { filters?: SearchFilters; sort: SearchSort }
): SearchResponseV2 {
  return {
    papers: result.papers,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    sort: echo.sort,
    ...(echo.filters !== undefined ? { filters: echo.filters } : {}),
    facets: result.facets,
    complete: result.complete,
    bounded: result.rescue.bounded,
    countsFromSources: result.countsFromSources,
    providers: result.reports,
    authorities: result.authorities,
    duration: result.duration
  };
}
