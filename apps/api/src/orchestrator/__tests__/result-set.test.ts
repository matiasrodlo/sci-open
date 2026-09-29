import { describe, it, expect, vi } from 'vitest';
import type { AuthorityFacts, Paper, Query } from '@open-access-explorer/shared';
import type { AuthorityEntry } from '../../authorities';
import type { ProviderEntry } from '../registry';
import { search } from '../index';
import { parseQuery } from '../parse-query';
import { AuthorityFactsCache } from '../authority-cache';
import { ResultSetCache, resultSetKey, type ResultSet, type ResultSetKeyParts } from '../result-set';
import { paper, ref } from './helpers';

const set = (over: Partial<ResultSet> = {}): ResultSet => ({
  papers: [paper()],
  facets: {},
  reports: [],
  rescue: { candidates: 0, examined: 0, rescued: 0, bounded: false, authorities: [] },
  complete: true,
  countsFromSources: false,
  ...over
});

const parts = (over: Partial<ResultSetKeyParts> = {}): ResultSetKeyParts => ({
  query: parseQuery('crispr'),
  filters: {},
  policy: { requireFullText: true, requireOpenAccess: true },
  openAccessOnly: true,
  depth: 600,
  timeoutMs: 20000,
  facetQueries: undefined,
  facetBudgetMs: 20000,
  filtersSent: false,
  providers: [{ id: 'europepmc', normalizerVersion: 2 }],
  rescue: { authorities: ['unpaywall'], limit: 200, budgetMs: 5000 },
  ...over
});

describe('resultSetKey', () => {
  it('is the same for the same filters in any order', () => {
    expect(resultSetKey(parts({ filters: { year: ['2024', '2023'], venue: ['Nature'] } })))
      .toBe(resultSetKey(parts({ filters: { venue: ['Nature'], year: ['2023', '2024'] } })));
  });

  it('changes with anything that changes which papers are in the set', () => {
    const base = resultSetKey(parts());
    expect(resultSetKey(parts({ query: parseQuery('crispr cas9') }))).not.toBe(base);
    expect(resultSetKey(parts({ filters: { year: ['2024'] } }))).not.toBe(base);
    expect(resultSetKey(parts({ depth: 1200 }))).not.toBe(base);
    expect(resultSetKey(parts({ openAccessOnly: false }))).not.toBe(base);
    expect(resultSetKey(parts({ providers: [{ id: 'europepmc', normalizerVersion: 3 }] }))).not.toBe(base);
    expect(resultSetKey(parts({ rescue: { authorities: ['unpaywall'], limit: 0, budgetMs: 5000 } }))).not.toBe(base);
  });
});

