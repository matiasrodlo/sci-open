import { readFileSync } from 'fs';
import type { Paper, SearchParams, SearchResponse } from '@sci-open/shared';
import type { CitationLink, Engine, FullTextDocument } from '@sci-open/core';

/**
 * Recorded answers in place of the sources: how the protocol tests, the
 * tool-selection evals and demos run with the network off. In `src/` rather
 * than `test/` because the stdio binary serves it too (`--engine fixture`).
 *
 * Every `Engine` method needs an entry here, which is the point: when the type
 * grows, this file stops compiling until the fixture grows with it.
 */
export type Fixtures = {
  searches: Record<string, SearchResponse>;
  papers: Record<string, Paper>;
  /** DOIs the DOI system holds though no paper here carries them. */
  registeredDois?: string[];
  /** Full texts, by paper id. A paper without one has no legal copy. */
  documents?: Record<string, FullTextDocument>;
  /** OpenCitations links, by `references|<doi>` or `cited_by|<doi>`, the DOI
   * lower-cased. A paper without an entry has no links. */
  citations?: Record<string, CitationLink[]>;
};

/** The key a list of citation links is recorded and found under. */
export const citationKey = (doi: string, direction: 'references' | 'cited_by'): string =>
  `${direction}|${doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`;

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
    // As the live engine does: an arXiv id without a version names any version.
    async lookup(id) {
      if (fixtures.papers[id]) return fixtures.papers[id]!;
      if (!id.startsWith('arxiv:') || /v\d+$/i.test(id)) return null;
      return Object.values(fixtures.papers).find(p => p.id.replace(/v\d+$/i, '') === id) ?? null;
    },
    async lookupDoi(doi) {
      return byDoi(doi);
    },
    async doiRegistered(doi) {
      return byDoi(doi) !== null || registered.has(doi.toLowerCase());
    },
    async readFullText(paper) {
      return fixtures.documents?.[paper.id] ?? null;
    },
    async citationLinks(doi, direction) {
      return fixtures.citations?.[citationKey(doi, direction)] ?? [];
    },
    // Every recorded paper stands in for OpenAlex's record of its DOI.
    async resolveDois(dois) {
      const found = new Map<string, Paper>();
      for (const doi of dois) {
        const paper = byDoi(doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''));
        if (paper) found.set(paper.doi!.toLowerCase(), paper);
      }
      return { found, unasked: [] };
    }
  };
}

function emptyResponse(params: SearchParams): SearchResponse {
  return {
    papers: [], total: 0, page: params.page ?? 1, pageSize: params.pageSize ?? 10,
    facets: {}, complete: true, bounded: false, countsFromSources: false, providers: []
  };
}
