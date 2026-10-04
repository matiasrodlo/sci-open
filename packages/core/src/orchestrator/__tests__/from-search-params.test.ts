import { describe, it, expect } from 'vitest';
import type { Query, SearchParams } from '@sci-open/shared';
import type { ProviderEntry } from '../registry';
import { runSearch, toUserFilters } from '../from-search-params';
import { paper, ref } from './helpers';

/**
 * The conversion at the edge of the new path: what a request means once it
 * stops being `SearchParams` and starts being a `Query` plus options.
 *
 * A stub provider records the Query it was handed, so these assert what the
 * orchestrator was actually asked rather than what came back from it — the
 * fan-out has its own tests, and the interesting failures here are a filter
 * that silently does nothing.
 */

type Recorded = { query: Query; openAccessOnly: boolean; depth: number };

function recorder(papers = pageOf(3)): { entry: ProviderEntry; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const entry: ProviderEntry = {
    id: 'europepmc',
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true,
      maxPageSize: 1000, reportsTotal: true,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: () => 'native',
    search: async ({ query, openAccessOnly, depth }) => {
      calls.push({ query, openAccessOnly, depth });
      return { papers, totalHits: papers.length, skipped: [] };
    }
  };
  return { entry, calls };
}

const pageOf = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    paper({
      id: `europepmc:${i}`,
      title: `Study ${i}`,
      doi: `10.1/e-${i}`,
      year: 2020 + i,
      venue: `Journal ${i}`,
      sources: [ref('europepmc', { nativeId: String(i), rank: i })]
    }));

// Offline: the authorities are real I/O and nothing here is about them.
const run = async (params: SearchParams, providers: ProviderEntry[], extra: { facets?: boolean } = {}) =>
  (await runSearch(params, { providers, authorities: [], ...extra })).response;

describe('toUserFilters', () => {
  it('carries every filter the orchestrator can act on', () => {
    expect(toUserFilters({ source: ['europepmc'], yearFrom: 2020, yearTo: 2024 }))
      .toEqual({ source: ['europepmc'], yearFrom: 2020, yearTo: 2024 });
  });

  it('omits absent filters rather than setting them undefined', () => {
    expect(toUserFilters({})).toEqual({});
  });

  // The old path answered this from which connector returned the record.
  it('answers publicationType from stage', () => {
    expect(toUserFilters({ publicationType: ['peer-reviewed'] }).stage).toEqual(['accepted', 'published']);
    expect(toUserFilters({ publicationType: ['preprint'] }).stage).toEqual(['preprint']);
    expect(toUserFilters({ publicationType: ['peer-reviewed', 'preprint'] }).stage)
      .toEqual(['accepted', 'published', 'preprint']);
  });

  it('drops a publicationType it has no stage for, rather than filtering everything out', () => {
    expect(toUserFilters({ publicationType: ['dataset'] }).stage).toBeUndefined();
  });
});

describe('runSearch: what the providers are asked', () => {
  it('parses the query text into terms and phrases', async () => {
    const { entry, calls } = recorder();
    await run({ q: '"gut microbiome" obesity' }, [entry]);

    expect(calls[0]!.query.phrases).toEqual(['gut microbiome']);
    expect(calls[0]!.query.terms).toEqual(['obesity']);
    expect(calls[0]!.query.join).toBe('AND');
  });

  it('puts year bounds in the query so a provider can express them upstream', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr', filters: { yearFrom: 2022, yearTo: 2024 } }, [entry]);

    expect(calls[0]!.query.years).toEqual({ from: 2022, to: 2024 });
  });

  it('asks no source a year range that ends before it starts, however it arose', async () => {
    // Filters out of order, and PY= disjoint from the filter, each intersect
    // to an empty range. Each used to cost a whole fan-out for an answer that
    // could only be empty.
    for (const params of [
      { q: 'crispr', filters: { yearFrom: 2024, yearTo: 2020 } },
      { q: 'crispr PY=2010', filters: { yearFrom: 2020 } }
    ] satisfies SearchParams[]) {
      const { entry, calls } = recorder();
      const response = await run(params, [entry]);

      expect(calls, JSON.stringify(params)).toEqual([]);
      expect(response.total).toBe(0);
      expect(response.complete).toBe(true);
    }
  });

  it('leaves years unset when neither bound was given', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr' }, [entry]);

    expect(calls[0]!.query.years).toBeUndefined();
  });

  it('recognises a DOI typed into q', async () => {
    const { entry, calls } = recorder();
    await run({ q: '10.1038/s41586-020-2008-3' }, [entry]);

    expect(calls[0]!.query.doi).toBe('10.1038/s41586-020-2008-3');
    expect(calls[0]!.query.terms).toEqual([]);
  });

  // The old path never read `params.doi` at all.
  it('prefers the doi field over q when both are set', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr', doi: '10.1038/s41586-020-2008-3' }, [entry]);

    expect(calls[0]!.query.doi).toBe('10.1038/s41586-020-2008-3');
  });

  it('returns a closed paper with no copy only when the request includes closed papers', async () => {
    const closed = paper({
      id: 'europepmc:9', title: 'A closed study', doi: '10.1/closed', oaStatus: 'closed', fullText: undefined,
      sources: [ref('europepmc', { nativeId: '9' })]
    });
    const { entry } = recorder([closed]);

    expect((await run({ q: 'crispr' }, [entry])).total).toBe(0);
    expect((await run({ q: 'crispr', filters: { openAccessOnly: false } }, [entry])).papers.map(p => p.id)).toEqual(['europepmc:9']);
  });

  it('asks for open access only unless the request says otherwise', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr' }, [entry]);
    await run({ q: 'crispr', filters: { openAccessOnly: false } }, [entry]);

    expect(calls[0]!.openAccessOnly).toBe(true);
    expect(calls[1]!.openAccessOnly).toBe(false);
  });
});

