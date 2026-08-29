import { describe, it, expect } from 'vitest';
import type { OASource } from '@open-access-explorer/shared';
import { EnhancedSearchPipeline } from '../enhanced-search-pipeline';
import type { EnrichedRecord } from '../merge';

const pipeline = new EnhancedSearchPipeline({ userAgent: 'test/1.0 (mailto:test@example.com)' });
const call = (method: string, ...args: unknown[]) => (pipeline as any)[method](...args);

function rec(over: Partial<EnrichedRecord> & { sourceId: string; source: OASource }): EnrichedRecord {
  return {
    id: `${over.source}:${over.sourceId}`,
    title: 'Untitled',
    authors: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    ...over
  } as EnrichedRecord;
}

// Every record here is open access and has a PDF. applyFilters drops anything
// that is not, before it looks at a single user filter — see the hard-filter
// block below.
const PDF = 'https://example.org/paper.pdf';

const CORPUS: EnrichedRecord[] = [
  rec({ source: 'europepmc', sourceId: '1', title: 'Beta', year: 2020, venue: 'Nature', publisher: 'Springer', oaStatus: 'published', citationCount: 10, authors: ['Bell'], topics: ['genomics', 'crispr'], bestPdfUrl: PDF }),
  rec({ source: 'arxiv', sourceId: '2', title: 'Alpha', year: 2022, venue: 'arXiv', publisher: 'Cornell', oaStatus: 'preprint', citationCount: 5, authors: ['Ada'], topics: ['crispr'], bestPdfUrl: PDF }),
  rec({ source: 'ncbi', sourceId: '3', title: 'Gamma', year: 2018, venue: 'Cell', publisher: 'Elsevier', oaStatus: 'published', citationCount: 99, authors: ['Cox'], topics: ['genomics'], bestPdfUrl: PDF })
];

describe('sortResults', () => {
  const titles = (sort: string) => call('sortResults', [...CORPUS], sort).map((r: EnrichedRecord) => r.title);

  it('sorts by date, newest first', () => expect(titles('date')).toEqual(['Alpha', 'Beta', 'Gamma']));
  it('sorts by date ascending', () => expect(titles('date_asc')).toEqual(['Gamma', 'Beta', 'Alpha']));
  it('sorts by citations, most cited first', () => expect(titles('citations')).toEqual(['Gamma', 'Beta', 'Alpha']));
  it('sorts by citations ascending', () => expect(titles('citations_asc')).toEqual(['Alpha', 'Beta', 'Gamma']));
  it('sorts by title', () => expect(titles('title')).toEqual(['Alpha', 'Beta', 'Gamma']));
  it('sorts by title descending', () => expect(titles('title_desc')).toEqual(['Gamma', 'Beta', 'Alpha']));
  it('sorts by first author', () => expect(titles('author')).toEqual(['Alpha', 'Beta', 'Gamma']));
  it('sorts by venue', () => expect(titles('venue')).toEqual(['Alpha', 'Gamma', 'Beta']));

  it('leaves relevance order untouched', () => {
    expect(titles('relevance')).toEqual(['Beta', 'Alpha', 'Gamma']);
  });

  it('never drops or adds records', () => {
    for (const sort of ['date', 'citations', 'title', 'author', 'venue', 'relevance']) {
      expect(call('sortResults', [...CORPUS], sort)).toHaveLength(CORPUS.length);
    }
  });
});

describe('applyFilters', () => {
  const filtered = (filters: unknown) => call('applyFilters', CORPUS, filters);

  it('returns everything when no filters are given', () => {
    expect(filtered(undefined)).toHaveLength(3);
  });

  it('filters by source', () => {
    expect(filtered({ source: ['arxiv'] }).map((r: EnrichedRecord) => r.title)).toEqual(['Alpha']);
  });

  it('filters by year range, inclusive at both ends', () => {
    expect(filtered({ yearFrom: 2020, yearTo: 2022 })).toHaveLength(2);
    expect(filtered({ yearFrom: 2020, yearTo: 2020 })).toHaveLength(1);
  });

  /**
   * KNOWN DEFECT — flips to passing when phase 6 builds the policy filter.
   *
   * `oaStatus` is declared on `SearchFilters` in the shared package, is part
   * of the documented request body, and the pipeline generates an `oaStatus`
   * facet listing its buckets — but `applyFilters` never reads it. The only
   * oaStatus test in the function is the hard OA gate. A client that filters
   * on it gets the unfiltered set back with no indication the filter was
   * dropped. No user-visible symptom today only because the web UI does not
   * render that facet yet.
   */
  it.fails('filters by OA status', () => {
    expect(filtered({ oaStatus: ['preprint'] }).map((r: EnrichedRecord) => r.title)).toEqual(['Alpha']);
  });

  it('filters by venue and by publisher', () => {
    expect(filtered({ venue: ['Cell'] }).map((r: EnrichedRecord) => r.title)).toEqual(['Gamma']);
    expect(filtered({ publisher: ['Springer'] }).map((r: EnrichedRecord) => r.title)).toEqual(['Beta']);
  });

  it('filters by topic', () => {
    expect(filtered({ topics: ['crispr'] })).toHaveLength(2);
  });

  it('combines filters conjunctively', () => {
    expect(filtered({ source: ['europepmc', 'arxiv'], yearFrom: 2021 }).map((r: EnrichedRecord) => r.title)).toEqual(['Alpha']);
  });

  it('returns nothing when a filter matches nothing', () => {
    expect(filtered({ source: ['datacite'] })).toHaveLength(0);
  });

  it('lets a record with no year through a year bound', () => {
    // Pins current behaviour: the year predicates are guarded on `record.year`,
    // so an undated record is never excluded by a year filter rather than
    // being treated as out of range.
    const undated = [rec({ source: 'arxiv', sourceId: 'x', title: 'Undated', oaStatus: 'preprint', bestPdfUrl: PDF })];
    expect(call('applyFilters', undated, { yearFrom: 2030 })).toHaveLength(1);
  });
});

