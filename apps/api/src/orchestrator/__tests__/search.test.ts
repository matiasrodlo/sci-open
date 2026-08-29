import { describe, it, expect, vi } from 'vitest';
import { search, ProviderCache, parseQuery } from '../index';
import type { ProviderEntry } from '../registry';
import { paper, ref } from './helpers';

function stub(id: any, papers: any[], over: Partial<ProviderEntry> = {}): ProviderEntry {
  return {
    id,
    capabilities: {
      keywordSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false
    },
    translate: () => `native(${id})`,
    normalizerVersion: 1,
    search: async () => ({ papers, totalHits: papers.length * 10, skipped: [] }),
    ...over
  };
}

const page = (id: any, n: number, titlePrefix = 'CRISPR study') =>
  Array.from({ length: n }, (_, i) =>
    paper({
      id: `${id}:${i}`,
      title: `${titlePrefix} ${i}`,
      doi: `10.1/${id}-${i}`,
      year: 2020 + (i % 3),
      venue: `Journal ${i % 4}`,
      sources: [ref(id, { nativeId: String(i), rank: i })]
    }));

const QUERY = parseQuery('crispr study');

describe('orchestrator search', () => {
  it('returns a page, a total, facets and a report per provider', async () => {
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 30)), stub('ncbi', page('ncbi', 20))],
      pageSize: 10
    });

    expect(result.papers).toHaveLength(10);
    expect(result.total).toBe(50);
    expect(result.reports.map(r => r.provider).sort()).toEqual(['europepmc', 'ncbi']);
    expect(result.complete).toBe(true);
    expect(Object.keys(result.facets)).toContain('source');
  });

  it('paginates over the filtered set', async () => {
    const providers = [stub('europepmc', page('europepmc', 25))];
    const first = await search(QUERY, { providers, pageSize: 10, page: 1 });
    const second = await search(QUERY, { providers, pageSize: 10, page: 2 });
    const third = await search(QUERY, { providers, pageSize: 10, page: 3 });

    expect([first.papers.length, second.papers.length, third.papers.length]).toEqual([10, 10, 5]);
    const ids = new Set([...first.papers, ...second.papers, ...third.papers].map(p => p.id));
    expect(ids.size).toBe(25);
  });

  it('keeps the reported total stable across pages', async () => {
    // Depth is independent of page on purpose: letting it grow would change
    // the total as the user walks through the results.
    const providers = [stub('europepmc', page('europepmc', 25))];
    const totals = await Promise.all(
      [1, 2, 3].map(async p => (await search(QUERY, { providers, pageSize: 10, page: p })).total)
    );
    expect(new Set(totals).size).toBe(1);
  });

  it('does not return results in contiguous provider blocks', async () => {
    // The measured failure: 13 blocks, because ordering was "group by source".
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 15)), stub('ncbi', page('ncbi', 15))],
      pageSize: 30
    });

    const sequence = result.papers.map(p => p.sources[0].provider);
    const runs = sequence.filter((p, i) => i === 0 || p !== sequence[i - 1]).length;
    expect(runs).toBeGreaterThan(2);
  });

  it('marks the result incomplete when a provider fails', async () => {
    const failing = stub('ncbi', [], { search: async () => { throw new Error('upstream 503'); } });
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 5)), failing]
    });

    expect(result.complete).toBe(false);
    expect(result.reports.find(r => r.provider === 'ncbi')).toMatchObject({ status: 'error' });
    // The total is still returned, but it is a lower bound.
    expect(result.total).toBe(5);
  });

  it('merges across providers and surfaces the merged-in abstract', async () => {
    const withoutAbstract = paper({
      id: 'e', doi: '10.1/shared', abstract: undefined, sources: [ref('europepmc', { rank: 0 })]
    });
    const withAbstract = paper({
      id: 'n', doi: '10.1/shared', abstract: 'Only NCBI had this', sources: [ref('ncbi', { rank: 0 })]
    });

    const result = await search(QUERY, {
      providers: [stub('europepmc', [withoutAbstract]), stub('ncbi', [withAbstract])]
    });

    expect(result.total).toBe(1);
    expect(result.papers[0].abstract).toBe('Only NCBI had this');
    expect(result.papers[0].fieldSources.abstract).toBe('ncbi');
    expect(result.papers[0].sources.map(s => s.provider)).toEqual(['europepmc', 'ncbi']);
  });

  it('filters by oaStatus, which changes the result set', async () => {
    const papers = [
      paper({ id: 'g', doi: '10.1/g', oaStatus: 'gold', sources: [ref('europepmc', { rank: 0 })] }),
      paper({ id: 'b', doi: '10.1/b', oaStatus: 'bronze', sources: [ref('europepmc', { rank: 1 })] })
    ];
    const providers = [stub('europepmc', papers)];

    expect((await search(QUERY, { providers })).total).toBe(2);
    expect((await search(QUERY, { providers, filters: { oaStatus: ['gold'] } })).total).toBe(1);
  });

  it('counts facets over the filtered set, so buckets reconcile with the total', async () => {
    const result = await search(QUERY, {
      providers: [stub('europepmc', page('europepmc', 12))],
      pageSize: 5,
      filters: { yearFrom: 2021 }
    });

    const venueTotal = result.facets.venue.reduce((t, b) => t + b.count, 0);
    expect(venueTotal).toBe(result.total);
    expect(result.total).toBeLessThan(12);
  });

  it('serves a second search from the provider cache', async () => {
    const upstream = vi.fn(async () => ({ papers: page('europepmc', 10), totalHits: 100, skipped: [] }));
    const providers = [stub('europepmc', [], { search: upstream })];
    const cache = new ProviderCache();

    await search(QUERY, { providers, cache, pageSize: 10, page: 1 });
    await search(QUERY, { providers, cache, pageSize: 10, page: 2 });
    await search(QUERY, { providers, cache, pageSize: 10, page: 1, filters: { yearFrom: 2021 } });

    // Page, and a post-fetch filter, cost nothing upstream.
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent identical searches onto one fan-out', async () => {
    const upstream = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 20));
      return { papers: page('europepmc', 5), skipped: [] };
    });
    const providers = [stub('europepmc', [], { search: upstream })];
    const cache = new ProviderCache();

    await Promise.all(Array.from({ length: 4 }, () => search(QUERY, { providers, cache })));

    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it('skips a provider that cannot serve the query and says so', async () => {
    const doiOnly = stub('opencitations', [], {
      capabilities: {
        keywordSearch: false, doiLookup: true, fields: [], yearFilter: false,
        maxPageSize: 100, reportsTotal: false, suppliesCitations: true
      }
    });
    const result = await search(QUERY, { providers: [stub('europepmc', page('europepmc', 3)), doiOnly] });

    const skipped = result.reports.find(r => r.provider === 'opencitations');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.skipReason).toMatch(/keywordSearch/);
    // A deliberate skip does not make the result incomplete.
    expect(result.complete).toBe(true);
  });

  it('returns an empty page rather than throwing when nothing matches', async () => {
    const result = await search(QUERY, { providers: [stub('europepmc', [])] });
    expect(result.papers).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.complete).toBe(true);
  });
});
