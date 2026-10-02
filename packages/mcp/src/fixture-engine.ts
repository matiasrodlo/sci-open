import { readFileSync } from 'fs';
import type { Paper, SearchParams, SearchResponseV2 } from '@open-access-explorer/shared';
import { UpstreamStats, type Engine } from '@open-access-explorer/core';

/**
 * Recorded answers in place of the sources: how the protocol tests, the
 * tool-selection evals and demos run with the network off. In `src/` rather
 * than `test/` because the stdio binary serves it too (`--engine fixture`).
 *
 * Every `Engine` method needs an entry here, which is the point: when the type
 * grows, this file stops compiling until the fixture grows with it.
 */
export type Fixtures = {
  searches: Record<string, SearchResponseV2>;
  papers: Record<string, Paper>;
  /** DOIs the DOI system holds though no paper here carries them. */
  registeredDois?: string[];
};

/** The key a search is recorded and found under. Filters, sort and page size
 * are left out on purpose: the set stays small, and what the evals score is
 * which tool was called and how, not the exact page. */
export const fixtureKey = (params: SearchParams): string =>
  JSON.stringify({ q: params.q, doi: params.doi, page: params.page ?? 1 });

export function loadFixtures(file: string): Fixtures {
  return JSON.parse(readFileSync(file, 'utf8')) as Fixtures;
}

/** `strict` (the tests' default) throws on a search nobody recorded; lenient —
 * evals, demos — answers it with an empty, complete set. */
export function fixtureEngine(fixtures: Fixtures, options: { strict?: boolean } = {}): Engine {
  const strict = options.strict ?? true;
  const byDoi = (doi: string) => Object.values(fixtures.papers).find(p => p.doi?.toLowerCase() === doi.toLowerCase()) ?? null;
  const registered = new Set((fixtures.registeredDois ?? []).map(d => d.toLowerCase()));
  return {
    userAgent: 'sci-open-mcp fixture engine',
    stats: new UpstreamStats(),
    async search(params, options = {}) {
      const key = fixtureKey(params);
      const response = fixtures.searches[key];
      if (!response && strict) throw new Error(`no fixture for ${key}`);
      // The recorded reports, replayed as source progress. A live held set
      // reports none; this is how the protocol test sees the path offline.
      const asked = (response?.providers ?? []).filter(r => r.status !== 'skipped');
      asked.forEach((report, i) => options.onProgress?.({ stage: 'sources', settled: i + 1, planned: asked.length, report }));
      // Recorded, so nothing is ever re-run: every page reads as held.
      return { response: response ?? emptyResponse(params), fromCache: true };
    },
    // A count is the recorded search's reports: the same per-source totalHits
    // a live count reads, from one request per source.
    async count(params) {
      const key = fixtureKey({ ...params, page: 1 });
      const response = fixtures.searches[key];
      if (!response && strict) throw new Error(`no fixture for ${key}`);
      const reports = response?.providers ?? [];
      return { reports, complete: reports.every(r => r.status === 'ok' || r.status === 'skipped') };
    },
    async lookup(id) {
      return fixtures.papers[id] ?? null;
    },
    async lookupDoi(doi) {
      return byDoi(doi);
    },
    async doiRegistered(doi) {
      return byDoi(doi) !== null || registered.has(doi.toLowerCase());
    }
  };
}

function emptyResponse(params: SearchParams): SearchResponseV2 {
  return {
    papers: [], total: 0, page: params.page ?? 1, pageSize: params.pageSize ?? 10, sort: params.sort ?? 'relevance',
    facets: {}, complete: true, bounded: false, countsFromSources: false, providers: [], authorities: [], duration: 0
  };
}
