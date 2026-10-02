import { describe, it, expect } from 'vitest';
import type { ProviderCapabilities, ProviderId, Query, SearchParams } from '@open-access-explorer/shared';
import { countSearch } from '../count';
import { runOrchestrator } from '../from-search-params';
import { ProviderCache } from '../provider-cache';
import type { ProviderEntry } from '../registry';
import { paper, ref } from './helpers';

/**
 * Counting a search's matches without reading them: the tuning loop an agent
 * runs before it pays for a search.
 */

type Asked = { query: Query; depth: number; openAccessOnly: boolean; native: string };

const capabilities = (over: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
  maxPageSize: 100, reportsTotal: true, suppliesCitations: false,
  stages: { holds: ['preprint', 'published'], filter: true }, facets: [],
  ...over
});

function source(id: ProviderId, totalHits: number, over: Partial<ProviderCapabilities> = {}) {
  const asked: Asked[] = [];
  const translate = (query: Query, { openAccessOnly }: { openAccessOnly: boolean }) =>
    `${id}(${[...query.phrases.map(p => `"${p}"`), ...query.terms].join(' ')}|${query.years?.from ?? ''}-${query.years?.to ?? ''}|${query.stages?.join(',') ?? ''}|${openAccessOnly})`;
  const entry: ProviderEntry = {
    id,
    capabilities: capabilities(over),
    translate,
    normalizerVersion: 1,
    search: async ({ query, depth, openAccessOnly }) => {
      asked.push({ query, depth, openAccessOnly, native: translate(query, { openAccessOnly }) });
      const papers = Array.from({ length: Math.min(depth, 3) }, (_, i) =>
        paper({ id: `${id}:${i}`, title: `${id} ${i}`, sources: [ref(id, { nativeId: String(i) })] }));
      return { papers, totalHits, skipped: [] };
    }
  };
  return { entry, asked };
}

describe('countSearch', () => {
  it('asks each source that reports a total for one record, and keeps its count', async () => {
    const arxiv = source('arxiv', 1200);
    const europepmc = source('europepmc', 54_000);

    const { reports, complete } = await countSearch({ q: 'crispr' }, { providers: [arxiv.entry, europepmc.entry] });

    expect(arxiv.asked.map(a => a.depth)).toEqual([1]);
    expect(europepmc.asked.map(a => a.depth)).toEqual([1]);
    expect(reports.find(r => r.provider === 'arxiv')).toMatchObject({ status: 'ok', totalHits: 1200 });
    expect(reports.find(r => r.provider === 'europepmc')).toMatchObject({ status: 'ok', totalHits: 54_000 });
    expect(complete).toBe(true);
  });

  it('does not ask a source that reports no count, and says why', async () => {
    const arxiv = source('arxiv', 10);
    const biorxiv = source('biorxiv', 0, { reportsTotal: false });

    const { reports } = await countSearch({ q: 'crispr' }, { providers: [arxiv.entry, biorxiv.entry] });

    expect(biorxiv.asked).toEqual([]);
    expect(reports.find(r => r.provider === 'biorxiv')).toEqual({
      provider: 'biorxiv', status: 'skipped', retrieved: 0, latency: 0, skipReason: 'reports no match count'
    });
  });

  it('spends one admission, before any source is asked', async () => {
    const arxiv = source('arxiv', 10);
    const europepmc = source('europepmc', 10);
    let admitted = 0;

    await countSearch({ q: 'crispr' }, {
      providers: [arxiv.entry, europepmc.entry],
      admit: async () => {
        expect(arxiv.asked).toEqual([]);
        admitted++;
      }
    });

    expect(admitted).toBe(1);
  });

  it('asks nobody when admission is refused', async () => {
    const arxiv = source('arxiv', 10);

    await expect(countSearch({ q: 'crispr' }, {
      providers: [arxiv.entry],
      admit: async () => { throw new Error('over budget'); }
    })).rejects.toThrow('over budget');
    expect(arxiv.asked).toEqual([]);
  });

  it('is incomplete when a source that counts did not answer', async () => {
    const arxiv = source('arxiv', 10);
    const failing: ProviderEntry = { ...source('europepmc', 0).entry, search: async () => { throw new Error('down'); } };

    const { reports, complete } = await countSearch({ q: 'crispr' }, { providers: [arxiv.entry, failing] });

    expect(complete).toBe(false);
    expect(reports.find(r => r.provider === 'europepmc')).toMatchObject({ status: 'error' });
  });

  it('asks nobody about a year range that ends before it starts', async () => {
    const arxiv = source('arxiv', 10);

    const { reports, complete } = await countSearch({ q: 'crispr', filters: { yearFrom: 2024, yearTo: 2020 } }, { providers: [arxiv.entry] });

    expect(arxiv.asked).toEqual([]);
    expect(complete).toBe(true);
    expect(reports[0]).toMatchObject({ status: 'skipped' });
  });

  it('is answered from the provider cache when repeated, and never by a search', async () => {
    const arxiv = source('arxiv', 10);
    const cache = new ProviderCache();

    await countSearch({ q: 'crispr' }, { providers: [arxiv.entry], cache });
    await countSearch({ q: 'crispr' }, { providers: [arxiv.entry], cache });
    expect(arxiv.asked).toHaveLength(1);

    // The cache keys on the depth: a search reads its own records.
    await runOrchestrator({ q: 'crispr' }, { providers: [arxiv.entry], authorities: [], cache });
    expect(arxiv.asked.map(a => a.depth)).toEqual([1, 600]);
  });
});

describe('a count is a count of the search it previews', () => {
  const variants: Array<[string, SearchParams]> = [
    ['a plain query', { q: 'crispr "base editing"' }],
    ['a year range', { q: 'crispr', filters: { yearFrom: 2020, yearTo: 2024 } }],
    ['a publication type', { q: 'crispr', filters: { publicationType: ['preprint'] } }],
    ['closed papers included', { q: 'crispr', filters: { openAccessOnly: false } }],
    ['ticked years', { q: 'crispr', filters: { year: ['2021', '2022'] } }]
  ];

  it.each(variants)('plans the same sources and sends each the same query: %s', async (_name, params) => {
    const counted = [source('arxiv', 10), source('doaj', 10, { stages: { holds: ['published'], filter: false } })];
    const searched = [source('arxiv', 10), source('doaj', 10, { stages: { holds: ['published'], filter: false } })];

    await countSearch(params, { providers: counted.map(s => s.entry) });
    await runOrchestrator(params, { providers: searched.map(s => s.entry), authorities: [] });

    const asked = (sources: typeof counted) => sources.filter(s => s.asked.length > 0).map(s => s.entry.id);
    expect(asked(counted)).toEqual(asked(searched));
    counted.forEach((s, i) => expect(s.asked.map(a => a.native)).toEqual(searched[i]!.asked.map(a => a.native)));
  });
});
