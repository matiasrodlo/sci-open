import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, toParams, type TranslateOptions } from './translate';
import {
  fetchPage, fetchWork, OpenAlexUnavailableError,
  type FetchOptions, type WorkFetchOptions
} from './fetch';
import { normalize, totalHits, reconstructAbstract, type SkippedRecord } from './normalize';

export {
  capabilities, translate, toParams, fetchPage, fetchWork, normalize, totalHits,
  reconstructAbstract, OpenAlexUnavailableError
};
export type { TranslateOptions, FetchOptions, WorkFetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'offset'> & {
    pageSize?: number;
    offset?: number;
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  totalHits?: number;
  skipped: SkippedRecord[];
  latency: number;
};

/**
 * Reads `pageSize` records, across as many requests as OpenAlex's 200-record
 * cap requires.
 *
 * This is the one provider that paginates internally, and it is here because
 * it is the one where the shortfall was measured. `fanOut` asks each provider
 * once, so a `depth` of 600 was returning 200 from OpenAlex while the old
 * path's `discoverWorks` paginated to 600 — 12,000 records against 4,200
 * across a 22-query sweep, and the only part of the two paths' count gap that
 * was lost coverage rather than a deliberate decision.
 *
 * The pages go out together. Walking them in sequence would put a full round
 * trip on the critical path once per page, which is the mistake the old path
 * had already corrected.
 *
 * A failed page fails the whole read. That costs the pages that did succeed,
 * and it is deliberate: `ProviderReport` has no way to say "short by 400", so
 * returning the successful pages would report a partial read as a complete
 * one — the silent-shortfall failure this refactor exists to remove, and the
 * exact shape of the Europe PMC and arXiv defects it already fixed. An
 * incomplete read is reported as an error, and the orchestrator marks the
 * search incomplete.
 *
 * Worth knowing operationally: this multiplies OpenAlex requests by the page
 * count. At the default depth that is three per query rather than one, against
 * a daily budget that a 22-query comparison sweep can already exhaust.
 */
export async function search(query: Query, options: SearchOptions): Promise<ProviderSearchResult> {
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const params = toParams(query, { openAccessOnly });
  if (!params.search && !params.filter) return { papers: [], skipped: [], latency: 0 };

  const wanted = Math.max(pageSize, 1);
  const perPage = capabilities.maxPageSize;
  const pageCount = Math.ceil(wanted / perPage);

  const started = Date.now();

  // Every request asks for a full page. Sizing the last one to the remainder
  // would break the page arithmetic, which derives the page number from
  // `offset / pageSize` — the surplus is trimmed below instead.
  const payloads = await Promise.all(
    Array.from({ length: pageCount }, (_, index) =>
      fetchPage(params, { ...fetchOptions, pageSize: perPage, offset: offset + index * perPage })
    )
  );

  const latency = Date.now() - started;

  const results = payloads.flatMap(payload => payload.results ?? []).slice(0, wanted);
  const { papers, skipped } = normalize({ results }, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  // Every page reports the same corpus-wide count.
  const reported = payloads.map(totalHits).find(count => count !== undefined);

  return {
    papers,
    ...(reported !== undefined ? { totalHits: reported } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = WorkFetchOptions & { now?: () => Date };

/**
 * One paper by its OpenAlex id.
 *
 * OpenAlex merges duplicate works and serves the survivor under either id, so
 * the record that comes back may carry a different id than the one asked for.
 * That is an answer, not a mismatch, and it is returned as it stands.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchWork(nativeId, fetchOptions);
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers[0] ?? null;
}
