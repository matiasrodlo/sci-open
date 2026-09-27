import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, toParams, type TranslateOptions } from './translate';
import {
  fetchPage, fetchWork, fetchGroups, OpenAlexUnavailableError,
  type FetchOptions, type WorkFetchOptions, type OpenAlexGroup
} from './fetch';
import { normalize, totalHits, reconstructAbstract, STAGES, type SkippedRecord } from './normalize';
import type { CountedFacet, FacetCount, PaperStage, SourceFacets } from '@open-access-explorer/shared';
import type { ProviderFacetArgs, ProviderFacetOutcome } from '../count-facets';

export {
  capabilities, translate, toParams, fetchPage, fetchWork, fetchGroups, normalize, totalHits,
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
  // `toParams` returns nothing at all when there is nothing to ask for, which
  // is the whole of the check: an empty query used to leave `is_oa:true`
  // standing on its own, and that filter matches the open-access corpus.
  if (!params.filter) return { papers: [], skipped: [], latency: 0 };

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

/**
 * The field each facet is grouped on, chosen to be the field `normalize` reads
 * that facet's value from — so a bucket names the value the papers carry:
 * `primary_location.source` for the venue and its `host_organization` for the
 * publisher, `topics` for the topics, `type` for the stage.
 */
const GROUP_BY: Record<CountedFacet, string> = {
  year: 'publication_year',
  stage: 'type',
  venue: 'primary_location.source.id',
  publisher: 'primary_location.source.host_organization',
  topics: 'topics.id'
};

/**
 * The venues a venue or publisher bucket may name: journals and conferences.
 *
 * Grouped over everything, the largest "venues" for `ai` were Zenodo
 * (237,346), arXiv, SSRN and Figshare, and the largest "publishers" the
 * organisations that run them — repositories a paper is deposited in, not
 * where it was published, crowding every journal off the list. Restricting
 * which sources are grouped changes no journal's count, since a journal's
 * bucket never held repository deposits; it only decides which buckets are
 * listed. Measured 2026-09-25: Scientific Reports, IEEE Access, Applied
 * Sciences; Elsevier, MDPI, Springer.
 *
 * Not applied to a search for preprints alone. A preprint's venue *is* a
 * repository — bioRxiv, medRxiv, Research Square — and with the restriction
 * the facet listed eLife and nothing else from OpenAlex.
 */
const PUBLISHED_VENUES = 'primary_location.source.type:journal|conference';

function preprintsOnly(query: Query): boolean {
  return !!query.stages?.length && query.stages.every(stage => stage === 'preprint');
}

/** `https://openalex.org/types/article` → `article`. Older responses say `article`. */
function typeOf(key: unknown): string {
  return String(key ?? '').replace(/^https?:\/\/openalex\.org\/types\//i, '');
}

function toBuckets(facet: CountedFacet, groups: readonly OpenAlexGroup[]): FacetCount[] {
  const valid = groups.filter(group => Number.isFinite(Number(group.count)) && Number(group.count) > 0);

  if (facet === 'year') {
    return valid
      .map(group => ({ value: Number(group.key), count: Number(group.count) }))
      .filter(bucket => Number.isInteger(bucket.value) && bucket.value > 0);
  }

  if (facet === 'stage') {
    // Several types share a stage — `article` and `book-chapter` are both
    // published — and a work has one type, so their counts add exactly.
    const byStage = new Map<PaperStage, number>();
    for (const group of valid) {
      const stage = STAGES[typeOf(group.key)];
      if (!stage || stage === 'unknown') continue;
      byStage.set(stage, (byStage.get(stage) ?? 0) + Number(group.count));
    }
    return [...byStage].map(([value, count]) => ({ value, count }));
  }

  // Named by their display name, which is what `normalize` puts on a paper.
  return valid
    .map(group => ({ value: String(group.key_display_name ?? '').trim(), count: Number(group.count) }))
    .filter(bucket => bucket.value !== '' && bucket.value.toLowerCase() !== 'unknown');
}

export type FacetOptions = { apiKey?: string };

/**
 * Every facet, across everything OpenAlex matches, from `group_by` — one
 * request a facet, all at once. The year window is not used: a year group
 * answers every year in one request.
 */
export async function facets(args: ProviderFacetArgs, options: FacetOptions = {}): Promise<ProviderFacetOutcome> {
  const settled = await Promise.allSettled(
    args.requests.map(async ({ facet, query }) => {
      const params = toParams(query, { openAccessOnly: args.openAccessOnly });
      // Nothing to ask — see `toParams` — is a facet with no values, not a
      // request for the whole open-access corpus.
      if (!params.filter) return { facet, buckets: [] as FacetCount[] };
      const listed = (facet === 'venue' || facet === 'publisher') && !preprintsOnly(query)
        ? { ...params, filter: `${params.filter},${PUBLISHED_VENUES}` }
        : params;
      const groups = await fetchGroups(listed, GROUP_BY[facet], {
        timeoutMs: args.timeoutMs,
        ...(options.apiKey ? { apiKey: options.apiKey } : {}),
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {})
      });
      return { facet, buckets: toBuckets(facet, groups) };
    })
  );

  const counted: SourceFacets = {};
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') counted[result.value.facet] = result.value.buckets;
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  return { facets: counted, failures };
}
