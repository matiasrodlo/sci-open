import { toOARecord } from '@open-access-explorer/shared';
import type { ProviderTotal, SearchFilters, SearchResponse, SearchSort } from '@open-access-explorer/shared';
import type { OrchestratorResult } from './index';

/**
 * Orchestrator result -> the response shape the API returns.
 *
 * `OARecord` is the external contract, so the orchestrator builds `Paper`s
 * and flattens on the way out. Everything richer that it knows — field
 * provenance, every provider that returned a paper, the access route — is
 * dropped here. That is the price of a stable contract; surfacing it is a
 * response-shape change rather than anything this function can decide.
 *
 * `complete` is the one addition. It is optional, and a consumer that does
 * not know about it is unaffected.
 *
 * `result.authorities` is deliberately not folded into `providerTotals`. An
 * authority never returns a paper, so it has no `retrieved` to report, and
 * listing it beside the search providers would put a row in the response that
 * the source facet and `filters.source` both disagree with. It belongs with
 * `fieldSources` in that response-shape change, having the same problem for
 * the same reason.
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
    complete: result.complete
  };
}
