import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderId, Query } from '@sci-open/shared';

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
      keywordSearch: true, fieldedSearch: true, doiLookup: true,
      maxPageSize: 1000, reportsTotal: true,
      stages: { holds: ['preprint', 'published'], filter: false }, facets: []
    },
    translate: query => `native:${query.terms.join(' ')}${query.doi ?? ''}`,
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

describe('what a call costs the sources', () => {
  /** A source that counts facets across its index, and says how often it was asked to. */
  function faceted() {
    const source = stub('openalex');
    let counted = 0;
    source.entry.capabilities = { ...source.entry.capabilities, facets: ['year'] };
    source.entry.facets = async () => { counted++; return { facets: { year: [{ value: 2021, count: 999 }] }, failures: [] }; };
    source.entry.facetsAggregate = true;
    return { ...source, counted: () => counted };
  }

  it('counts facets across the sources only when a search asks, and holds the two sets apart', async () => {
    const openalex = faceted();
    const engine = engineWith(openalex.entry);

    const plain = await engine.search({ q: 'crispr' });
    expect(openalex.counted()).toBe(0);
    expect(plain.response.facets.year).not.toContainEqual({ value: 2021, count: 999 });

    // Not answered by the set that has no counts in it...
    const counted = await engine.search({ q: 'crispr' }, { facets: true });
    expect(counted.fromCache).toBe(false);
    expect(openalex.counted()).toBe(1);
    expect(counted.response.facets.year).toContainEqual({ value: 2021, count: 999 });

    // ...and each held under its own key, so the pages of either cost nothing.
    expect((await engine.search({ q: 'crispr', page: 2 }, { facets: true })).fromCache).toBe(true);
    expect((await engine.search({ q: 'crispr', page: 2 })).fromCache).toBe(true);
    // The read is shared through the provider cache: asking for the counts
    // later costs the counts, not the search again.
    expect(openalex.calls).toHaveLength(1);
  });

  it('reads each source as deep as a call asks, and holds that set apart', async () => {
    const arxiv = stub('arxiv');
    const engine = createEngine({ userAgent: 'engine-test', providers: [arxiv.entry], authorities: [], depth: 300 });

    await engine.search({ q: 'crispr' }, { depth: 25 });
    await engine.search({ q: 'crispr' });
    expect((await engine.search({ q: 'crispr' }, { depth: 25 })).fromCache).toBe(true);

    expect(arxiv.calls.map(c => c.depth)).toEqual([25, 300]);
  });

  describe('a search the caller cancels', () => {
    /** A source that answers only when told to, and says whether it was told to stop. */
    function hanging(id: ProviderId) {
      const source = stub(id);
      const signals: AbortSignal[] = [];
      let answer!: () => void;
      const answered = new Promise<void>(resolve => { answer = resolve; });
      const search = source.entry.search;
      source.entry.search = async args => {
        signals.push(args.signal!);
        await Promise.race([answered, new Promise((_, reject) => args.signal!.addEventListener('abort', () => reject(args.signal!.reason), { once: true }))]);
        return search(args);
      };
      return { ...source, signals, answer };
    }

    it('stops asking the sources, rejects, and holds nothing', async () => {
      const arxiv = hanging('arxiv');
      const engine = engineWith(arxiv.entry);
      const caller = new AbortController();

      const searching = engine.search({ q: 'crispr' }, { signal: caller.signal });
      await vi.waitFor(() => expect(arxiv.signals).toHaveLength(1));
      caller.abort();

      await expect(searching).rejects.toMatchObject({ name: 'AbortError' });
      expect(arxiv.signals[0]!.aborted).toBe(true);
      arxiv.answer();
      expect((await engine.search({ q: 'crispr' })).fromCache).toBe(false);
    });

    it('goes on for another caller waiting on the same search', async () => {
      const arxiv = hanging('arxiv');
      const engine = engineWith(arxiv.entry);
      const leaving = new AbortController();

      const left = engine.search({ q: 'crispr' }, { signal: leaving.signal });
      const staying = engine.search({ q: 'crispr' });
      await vi.waitFor(() => expect(arxiv.signals).toHaveLength(1));
      leaving.abort();
      await expect(left).rejects.toMatchObject({ name: 'AbortError' });

      arxiv.answer();
      expect((await staying).response.papers).toHaveLength(3);
      expect(arxiv.signals).toHaveLength(1);
      expect(arxiv.signals[0]!.aborted).toBe(false);
    });

    it('cancels a count the same way', async () => {
      const arxiv = hanging('arxiv');
      const engine = engineWith(arxiv.entry);
      const caller = new AbortController();

      const counting = engine.count({ q: 'crispr' }, { signal: caller.signal });
      await vi.waitFor(() => expect(arxiv.signals).toHaveLength(1));
      caller.abort();

      await expect(counting).rejects.toMatchObject({ name: 'AbortError' });
      expect(arxiv.signals[0]!.aborted).toBe(true);
    });
  });

  describe('a paper looked up by id', () => {
    function byId(clock = { now: 0 }) {
      const arxiv = stub('arxiv');
      const asked: string[] = [];
      arxiv.entry.lookup = async ({ nativeId }) => {
        asked.push(nativeId);
        return nativeId === 'missing' ? null : paper({ id: `arxiv:${nativeId}`, sources: [ref('arxiv', { nativeId })] });
      };
      const engine = createEngine({ userAgent: 'engine-test', providers: [arxiv.entry], authorities: [], now: () => clock.now });
      return { engine, asked, clock };
    }

    it('is asked of its source once, however many times its sections are read', async () => {
      const { engine, asked } = byId();
      await engine.lookup('arxiv:2101.00001');
      const again = await engine.lookup('arxiv:2101.00001');

      expect(again?.id).toBe('arxiv:2101.00001');
      expect(asked).toEqual(['2101.00001']);
    });

    it('is asked once for lookups that arrive together', async () => {
      const { engine, asked } = byId();
      await Promise.all([engine.lookup('arxiv:2101.00001'), engine.lookup('arxiv:2101.00001')]);
      expect(asked).toEqual(['2101.00001']);
    });

    it('is asked again once the record has been held half an hour', async () => {
      const { engine, asked, clock } = byId();
      await engine.lookup('arxiv:2101.00001');
      clock.now = 30 * 60_000 - 1;
      await engine.lookup('arxiv:2101.00001');
      clock.now = 30 * 60_000;
      await engine.lookup('arxiv:2101.00001');
      expect(asked).toEqual(['2101.00001', '2101.00001']);
    });

    it('is not held when no source had it, so a paper indexed later is found', async () => {
      const { engine, asked } = byId();
      expect(await engine.lookup('arxiv:missing')).toBeNull();
      expect(await engine.lookup('arxiv:missing')).toBeNull();
      expect(asked).toEqual(['missing', 'missing']);
    });
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
    await engine.search({ q: 'crispr' }, { facets: true });
    expect(facetCalls).toBeGreaterThan(0);
    expect(authorityCalls).toBeGreaterThan(0);
    facetCalls = 0;
    authorityCalls = 0;

    await engine.search({ q: 'microbiome' }, { facets: true });
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
