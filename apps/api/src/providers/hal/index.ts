import type { CountedFacet, FacetCount, Paper, PaperStage, Query, SourceFacets } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, translateId, type TranslateOptions } from './translate';
import {
  fetchPage,
  fetchFacets,
  FACET_FIELDS,
  HalUnavailableError,
  type FacetField,
  type FetchOptions,
  type HalFacetPayload
} from './fetch';
import type { ProviderFacetArgs, ProviderFacetOutcome } from '../count-facets';
import { normalize, totalHits, STAGES, type SkippedRecord } from './normalize';

/**
 * HAL as a provider: capabilities, a pure translate, one I/O module, and a
 * pure normalise. Thin for the reason Europe PMC's is: it owns no timeout,
 * swallows no error and makes no open-access decision of its own beyond the
 * one HAL's records require — see `READ` in `fetch.ts`.
 */

export { capabilities, translate, translateId, fetchPage, fetchFacets, normalize, totalHits, HalUnavailableError };
export type { TranslateOptions, FetchOptions, SkippedRecord };

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
 * One request, whatever the depth: HAL serves up to 10,000 rows a page, past
 * the deepest read the orchestrator asks for.
 */
export async function search(query: Query, options: SearchOptions): Promise<ProviderSearchResult> {
  const { openAccessOnly, pageSize = 50, offset = 0, now = () => new Date(), ...fetchOptions } = options;

  const nativeQuery = translate(query, { openAccessOnly });
  if (!nativeQuery) return { papers: [], skipped: [], latency: 0 };

  const started = Date.now();
  const payload = await fetchPage(nativeQuery, {
    ...fetchOptions,
    pageSize: Math.min(Math.max(pageSize, 1), capabilities.maxPageSize),
    offset
  });

  const latency = Date.now() - started;
  const { papers, skipped } = normalize(payload, {
    retrievedAt: now().toISOString(),
    rankOffset: offset,
    latency
  });

  const reported = totalHits(payload);
  return {
    papers,
    ...(reported !== undefined ? { totalHits: reported } : {}),
    skipped,
    latency
  };
}

export type LookupOptions = Omit<FetchOptions, 'pageSize' | 'offset'> & { now?: () => Date };

/**
 * One paper by its HAL id — `hal-04020890`, `inserm-03121840`.
 *
 * Read through the same filter as a search, so an id resolves only to a record
 * a search could have returned: a thesis, or a file since put under embargo,
 * answers `null`.
 */
export async function lookup(nativeId: string, options: LookupOptions): Promise<Paper | null> {
  const { now = () => new Date(), ...fetchOptions } = options;

  const started = Date.now();
  const payload = await fetchPage(translateId(nativeId), { ...fetchOptions, pageSize: 1, offset: 0 });
  const latency = Date.now() - started;

  const { papers } = normalize(payload, { retrievedAt: now().toISOString(), latency });
  return papers.find(paper => paper.sources[0]?.nativeId === nativeId) ?? null;
}

/** Solr's flat `[value, count, value, count]` into pairs. */
function pairs(flat: unknown[] | undefined): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  for (let i = 0; i + 1 < (flat?.length ?? 0); i += 2) {
    const count = Number(flat![i + 1]);
    if (Number.isFinite(count) && count > 0) out.push([String(flat![i]), count]);
  }
  return out;
}

function toFacets(facets: readonly CountedFacet[], payload: HalFacetPayload): SourceFacets {
  const fields = payload.facet_counts?.facet_fields ?? {};
  const out: SourceFacets = {};

  for (const facet of facets) {
    switch (facet) {
      case 'year':
        out.year = pairs(fields[FACET_FIELDS.year])
          .map(([year, count]): FacetCount => ({ value: Number(year), count }))
          .filter(bucket => Number.isInteger(bucket.value) && (bucket.value as number) > 0);
        break;
      case 'stage': {
        // Several types share a stage, and a record has one type, so their
        // counts add exactly.
        const byStage = new Map<PaperStage, number>();
        for (const [type, count] of pairs(fields[FACET_FIELDS.stage])) {
          const stage = STAGES[type];
          if (stage) byStage.set(stage, (byStage.get(stage) ?? 0) + count);
        }
        out.stage = [...byStage].map(([value, count]) => ({ value, count }));
        break;
      }
      // Named exactly as `normalize` names a paper. A venue is counted by
      // journal alone: a conference paper with a journal is named by its
      // journal, and counting its conference too would put it in a bucket that
      // ticking would not return. A floor, never more.
      case 'venue':
        out.venue = pairs(fields[FACET_FIELDS.venue]).map(([value, count]) => ({ value, count }));
        break;
      case 'publisher':
        out.publisher = pairs(fields[FACET_FIELDS.publisher]).map(([value, count]) => ({ value, count }));
        break;
    }
  }

  return out;
}

/**
 * Year, stage, venue and publisher counts across everything HAL reads from,
 * one request for each distinct query among the facets asked for — so one
 * request unless a ticked year or stage lifts a facet onto a query of its own.
 * The year window is not used: one facet answers every year.
 */
export async function facets(args: ProviderFacetArgs): Promise<ProviderFacetOutcome> {
  const byQuery = new Map<string, CountedFacet[]>();
  for (const { facet, query } of args.requests) {
    if (!(facet in FACET_FIELDS)) continue;
    const native = translate(query, { openAccessOnly: args.openAccessOnly });
    if (!native) continue;
    byQuery.set(native, [...(byQuery.get(native) ?? []), facet]);
  }

  const settled = await Promise.allSettled(
    [...byQuery].map(async ([native, asked]) => {
      const payload = await fetchFacets(native, {
        timeoutMs: args.timeoutMs,
        fields: asked.map(facet => FACET_FIELDS[facet as keyof typeof FACET_FIELDS]) as FacetField[],
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {})
      });
      return toFacets(asked, payload);
    })
  );

  const counted: SourceFacets = {};
  const failures: string[] = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') Object.assign(counted, result.value);
    else failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
  }

  return { facets: counted, failures };
}
