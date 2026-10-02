import { describe, it, expect } from 'vitest';
import type { ProviderId, Query } from '@open-access-explorer/shared';
import { createEngine } from '../engine';
import type { ProviderEntry } from '../orchestrator/registry';
import { paper, ref } from '../orchestrator/__tests__/helpers';

/**
 * The engine the MCP server is built on, driven offline: stub providers that
 * record what they were asked, and no authorities, so nothing leaves the
 * process.
 */

type Call = { query: Query; openAccessOnly: boolean; depth: number };

function stub(id: ProviderId, count = 3): { entry: ProviderEntry; calls: Call[] } {
  const calls: Call[] = [];
  const papers = Array.from({ length: count }, (_, i) =>
    paper({
      id: `${id}:${i}`,
      title: `${id} study ${i}`,
      doi: `10.1234/${id}-${i}`,
      sources: [ref(id, { nativeId: String(i), rank: i })]
    }));
  const entry: ProviderEntry = {
    id,
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 1000, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['preprint', 'published'], filter: false }, facets: []
    },
    translate: query => `native:${query.terms.join(' ')}${query.doi ?? ''}`,
    normalizerVersion: 1,
    search: async ({ query, openAccessOnly, depth }) => {
      calls.push({ query, openAccessOnly, depth });
      const found = query.doi ? papers.filter(p => p.doi === query.doi!.toLowerCase()) : papers;
      return { papers: found, totalHits: found.length, skipped: [] };
    }
  };
  return { entry, calls };
}

function engineWith(...entries: ProviderEntry[]) {
  return createEngine({ userAgent: 'engine-test', providers: entries, authorities: [] });
}

describe('createEngine', () => {
  it('serves a second page of a search from the held set', async () => {
    const arxiv = stub('arxiv', 5);
    const engine = engineWith(arxiv.entry);

    const first = await engine.search({ q: 'crispr', page: 1, pageSize: 2 });
    const second = await engine.search({ q: 'crispr', page: 2, pageSize: 2 });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(second.response.papers.map(p => p.id)).toEqual(['arxiv:2', 'arxiv:3']);
    expect(arxiv.calls).toHaveLength(1);
  });

  it('asks only the sources it is narrowed to, and holds that set apart', async () => {
    const arxiv = stub('arxiv');
    const europepmc = stub('europepmc');
    const engine = engineWith(arxiv.entry, europepmc.entry);

    const narrowed = await engine.search({ q: 'crispr' }, { sources: ['arxiv'] });
    expect(narrowed.response.providers.map(p => p.provider)).toEqual(['arxiv']);
    expect(europepmc.calls).toHaveLength(0);

    // The same search across every source is not the narrowed set...
    const everyone = await engine.search({ q: 'crispr' });
    expect(everyone.fromCache).toBe(false);
    expect(europepmc.calls).toHaveLength(1);

    // ...and each is still held under its own key.
    expect((await engine.search({ q: 'crispr' }, { sources: ['arxiv'] })).fromCache).toBe(true);
    expect((await engine.search({ q: 'crispr' })).fromCache).toBe(true);
  });

  it('asks admission only when a set has to be resolved', async () => {
    const engine = engineWith(stub('arxiv', 5).entry);
    let admitted = 0;
    const admit = async () => { admitted++; };

    await engine.search({ q: 'crispr', page: 1, pageSize: 2 }, { admit });
    await engine.search({ q: 'crispr', page: 2, pageSize: 2 }, { admit });

    expect(admitted).toBe(1);
  });

  it('looks a DOI up whether or not the paper is open', async () => {
    const arxiv = stub('arxiv');
    const engine = engineWith(arxiv.entry);

    const found = await engine.lookupDoi('https://doi.org/10.1234/ARXIV-1');

    expect(found?.id).toBe('arxiv:1');
    expect(arxiv.calls[0]!.openAccessOnly).toBe(false);
    expect(arxiv.calls[0]!.query.doi).toBe('10.1234/ARXIV-1');
  });

  it('answers a DOI no source holds with null', async () => {
    expect(await engineWith(stub('arxiv').entry).lookupDoi('10.1234/nowhere')).toBeNull();
  });

  it('asks nobody about text that is not a DOI', async () => {
    // Searched, it would be keywords, and the first hit somebody else's paper.
    const arxiv = stub('arxiv');
    const engine = engineWith(arxiv.entry);

    expect(await engine.lookupDoi('crispr')).toBeNull();
    expect(await engine.lookupDoi('a NEAR b')).toBeNull();
    expect(arxiv.calls).toHaveLength(0);
  });

  it('looks an id up in the one provider it names', async () => {
    const arxiv = stub('arxiv');
    const europepmc = stub('europepmc');
    arxiv.entry.lookup = async ({ nativeId }) =>
      paper({ id: `arxiv:${nativeId}`, sources: [ref('arxiv', { nativeId })] });

    const found = await engineWith(arxiv.entry, europepmc.entry).lookup('arxiv:2101.00001');

    expect(found?.id).toBe('arxiv:2101.00001');
    expect(europepmc.calls).toHaveLength(0);
  });
});
