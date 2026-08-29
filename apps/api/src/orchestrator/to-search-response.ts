import { toOARecord } from '@open-access-explorer/shared';
import type { ProviderTotal, SearchFilters, SearchResponse, SearchSort } from '@open-access-explorer/shared';
import type { OrchestratorResult } from './index';

/**
 * Orchestrator result -> the response shape the API already returns.
 *
 * This is what lets the new path run behind a flag without the frontend
 * moving. Everything richer that the orchestrator knows — field provenance,
 * every provider that returned a paper, the access route — is flattened away
 * here, which is the cost of keeping the contract stable and the reason to
 * move the frontend onto `Paper` in phase 11.
 *
 * `complete` is the one addition. It is optional, the old path never sets it,
 * and a consumer that does not know about it is unaffected.
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