describe('applyFilters — the two hard filters', () => {
  // These run whatever the user asked for, which is why the result count is
  // "retrievable open-access papers" rather than everything that matched.
  // Phase 6 turns them into an explicit request option.
  it('drops records that are not open access', () => {
    const closed = [rec({ source: 'crossref', sourceId: 'c', oaStatus: 'other', bestPdfUrl: PDF })];
    expect(call('applyFilters', closed, undefined)).toHaveLength(0);
  });

  it('drops records with no PDF anywhere on them', () => {
    const noPdf = [rec({ source: 'europepmc', sourceId: 'n', oaStatus: 'published' })];
    expect(call('applyFilters', noPdf, undefined)).toHaveLength(0);
  });

  it('accepts a record whose PDF is on pdfUrl rather than bestPdfUrl', () => {
    const alt = [rec({ source: 'europepmc', sourceId: 'p', oaStatus: 'published', pdfUrl: PDF } as any)];
    expect(call('applyFilters', alt, undefined)).toHaveLength(1);
  });

  it('keeps preprints as well as published records', () => {
    const both = [
      rec({ source: 'arxiv', sourceId: 'a', oaStatus: 'preprint', bestPdfUrl: PDF }),
      rec({ source: 'europepmc', sourceId: 'b', oaStatus: 'published', bestPdfUrl: PDF })
    ];
    expect(call('applyFilters', both, undefined)).toHaveLength(2);
  });
});

describe('facet generation', () => {
  const facets = () => call('generateFacets', CORPUS);
  const sum = (buckets: { count: number }[]) => buckets.reduce((t, b) => t + b.count, 0);

  it('produces a bucket list for each facet the UI renders', () => {
    expect(Object.keys(facets()).sort()).toEqual(
      ['oaStatus', 'publisher', 'source', 'topics', 'venue', 'year'].sort()
    );
  });

  it.each(['source', 'year', 'oaStatus', 'venue', 'publisher'])(
    'the %s buckets sum to the number of records',
    key => {
      // The invariant the whole facet panel rests on: selecting a bucket must
      // narrow the result set by exactly the count shown. Facets counted over
      // a different set than the one that produced the hits break it.
      expect(sum(facets()[key])).toBe(CORPUS.length);
    }
  );

  it('counts topics per occurrence, since a record carries several', () => {
    // topics is the one multi-valued facet, so it legitimately sums higher
    expect(sum(facets().topics)).toBe(4);
    expect(facets().topics.find((b: any) => b.value === 'crispr').count).toBe(2);
  });

  it('counts each source exactly once per record', () => {
    const source = facets().source;
    expect(source).toHaveLength(3);
    source.forEach((b: any) => expect(b.count).toBe(1));
  });

  it('returns empty buckets for an empty result set rather than throwing', () => {
    const empty = call('generateFacets', []);
    Object.values(empty).forEach(buckets => expect(buckets).toEqual([]));
  });
});

