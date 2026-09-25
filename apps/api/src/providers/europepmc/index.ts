import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, translateId, translateIds, type TranslateOptions } from './translate';
import { fetchPage, EuropePmcUnavailableError, type FetchOptions } from './fetch';
import { normalize, type SkippedRecord } from './normalize';

/**
 * Europe PMC as a provider: capabilities, a pure translate, one I/O call, and a
 * pure normalise.
 *
 * The assembly is deliberately thin. It owns no timeout, swallows no error and
 * makes no open-access decision — those are the orchestrator's, and keeping
 * them out is what lets the same provider be driven differently by a search, a
 * DOI lookup, or a fixture-recording script.
 */

export { capabilities, translate, translateId, translateIds, fetchPage, normalize, EuropePmcUnavailableError };
export type { TranslateOptions, FetchOptions, SkippedRecord };

export type SearchOptions = TranslateOptions &
  Omit<FetchOptions, 'pageSize' | 'resultType'> & {
    pageSize?: number;
    offset?: number;
    /** Clock injected so the result is reproducible in tests. */
    now?: () => Date;
  };

export type ProviderSearchResult = {
  papers: Paper[];
  /** Europe PMC's own count of everything matching, for the ProviderReport. */
  totalHits?: number;
  /** Records that could not be read, so the caller can report rather than hide them. */
  skipped: SkippedRecord[];
  latency: number;
};

/**
 * At most this many by-id requests per read.
 *
 * Europe PMC throttles at 10 requests a second and 500 a minute — stated by
 * Europe PMC staff on its developer forum, 24 March 2020 — and a throttled
 * caller is answered with an empty body rather than a status, which is the
 * `{"version":"6.9"}` that `assertSearchResponse` exists for. Eight, plus the id
 * list before them, keeps one search's burst at nine.
 */
const MAX_BATCHES = 8;

/**
 * The smallest batch worth a request. 75 is what 600, the default depth, splits
 * into across `MAX_BATCHES`; a deeper read grows the batches rather than their
 * number, up to 125 at the 1,000 `capabilities.maxPageSize` allows.
 */
const MIN_BATCH = 75;

function batches<T>(items: readonly T[]): T[][] {
  const size = Math.max(MIN_BATCH, Math.ceil(items.length / MAX_BATCHES));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A search read: the ranked id list, then the full records by id in parallel.
 *
 * Not one `core` request for the whole depth, which is what this was and what
 * kept missing the fan-out budget. Europe PMC answers the first byte of a
 * `core` page in a second or two and then assembles the body record by record,
 * at a rate that varies with its load rather than with the network — no gap
 * over half a second in the stream, just a slow one. Measured 2026-09-25 on
 * two 600-record reads, eight runs: 8.9–27.9 s, mean 16, three past the 20 s
 * budget. The same 600 ids come back as an `idlist` in 0.4–2.8 s, and fetching
 * their records in eight parallel batches of 75 made the whole read 3.1–9.7 s,
 * mean 5.5. Parallel `core` pages are not an alternative: Europe PMC ignores
 * `page` (see `fetch.ts`), and `cursorMark` is sequential.
 *
 * Checked for parity on three queries against the single `core` read: the same
 * hit count, the same records in the same order, and identical `normalize`
 * output for all 1,421 papers.
 *
 * Any batch that fails fails the read, as a page does in `read-pages.ts` — a
 * short read reported as a whole one is the failure `ProviderReport` exists to
 * prevent.
 */
export async function search(
  query: Query,
  options: SearchOptions
): Promise<ProviderSearchResult> {
  const {
    openAccessOnly,
    pageSize = 50,
    offset = 0,
    now = () => new Date(),
    ...fetchOptions
  } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  const started = Date.now();

  // The offset is taken from the list rather than asked of Europe PMC, which
  // has no parameter for it; so a read reaches at most `maxPageSize` deep.
  const start = Math.max(offset, 0);
  const listed = await fetchPage(nativeQuery, {
    ...fetchOptions,
    resultType: 'idlist',
    pageSize: Math.min(start + Math.max(pageSize, 1), capabilities.maxPageSize)
  });
  const ids = (listed.resultList?.result ?? [])
    .slice(start)
    .map((raw: any) => (raw?.id != null ? String(raw.id) : ''));

  const pages = await Promise.all(
    batches(ids.filter(Boolean)).map(batch =>
      fetchPage(translateIds(batch), { ...fetchOptions, resultType: 'core', pageSize: batch.length })
    )
  );

  const latency = Date.now() - started;

  const byId = new Map<string, unknown>();
  for (const page of pages) {
    for (const raw of page.resultList?.result ?? []) {
      const id = (raw as any)?.id;
      if (id != null) byId.set(String(id), raw);
    }
  }

  // One record at a time, so each keeps the rank the id list gave it even when
  // a record before it could not be read.
  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];
  const retrievedAt = now().toISOString();
  ids.forEach((id, i) => {
    const raw = id ? byId.get(id) : undefined;
    if (!raw) {
      skipped.push({
        index: start + i,
        ...(id ? { nativeId: id } : {}),
        reason: id ? 'in the id list, but not returned when fetched by id' : 'id list entry has no id'
      });
      return;
    }
    const outcome = normalize({ resultList: { result: [raw] } }, { retrievedAt, rankOffset: start + i, latency });
    papers.push(...outcome.papers);
    skipped.push(...outcome.skipped);
  });

  const reported = Number(listed?.hitCount);

  return {
    papers,
    ...(Number.isFinite(reported) ? { totalHits: reported } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = Omit<FetchOptions, 'pageSize' | 'resultType'> & { now?: () => Date };

/**
 * One paper by its Europe PMC id.
 *
 * The search endpoint again, because Europe PMC has no by-id route — but asked
 * with `translateId`, which is the difference between retrieving the record and
 * searching the abstracts for a number that is not in them. `lookupPaper`
 * checks the answer against the id it asked about, so a page of one is all that
 * is worth reading.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchPage(translateId(nativeId), { ...fetchOptions, pageSize: 1 });
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers[0] ?? null;
}
