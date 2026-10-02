import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderId, Query } from '@open-access-explorer/shared';

const { resolve } = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../fulltext/resolve', () => ({ resolveFullText: resolve }));

import { createEngine } from '../engine';
import { SourceBusyError } from '../lib/host-pacer';
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

  it('counts matches with one record from each source, narrowed like a search', async () => {
    const arxiv = stub('arxiv', 5);
    const europepmc = stub('europepmc', 5);
    const engine = engineWith(arxiv.entry, europepmc.entry);
    let admitted = 0;

    const { reports } = await engine.count({ q: 'crispr' }, { sources: ['arxiv'], admit: async () => { admitted++; } });

    expect(reports.map(r => [r.provider, r.totalHits])).toEqual([['arxiv', 5]]);
    expect(arxiv.calls.map(c => c.depth)).toEqual([1]);
    expect(europepmc.calls).toEqual([]);
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

describe('a spent quota', () => {
  /** A source whose answers are scripted call by call: `429` refuses, a number answers with that many papers. */
  function scripted(id: ProviderId, script: Array<number | 429>, over: Partial<ProviderEntry> = {}) {
    const calls: Query[] = [];
    const entry: ProviderEntry = {
      ...stub(id).entry,
      search: async ({ query }) => {
        const next = script[calls.length] ?? 3;
        calls.push(query);
        if (next === 429) throw Object.assign(new Error(`${id} 429: over budget`), { status: 429 });
        const papers = Array.from({ length: next }, (_, i) =>
          paper({ id: `${id}:${i}`, title: `${id} ${i}`, sources: [ref(id, { nativeId: String(i) })] }));
        return { papers, totalHits: next, skipped: [] };
      },
      ...over
    };
    return { entry, calls };
  }

  it('leaves a source alone after its 429, says so, and holds no set without it', async () => {
    let t = 0;
    const openalex = scripted('openalex', [429, 3]);
    const arxiv = stub('arxiv');
    const engine = createEngine({
      userAgent: 'engine-test', providers: [openalex.entry, arxiv.entry], authorities: [],
      quotaCoolDownMs: 600_000, now: () => t
    });

    const refused = await engine.search({ q: 'crispr' });
    expect(refused.response.providers.find(p => p.provider === 'openalex')).toMatchObject({ status: 'error', rateLimited: 'refused' });

    t = 300_000;
    const cooling = await engine.search({ q: 'microbiome' });
    expect(openalex.calls).toHaveLength(1);
    expect(cooling.response.providers.find(p => p.provider === 'openalex')).toMatchObject({ status: 'error', rateLimited: 'cooling-down' });
    expect(cooling.response.complete).toBe(false);
    // Not held: the same search again runs again.
    expect((await engine.search({ q: 'microbiome' })).fromCache).toBe(false);
    expect(openalex.calls).toHaveLength(1);

    t = 600_000;
    const recovered = await engine.search({ q: 'microbiome' });
    expect(openalex.calls).toHaveLength(2);
    expect(recovered.response.complete).toBe(true);

    // The answer ended the cool-down, so nothing is left out now.
    await engine.search({ q: 'plasmid' });
    expect(openalex.calls).toHaveLength(3);
  });

  it('leaves a cooled-down source out of a count too', async () => {
    const openalex = scripted('openalex', [429]);
    const engine = createEngine({ userAgent: 'engine-test', providers: [openalex.entry], authorities: [] });

    await engine.count({ q: 'crispr' });
    const { reports, complete } = await engine.count({ q: 'microbiome' });

    expect(openalex.calls).toHaveLength(1);
    expect(reports[0]).toMatchObject({ status: 'error', rateLimited: 'cooling-down' });
    expect(complete).toBe(false);
  });

  it('asks a cooled-down OpenAlex neither for its facet counts nor as an authority', async () => {
    let facetCalls = 0;
    let authorityCalls = 0;
    const openalex = scripted('openalex', [429], {
      facets: async () => { facetCalls++; return { facets: {}, failures: [] }; },
      facetsAggregate: true
    });
    openalex.entry.capabilities = { ...openalex.entry.capabilities, facets: ['year'] };
    const arxiv = stub('arxiv');
    const engine = createEngine({
      userAgent: 'engine-test',
      providers: [openalex.entry, arxiv.entry],
      authorities: [{
        id: 'openalex',
        capabilities: { fields: ['citationCount'], authoritative: [] },
        pass: 0,
        lookup: async () => { authorityCalls++; return null; }
      }]
    });

    // Before the 429 is known, both are asked: what the test then shows missing was there to miss.
    await engine.search({ q: 'crispr' });
    expect(facetCalls).toBeGreaterThan(0);
    expect(authorityCalls).toBeGreaterThan(0);
    facetCalls = 0;
    authorityCalls = 0;

    await engine.search({ q: 'microbiome' });
    await engine.lookupDoi('10.1234/arxiv-1');

    expect(openalex.calls).toHaveLength(1);
    expect(facetCalls).toBe(0);
    expect(authorityCalls).toBe(0);
  });
});

describe('reading full text', () => {
  const doc = { paperId: 'arxiv:1', tier: 'arxiv-html', url: 'https://arxiv.org/html/1', sections: [{ id: 's1', title: 'T', text: 'x' }], totalChars: 1, retrievedAt: 'now' };
  const target = paper({ id: 'arxiv:1' });
  const engine = () => createEngine({ userAgent: 'engine-test', providers: [], authorities: [] });

  beforeEach(() => {
    resolve.mockReset();
  });

  it('fetches a paper once, however many times its sections are read', async () => {
    resolve.mockResolvedValue({ doc, definitive: true });
    const e = engine();

    await e.readFullText(target, { trustedOnly: false });
    expect(await e.readFullText(target, { trustedOnly: false })).toEqual(doc);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('fetches once for reads that arrive together', async () => {
    resolve.mockImplementation(() => new Promise(r => setTimeout(() => r({ doc, definitive: true }), 10)));
    const e = engine();

    await Promise.all([e.readFullText(target, { trustedOnly: false }), e.readFullText(target, { trustedOnly: false })]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('holds trusted mode’s answer apart, since it reads fewer tiers', async () => {
    resolve.mockResolvedValue({ doc: null, definitive: true });
    const e = engine();

    await e.readFullText(target, { trustedOnly: true });
    await e.readFullText(target, { trustedOnly: false });
    expect(resolve.mock.calls.map(c => c[1].trustedOnly)).toEqual([true, false]);
  });

  it('holds a definitive miss, and not one that a failure left open', async () => {
    const e = engine();
    resolve.mockResolvedValue({ doc: null, definitive: false });
    await e.readFullText(target, { trustedOnly: false });
    await e.readFullText(target, { trustedOnly: false });
    expect(resolve).toHaveBeenCalledTimes(2);

    resolve.mockResolvedValue({ doc: null, definitive: true });
    await e.readFullText(target, { trustedOnly: false });
    await e.readFullText(target, { trustedOnly: false });
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it('holds nothing for a read deferred by a paced host, so the retry fetches', async () => {
    const e = engine();
    resolve.mockRejectedValueOnce(new SourceBusyError('arxiv.org', 30_000));
    await expect(e.readFullText(target, { trustedOnly: false })).rejects.toBeInstanceOf(SourceBusyError);

    resolve.mockResolvedValue({ doc, definitive: true });
    expect(await e.readFullText(target, { trustedOnly: false })).toEqual(doc);
  });
});