describe('runSearch: the response', () => {
  it('is a page of the set, with every provider\'s report', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', page: 1, pageSize: 2 }, [entry]);

    expect(response.papers).toHaveLength(2);
    expect(response.total).toBe(5);
    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(2);
    expect(response.providers).toHaveLength(1);
    expect(response.providers[0]).toMatchObject({ provider: 'europepmc', status: 'ok', totalHits: 5, retrieved: 5 });
  });

  it('defaults to the first page of twenty', async () => {
    const { entry } = recorder(pageOf(30));
    const response = await run({ q: 'crispr' }, [entry]);

    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(20);
    expect(response.papers).toHaveLength(20);
  });

  it('reports completeness, and the failure that cost it', async () => {
    const { entry } = recorder();
    expect((await run({ q: 'crispr' }, [entry])).complete).toBe(true);

    const failing: ProviderEntry = { ...entry, search: async () => { throw new Error('upstream down'); } };
    const response = await run({ q: 'crispr' }, [failing]);
    expect(response.complete).toBe(false);
    expect(response.providers[0]?.error).toContain('upstream down');
  });

  it('applies the requested sort to the whole set, not to the page', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', sort: 'date', pageSize: 2 }, [entry]);

    // pageOf ascends by year, so a date sort has to bring the last ones forward.
    expect(response.papers.map(p => p.year)).toEqual([2024, 2023]);
  });
});

/**
 * The year bound and the publication types are sent to the sources, so that a
 * search for 2024 reads 2024 from each of them and counts 2024 across all they
 * hold — rather than narrowing a read of the top of their whole answer. The
 * stage facet is counted with its own selection lifted, so selecting
 * preprints leaves the other stages countable.
 */
describe('facets sent to the sources, and counted by them', () => {
  type Counted = { facet: string; query: Query };

  function counter(): { entry: ProviderEntry; searched: Query[]; counted: Counted[] } {
    const searched: Query[] = [];
    const counted: Counted[] = [];
    const entry: ProviderEntry = {
      id: 'openalex',
      capabilities: {
        keywordSearch: true, fieldedSearch: false, doiLookup: true,
        maxPageSize: 200, reportsTotal: true,
        stages: { holds: ['preprint', 'published', 'unknown'], filter: true },
        facets: ['year', 'stage', 'venue', 'publisher', 'topics']
      },
      translate: () => 'native',
      search: async ({ query }) => {
        searched.push(query);
        return { papers: pageOf(3), totalHits: 5000, skipped: [] };
      },
      facets: async ({ requests }) => {
        counted.push(...requests);
        return { facets: { year: [{ value: 2021, count: 999 }] }, failures: [] };
      },
      facetsAggregate: true
    };
    return { entry, searched, counted };
  }

  const queryFor = (counted: Counted[], facet: string) => counted.find(c => c.facet === facet)?.query;

  const IN_2024 = { yearFrom: 2024, yearTo: 2024 };

  it('sends a year range as a bound, and a type as stages', async () => {
    const { entry, searched } = counter();
    await run({ q: 'crispr', filters: { ...IN_2024, publicationType: ['preprint'] } }, [entry]);

    expect(searched[0]!.years).toEqual({ from: 2024, to: 2024 });
    expect(searched[0]!.stages).toEqual(['preprint']);
  });

  it('counts nothing across the sources unless asked, though they were sent everything', async () => {
    // Dozens of requests a search, for facets only some callers show.
    const { entry, counted } = counter();
    const response = await run({ q: 'crispr', filters: IN_2024 }, [entry]);

    expect(counted).toEqual([]);
    expect(response.countsFromSources).toBe(true);
    expect(response.facets.year).not.toContainEqual({ value: 2021, count: 999 });
  });

  it('counts the stage facet with its own selection lifted', async () => {
    const { entry, counted } = counter();
    await run({ q: 'crispr', filters: { ...IN_2024, publicationType: ['preprint'] } }, [entry], { facets: true });

    // The type facet: every type, still only 2024.
    expect(queryFor(counted, 'stage')!.years).toEqual({ from: 2024, to: 2024 });
    expect(queryFor(counted, 'stage')!.stages).toBeUndefined();
    // Everything else: the search as sent.
    expect(queryFor(counted, 'year')!.years).toEqual({ from: 2024, to: 2024 });
    expect(queryFor(counted, 'year')!.stages).toEqual(['preprint']);
    expect(queryFor(counted, 'venue')).toEqual(queryFor(counted, 'topics'));
    expect(queryFor(counted, 'venue')!.stages).toEqual(['preprint']);
  });

  it('raises the facets to the sources’ counts and says the counts describe this search', async () => {
    const { entry } = counter();
    const response = await run({ q: 'crispr', filters: IN_2024 }, [entry], { facets: true });

    expect(response.countsFromSources).toBe(true);
    expect(response.facets.year).toContainEqual({ value: 2021, count: 999 });
  });

  it('counts nothing across the sources when a source filter is set', async () => {
    // A source filter is this service's own label: no source can be sent it,
    // so no source's count describes the search.
    const { entry, counted } = counter();
    const response = await run({ q: 'crispr', filters: { source: ['openalex'] } }, [entry], { facets: true });

    expect(counted).toEqual([]);
    expect(response.countsFromSources).toBe(false);
  });

  it('counts nothing across the sources for a structured query', async () => {
    const { entry, counted } = counter();
    const response = await run({ q: 'AU=Doudna AND crispr' }, [entry], { facets: true });

    expect(counted).toEqual([]);
    expect(response.countsFromSources).toBe(false);
  });
});
