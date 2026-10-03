import type { SearchResponseV2 } from '@sci-open/shared';
import type { OrchestratorResult } from './index';

/**
 * Orchestrator result -> the response: the page's `Paper`s as the pipeline
 * holds them, the facets typed, and every provider's report whole.
 */
export function toSearchResponseV2(result: OrchestratorResult): SearchResponseV2 {
  return {
    papers: result.papers,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    facets: result.facets,
    complete: result.complete,
    bounded: result.rescue.bounded,
    countsFromSources: result.countsFromSources,
    providers: result.reports
  };
}
