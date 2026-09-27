import type { Paper, Query } from '@open-access-explorer/shared';
import { capabilities } from './capabilities';
import { translate, type TranslateOptions } from './translate';
import { fetchPage, fetchFacets, PlosUnavailableError, type FetchOptions, type PlosFacetPayload } from './fetch';
import type { CountedFacet, FacetCount, SourceFacets } from '@open-access-explorer/shared';
import type { ProviderFacetArgs, ProviderFacetOutcome } from '../count-facets';
import { normalize, totalHits, type SkippedRecord } from './normalize';

export { capabilities, translate, fetchPage, fetchFacets, normalize, totalHits, PlosUnavailableError };
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

/** What `normalize` writes as the publisher of every PLOS record. */
const PUBLISHER = 'Public Library of Science';

const SMALL_WORDS = new Set(['and', 'of', 'in', 'the', 'for']);

/**
 * `plos one` → `PLOS ONE`.
 *
 * Solr facets on the indexed form of `journal`, which is lower-cased; the
 * stored form a record carries is not. The journals are few and their names
 * regular, so the display form is rebuilt rather than looked up.
 */
export function journalName(indexed: string): string {
  return indexed
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (word === 'plos' || word === 'one') return word.toUpperCase();
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
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

function toFacets(facets: readonly CountedFacet[], payload: PlosFacetPayload): SourceFacets {
  const total = Number(payload.response?.numFound ?? 0);
  const out: SourceFacets = {};

  for (const facet of facets) {
    switch (facet) {
      // Every record is a published version from one publisher, so both are
      // the total.
      case 'stage':
        out.stage = total > 0 ? [{ value: 'published', count: total }] : [];
        break;
      case 'publisher':
        out.publisher = total > 0 ? [{ value: PUBLISHER, count: total }] : [];
        break;
      case 'venue':
        out.venue = pairs(payload.facet_counts?.facet_fields?.journal)
          .map(([journal, count]): FacetCount => ({ value: journalName(journal), count }));
        break;
      case 'year':
        out.year = pairs(payload.facet_counts?.facet_ranges?.publication_date?.counts)
          .map(([date, count]): FacetCount => ({ value: Number(date.slice(0, 4)), count }))
          .filter(bucket => Number.isInteger(bucket.value));
        break;
    }
  }

  return out;
}

/**
 * Year, stage, venue and publisher counts across everything PLOS matches, one
 * request for each distinct query among the facets asked for — so one request
 * unless a ticked year or stage lifts a facet onto a query of its own.
 */
export async function facets(args: ProviderFacetArgs): Promise<ProviderFacetOutcome> {
  const byQuery = new Map<string, CountedFacet[]>();
  for (const { facet, query } of args.requests) {
    const native = translate(query, { openAccessOnly: args.openAccessOnly });
    if (!native) continue;
    byQuery.set(native, [...(byQuery.get(native) ?? []), facet]);
  }

  const settled = await Promise.allSettled(
    [...byQuery].map(async ([native, facets]) => {
      const payload = await fetchFacets(native, {
        timeoutMs: args.timeoutMs,
        journals: facets.includes('venue'),
        years: facets.includes('year') ? args.years : [],
        ...(args.signal ? { signal: args.signal } : {}),
        ...(args.userAgent ? { userAgent: args.userAgent } : {})
      });
      return toFacets(facets, payload);
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
