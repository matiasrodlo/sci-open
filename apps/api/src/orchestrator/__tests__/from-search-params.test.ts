import { describe, it, expect } from 'vitest';
import type { Query, SearchParams } from '@open-access-explorer/shared';
import type { ProviderEntry } from '../registry';
import { runOrchestrator, toUserFilters } from '../from-search-params';
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

type Recorded = { query: Query; openAccessOnly: boolean };

function recorder(papers = pageOf(3)): { entry: ProviderEntry; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const entry: ProviderEntry = {
    id: 'europepmc',
    capabilities: {
      keywordSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false
    },
    translate: () => 'native',
    normalizerVersion: 1,
    search: async ({ query, openAccessOnly }) => {
      calls.push({ query, openAccessOnly });
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
const run = (params: SearchParams, providers: ProviderEntry[]) =>
  runOrchestrator(params, { providers, authorities: [] });

describe('toUserFilters', () => {
  it('carries every filter the orchestrator can act on', () => {
    expect(toUserFilters({
      source: ['europepmc'], yearFrom: 2020, yearTo: 2024,
      oaStatus: ['gold'], venue: ['Nature'], publisher: ['NPG'], topics: ['crispr']
    })).toEqual({
      source: ['europepmc'], yearFrom: 2020, yearTo: 2024,
      oaStatus: ['gold'], venue: ['Nature'], publisher: ['NPG'], topics: ['crispr']
    });
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

describe('runOrchestrator: what the providers are asked', () => {
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

  it('asks for open access only unless the request says otherwise', async () => {
    const { entry, calls } = recorder();
    await run({ q: 'crispr' }, [entry]);
    await run({ q: 'crispr', filters: { openAccessOnly: false } }, [entry]);

    expect(calls[0]!.openAccessOnly).toBe(true);
    expect(calls[1]!.openAccessOnly).toBe(false);
  });
});

describe('runOrchestrator: the response', () => {
  it('is the shape the old path returns', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', page: 1, pageSize: 2 }, [entry]);

    expect(response.hits).toHaveLength(2);
    expect(response.total).toBe(5);
    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(2);
    expect(response.sort).toBe('relevance');
    expect(response.providerTotals).toEqual([
      { source: 'europepmc', totalHits: 5, retrieved: 5 }
    ]);
    expect(typeof response.duration).toBe('number');
  });

  it('defaults page and pageSize the way the old path did', async () => {
    const { entry } = recorder(pageOf(30));
    const response = await run({ q: 'crispr' }, [entry]);

    expect(response.page).toBe(1);
    expect(response.pageSize).toBe(20);
    expect(response.hits).toHaveLength(20);
  });

  it('echoes filters only when the request carried them', async () => {
    const { entry } = recorder();
    expect((await run({ q: 'crispr' }, [entry])).filters).toBeUndefined();
    expect((await run({ q: 'crispr', filters: { yearFrom: 2020 } }, [entry])).filters)
      .toEqual({ yearFrom: 2020 });
  });

  it('reports completeness, which the old path had no way to express', async () => {
    const { entry } = recorder();
    expect((await run({ q: 'crispr' }, [entry])).complete).toBe(true);

    const failing: ProviderEntry = { ...entry, search: async () => { throw new Error('upstream down'); } };
    const response = await run({ q: 'crispr' }, [failing]);
    expect(response.complete).toBe(false);
    expect(response.providerTotals?.[0]?.error).toContain('upstream down');
  });

  it('applies the requested sort to the whole set, not to the page', async () => {
    const { entry } = recorder(pageOf(5));
    const response = await run({ q: 'crispr', sort: 'date', pageSize: 2 }, [entry]);

    // pageOf ascends by year, so a date sort has to bring the last ones forward.
    expect(response.hits.map(h => h.year)).toEqual([2024, 2023]);
    expect(response.sort).toBe('date');
  });
});