describe('ResultSetCache', () => {
  it('resolves a set once, and holds it', async () => {
    const cache = new ResultSetCache();
    const work = vi.fn(async () => set());

    expect((await cache.resolve('k', work)).cached).toBe(false);
    expect((await cache.resolve('k', work)).cached).toBe(true);
    expect(work).toHaveBeenCalledOnce();
  });

  it('resolves once for callers that arrive while it is resolving', async () => {
    const cache = new ResultSetCache();
    let finish!: (s: ResultSet) => void;
    const work = vi.fn(() => new Promise<ResultSet>(resolve => { finish = resolve; }));

    const first = cache.resolve('k', work);
    const second = cache.resolve('k', work);
    finish(set());

    const [a, b] = await Promise.all([first, second]);
    expect(work).toHaveBeenCalledOnce();
    expect(a.set).toBe(b.set);
    expect(b.cached).toBe(true);
  });

  it('asks admission only of a caller who would start the work', async () => {
    const cache = new ResultSetCache();
    const admit = vi.fn(async () => {});
    let finish!: (s: ResultSet) => void;
    const slow = () => new Promise<ResultSet>(resolve => { finish = resolve; });

    const leader = cache.resolve('k', slow, admit);
    await Promise.resolve();
    // Joining a resolution already running costs the sources nothing more.
    const follower = cache.resolve('k', slow, admit);
    finish(set());
    await Promise.all([leader, follower]);
    // Nor does a set already held.
    await cache.resolve('k', slow, admit);

    expect(admit).toHaveBeenCalledOnce();
  });

  it('resolves nothing when admission is refused', async () => {
    const cache = new ResultSetCache();
    const work = vi.fn(async () => set());

    await expect(cache.resolve('k', work, async () => { throw new Error('over budget'); })).rejects.toThrow('over budget');
    expect(work).not.toHaveBeenCalled();
    expect((await cache.resolve('k', work)).cached).toBe(false);
  });

  it('does not hold a set a provider failed to contribute to', async () => {
    const cache = new ResultSetCache();
    const work = vi.fn(async () => set({ complete: false }));

    await cache.resolve('k', work);
    await cache.resolve('k', work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('holds a set whose only gap is a provider that refused the query', async () => {
    // Asking again gets the same 400, so resolving again would only repeat the
    // fan-out and let `total` move while the reader pages.
    const cache = new ResultSetCache();
    const refusal = { provider: 'openalex' as const, status: 'error' as const, retrieved: 0, latency: 1, error: 'OpenAlex 400', refused: true };
    const work = vi.fn(async () => set({ complete: false, reports: [refusal] }));

    await cache.resolve('k', work);
    expect((await cache.resolve('k', work)).cached).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);

    // …but not when something beside it may answer a retry.
    const other = new ResultSetCache();
    const timedOut = { provider: 'ncbi' as const, status: 'timeout' as const, retrieved: 0, latency: 1, error: 'budget' };
    const mixed = vi.fn(async () => set({ complete: false, reports: [refusal, timedOut] }));
    await other.resolve('k', mixed);
    await other.resolve('k', mixed);
    expect(mixed).toHaveBeenCalledTimes(2);
  });

  it('lets a set go when it expires', async () => {
    let now = 0;
    const cache = new ResultSetCache({ ttlMs: 1000, now: () => now });
    const work = vi.fn(async () => set());

    await cache.resolve('k', work);
    now = 999;
    expect((await cache.resolve('k', work)).cached).toBe(true);
    now = 1000;
    expect((await cache.resolve('k', work)).cached).toBe(false);
  });

  it('holds a set whose source counts partly failed for a minute, not half an hour', async () => {
    // Long enough for one reader's pages to agree; short enough that a rate
    // limit that cost some counts is asked about again soon.
    let now = 0;
    const cache = new ResultSetCache({ now: () => now });
    const partial = set({ reports: [{ provider: 'europepmc', status: 'ok', retrieved: 1, latency: 5, facetError: '3 counts failed: 429' }] });
    const work = vi.fn(async () => partial);

    await cache.resolve('k', work);
    now = 59_999;
    expect((await cache.resolve('k', work)).cached).toBe(true);
    now = 60_000;
    expect((await cache.resolve('k', work)).cached).toBe(false);
  });

  it('lets the least recently read set go first when over budget', async () => {
    // Each set is one paper, charged a little over 700 bytes.
    const cache = new ResultSetCache({ maxBytes: 1600 });
    await cache.resolve('a', async () => set());
    await cache.resolve('b', async () => set());
    await cache.resolve('a', async () => set());           // `a` read, so `b` is now oldest
    await cache.resolve('c', async () => set());

    const work = vi.fn(async () => set());
    expect((await cache.resolve('a', work)).cached).toBe(true);
    expect((await cache.resolve('b', work)).cached).toBe(false);
    expect(cache.stats().bytes).toBeLessThanOrEqual(1600);
  });

  it('does not hold a set larger than the whole budget', async () => {
    const cache = new ResultSetCache({ maxBytes: 100 });
    await cache.resolve('k', async () => set());
    expect(cache.stats().entries).toBe(0);
  });
});

/**
 * The defect this exists for. The rescue runs against a wall clock, so how many
 * candidates it reaches depends on how fast the authority answers that second
 * — and with the set resolved again for every page, one search reported a total
 * of 123 on page 1, 126 on page 2 and 136 on page 3, and pages overlapped.
 */
describe('search, with a set cache', () => {
  /** Every paper fails the gate — no copy — and carries a DOI to be asked about. */
  const gated: Paper[] = Array.from({ length: 150 }, (_, i) => paper({
    id: `europepmc:${i}`,
    doi: `10.1/g-${i}`,
    title: `Gated study ${i}`,
    fullText: undefined,
    sources: [ref('europepmc', { nativeId: String(i), rank: i })]
  }));

  function provider(papers: Paper[] = gated) {
    const calls: Query[] = [];
    const entry: ProviderEntry = {
      id: 'europepmc',
      capabilities: {
        keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
        maxPageSize: 1000, reportsTotal: true, suppliesCitations: false,
        stages: { holds: ['published'], filter: false }, facets: []
      },
      translate: () => 'native',
      normalizerVersion: 1,
      search: async ({ query }) => {
        calls.push(query);
        return { papers, totalHits: papers.length, skipped: [] };
      }
    };
    return { entry, calls };
  }

  /** Answers with a copy after a random delay, so a tight budget reaches a different number each time. */
  function unpaywall() {
    let asked = 0;
    const entry: AuthorityEntry = {
      id: 'unpaywall',
      capabilities: { fields: ['fullText'], authoritative: ['fullText'] },
      pass: 0,
      lookup: ({ signal }) => new Promise<AuthorityFacts | null>((resolve, reject) => {
        asked += 1;
        const timer = setTimeout(
          () => resolve({ fullText: { url: 'https://example.org/copy.pdf', kind: 'pdf', verified: false } }),
          5 + Math.random() * 60
        );
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); });
      })
    };
    return { entry, asked: () => asked };
  }

  it('reports one total, and cuts disjoint pages, for every page of a search', async () => {
    const { entry, calls } = provider();
    const rescuer = unpaywall();
    const options = {
      providers: [entry],
      authorities: [rescuer.entry],
      rescueBudgetMs: 150,
      enrichBudgetMs: 50,
      pageSize: 20,
      resultSets: new ResultSetCache()
    };

    const first = await search(parseQuery('gated'), { ...options, page: 1 });
    expect(first.rescue.bounded).toBe(true);
    const askedForTheSet = rescuer.asked();

    const rest = await Promise.all([2, 3, 4].map(page => search(parseQuery('gated'), { ...options, page })));
    const pages = [first, ...rest];

    expect(new Set(pages.map(p => p.total)).size).toBe(1);
    const ids = pages.flatMap(p => p.papers.map(paper => paper.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(Math.min(first.total, 80));
    // One fan-out, and the rescue was not run again for pages 2 to 4.
    expect(calls).toHaveLength(1);
    expect(rest.every(p => p.fromCache)).toBe(true);
    expect(rescuer.asked()).toBeLessThan(askedForTheSet + 3 * 20 + 1);
  });

  it('does not ask an authority again about a page it has already shown', async () => {
    // Open papers this time: they pass the gate, so the only lookups are the
    // page's own enrichment.
    const open = gated.slice(0, 30).map(p => paper({ ...p, fullText: { url: 'https://example.org/a.pdf', kind: 'pdf', verified: false } }));
    const { entry } = provider(open);
    const rescuer = unpaywall();
    const options = {
      providers: [entry],
      authorities: [rescuer.entry],
      enrichBudgetMs: 5000,
      resultSets: new ResultSetCache(),
      authorityFacts: new AuthorityFactsCache()
    };

    await search(parseQuery('gated'), options);
    const asked = rescuer.asked();
    expect(asked).toBe(20);

    await search(parseQuery('gated'), options);
    expect(rescuer.asked()).toBe(asked);

    // Page 2 is new, so its ten are asked about once.
    await search(parseQuery('gated'), { ...options, page: 2 });
    expect(rescuer.asked()).toBe(asked + 10);
  });
});