describe('facet truncation', () => {
  // One record per venue, so the venue facet has as many buckets as records.
  const wide: EnrichedRecord[] = Array.from({ length: 200 }, (_, i) =>
    rec({
      source: 'europepmc',
      sourceId: String(i),
      title: `Paper ${i}`,
      year: 2020,
      venue: `Journal ${i}`,
      publisher: `Publisher ${i}`,
      topics: [`topic-${i}`],
      oaStatus: 'published',
      bestPdfUrl: PDF
    })
  );

  const facets = () => call('generateFacets', wide);

  it.each(['venue', 'publisher', 'topics'])('caps the open-ended %s facet', key => {
    // Without this the response carries a bucket per distinct value — measured
    // at 3,079 topics against a panel that renders fifteen.
    expect(facets()[key].length).toBe(25);
  });

  it('keeps the largest buckets, not an arbitrary slice', () => {
    const skewed = [
      ...wide,
      ...Array.from({ length: 30 }, (_, i) =>
        rec({
          source: 'europepmc',
          sourceId: `hot-${i}`,
          title: `Hot ${i}`,
          year: 2020,
          venue: 'Nature',
          oaStatus: 'published',
          bestPdfUrl: PDF
        })
      )
    ];
    const venues = call('generateFacets', skewed).venue;
    expect(venues[0]).toEqual({ value: 'Nature', count: 30 });
  });

  it('leaves the bounded facets whole', () => {
    // source is capped by the provider list and oaStatus by its vocabulary, so
    // truncating them would hide a filter the user can legitimately apply.
    const mixed = [
      ...wide,
      rec({ source: 'arxiv', sourceId: 'a', year: 2019, oaStatus: 'preprint', bestPdfUrl: PDF })
    ];
    const f = call('generateFacets', mixed);
    expect(f.source.map((b: any) => b.value).sort()).toEqual(['arxiv', 'europepmc']);
    expect(f.oaStatus.map((b: any) => b.value).sort()).toEqual(['preprint', 'published']);
  });

  it('does not pad a facet that is already short', () => {
    expect(facets().source.length).toBe(1);
  });

  it('leaves counts accurate on the buckets it keeps', () => {
    // Truncation drops buckets; it must never rescale the ones that remain,
    // or selecting a facet stops narrowing by the number shown.
    const venues = facets().venue;
    venues.forEach((b: any) => expect(b.count).toBe(1));
  });
});

/**
 * Discovery is the one place an OpenAlex failure used to be fatal rather than
 * partial: its output feeds `.map(work => work.doi)` with nothing in between,
 * so a page that came back without records took the whole search down instead
 * of costing one provider. These run against a stubbed client — the failure
 * being reproduced is a resolved 429, which no network call can be relied on
 * to produce on demand.
 */
describe('discoverWorks — a failed provider costs one provider', () => {
  const withClient = (searchWorks: (...args: any[]) => Promise<any>) => {
    const p = new EnhancedSearchPipeline({ userAgent: 'test/1.0 (mailto:test@example.com)' });
    (p as any).openalexClient = { searchWorks };
    return (...args: unknown[]) => (p as any).discoverWorks(...args);
  };

  const rateLimited = () =>
    Object.assign(new Error('OpenAlex 429: Insufficient budget.'), { status: 429 });

  it('returns no works instead of throwing', async () => {
    const discover = withClient(() => Promise.reject(rateLimited()));

    const discovery = await discover('crispr', {}, 50);
    expect(discovery.works).toEqual([]);
  });

  it('never puts an undefined in the works array', async () => {
    // The original crash in one assertion: a resolved response with no
    // `results` used to be flattened in as `undefined`, and the caller read a
    // field off it. Whatever else discovery returns, every entry is a work.
    const discover = withClient(() => Promise.resolve({ meta: { count: 5 } }));

    const discovery = await discover('crispr', {}, 50);
    expect(discovery.works.every((w: unknown) => w !== undefined && w !== null)).toBe(true);
  });

  it('reports why it returned nothing, so an outage is not read as an empty corpus', async () => {
    const discover = withClient(() => Promise.reject(rateLimited()));

    const discovery = await discover('crispr', {}, 50);
    expect(discovery.error).toContain('429');
  });

  it('sets no error when the provider simply matched nothing', async () => {
    const discover = withClient(() => Promise.resolve({ results: [], meta: { count: 0 } }));

    const discovery = await discover('nothing matches this', {}, 50);
    expect(discovery.works).toEqual([]);
    expect(discovery.totalHits).toBe(0);
    expect(discovery.error).toBeUndefined();
  });

  it('keeps the pages that did answer when only some fail', async () => {
    // Depth 400 is two pages at OpenAlex's 200 cap. Losing one is not a
    // reason to discard the other.
    let call = 0;
    const discover = withClient(() =>
      ++call === 1
        ? Promise.resolve({ results: [{ id: 'W1', doi: '10.1/x' }], meta: { count: 2 } })
        : Promise.reject(rateLimited())
    );

    const discovery = await discover('crispr', {}, 400);
    expect(discovery.works).toHaveLength(1);
    expect(discovery.totalHits).toBe(2);
    expect(discovery.error).toContain('429');
  });
});
