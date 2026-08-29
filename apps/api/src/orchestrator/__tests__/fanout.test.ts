import { describe, it, expect, vi } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { fanOut, isComplete } from '../fanout';
import { plan } from '../plan';
import { ProviderCache } from '../provider-cache';
import type { ProviderEntry } from '../registry';
import { paper, ref } from './helpers';

const QUERY: Query = { terms: ['crispr'], phrases: [], join: 'AND' };

function stubProvider(
  id: any,
  behaviour: ProviderEntry['search'],
  caps: Partial<ProviderEntry['capabilities']> = {}
): ProviderEntry {
  return {
    id,
    capabilities: {
      keywordSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 100, reportsTotal: true, suppliesCitations: false, ...caps
    },
    translate: () => `native(${id})`,
    normalizerVersion: 1,
    search: behaviour
  };
}

const ok = (id: any, n: number, totalHits?: number) =>
  stubProvider(id, async () => ({
    papers: Array.from({ length: n }, (_, i) =>
      paper({ id: `${id}:${i}`, sources: [ref(id, { nativeId: String(i), rank: i })] })),
    ...(totalHits !== undefined ? { totalHits } : {}),
    skipped: []
  }));

const base = { query: QUERY, depth: 10, offset: 0, timeoutMs: 100, openAccessOnly: true };

describe('fanOut', () => {
  it('reports every provider it asked', async () => {
    const providers = [ok('europepmc', 2, 900), ok('ncbi', 3, 40)];
    const { papers, reports } = await fanOut(plan(QUERY, providers), base);

    expect(papers).toHaveLength(5);
    expect(reports.map(r => r.provider).sort()).toEqual(['europepmc', 'ncbi']);
    expect(reports.every(r => r.status === 'ok')).toBe(true);
    expect(reports.find(r => r.provider === 'europepmc')?.totalHits).toBe(900);
  });

  it('reports a provider that was never asked, and why', async () => {
    const providers = [ok('europepmc', 1), stubProvider('biorxiv', async () => ({ papers: [], skipped: [] }), { keywordSearch: false })];
    const { reports } = await fanOut(plan(QUERY, providers), base);

    const skipped = reports.find(r => r.provider === 'biorxiv');
    expect(skipped).toMatchObject({ status: 'skipped', retrieved: 0 });
    expect(skipped?.skipReason).toMatch(/keywordSearch/);
  });

  it('records a failure as an error without losing the providers that worked', async () => {
    const providers = [ok('europepmc', 3), stubProvider('ncbi', async () => { throw new Error('upstream 500'); })];
    const { papers, reports } = await fanOut(plan(QUERY, providers), base);

    expect(papers).toHaveLength(3);
    expect(reports.find(r => r.provider === 'ncbi')).toMatchObject({
      status: 'error', retrieved: 0, error: 'upstream 500'
    });
    expect(isComplete(reports)).toBe(false);
  });

  it('distinguishes a timeout from an error', async () => {
    // A timeout may mean a healthy but slow provider, which is worth retrying;
    // a 400 is not. The old shape reported both as an empty result.
    const slow = stubProvider('ncbi', () => new Promise<never>(() => {}));
    const { reports } = await fanOut(plan(QUERY, [slow]), { ...base, timeoutMs: 20 });

    expect(reports[0]).toMatchObject({ status: 'timeout', retrieved: 0 });
    expect(reports[0].error).toMatch(/budget/);
  });

  it('signals cancellation to a timed-out provider', async () => {
    let seen: AbortSignal | undefined;
    const slow = stubProvider('ncbi', ({ signal }) => {
      seen = signal;
      return new Promise<never>(() => {});
    });
    await fanOut(plan(QUERY, [slow]), { ...base, timeoutMs: 20 });

    expect(seen?.aborted).toBe(true);
  });

  it('is complete when every provider was ok or deliberately skipped', async () => {
    const providers = [ok('europepmc', 1), stubProvider('biorxiv', async () => ({ papers: [], skipped: [] }), { keywordSearch: false })];
    const { reports } = await fanOut(plan(QUERY, providers), base);
    expect(isComplete(reports)).toBe(true);
  });

  it('runs providers in parallel, not one after another', async () => {
    const slowish = (id: any) => stubProvider(id, async () => {
      await new Promise(r => setTimeout(r, 40));
      return { papers: [], skipped: [] };
    });
    const started = Date.now();
    await fanOut(plan(QUERY, [slowish('europepmc'), slowish('ncbi'), slowish('core')]), { ...base, timeoutMs: 500 });
    expect(Date.now() - started).toBeLessThan(110);
  });

  it('serves a repeated fan-out from the provider cache', async () => {
    const search = vi.fn(async () => ({ papers: [paper()], skipped: [] }));
    const providers = [stubProvider('europepmc', search)];
    const cache = new ProviderCache();
    const planned = plan(QUERY, providers);

    await fanOut(planned, { ...base, cache });
    await fanOut(planned, { ...base, cache });

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('collapses concurrent identical fan-outs onto one upstream call', async () => {
    const search = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 30));
      return { papers: [paper()], skipped: [] };
    });
    const providers = [stubProvider('europepmc', search)];
    const cache = new ProviderCache();
    const planned = plan(QUERY, providers);

    await Promise.all([
      fanOut(planned, { ...base, cache, timeoutMs: 500 }),
      fanOut(planned, { ...base, cache, timeoutMs: 500 }),
      fanOut(planned, { ...base, cache, timeoutMs: 500 }),
      fanOut(planned, { ...base, cache, timeoutMs: 500 })
    ]);

    expect(search).toHaveBeenCalledTimes(1);
  });
});
