import { describe, it, expect, vi } from 'vitest';
import type { ProviderReport, Query } from '@open-access-explorer/shared';
import { fanOut, isComplete, onlyRefused } from '../fanout';
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
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [], yearFilter: true,
      maxPageSize: 100, reportsTotal: true, suppliesCitations: false,
      stages: { holds: ['published'], filter: false }, facets: [], ...caps
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

  it('skips a provider that can express none of the query, rather than reporting it empty', async () => {
    // A wildcard the provider's API refuses leaves its translation empty. Asked
    // anyway, it would answer `ok` with nothing retrieved — a "0" in the panel
    // for a question it was never put.
    const search = vi.fn(async () => ({ papers: [], skipped: [] }));
    const mute = { ...stubProvider('openalex', search), translate: () => '' };
    const { reports } = await fanOut(plan(QUERY, [ok('europepmc', 1), mute]), base);

    expect(search).not.toHaveBeenCalled();
    expect(reports.find(r => r.provider === 'openalex')).toMatchObject({
      status: 'skipped', retrieved: 0, skipReason: 'cannot express this query'
    });
    // A skip is not a failure, so the set is still whole.
    expect(isComplete(reports)).toBe(true);
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

  it('records a 400 or 422 as the provider refusing the query', async () => {
    // As OpenAlex's own error carries it, and as an axios error does.
    const refusals = [
      Object.assign(new Error('OpenAlex 400: Wildcards (* or ?) require the exact field'), { status: 400 }),
      Object.assign(new Error('Unprocessable'), { status: 422 }),
      Object.assign(new Error('Request failed with status code 400'), { response: { status: 400 } })
    ];
    for (const error of refusals) {
      const { reports } = await fanOut(plan(QUERY, [stubProvider('openalex', async () => { throw error; })]), base);
      expect(reports[0]).toMatchObject({ status: 'error', refused: true });
    }
  });

  it('calls nothing else a refusal, since a retry may be answered', async () => {
    const failures: ProviderEntry['search'][] = [
      // Rate-limited, and a server error: both may be answered next time.
      async () => { throw Object.assign(new Error('OpenAlex 429: budget'), { status: 429 }); },
      async () => { throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } }); },
      // A status in the message is not read: guessing from text is how a 503
      // page that mentions a 400 becomes a set held for half an hour.
      async () => { throw new Error('HTTP 400'); },
      () => new Promise<never>(() => {})
    ];
    for (const failure of failures) {
      const { reports } = await fanOut(plan(QUERY, [stubProvider('ncbi', failure)]), { ...base, timeoutMs: 20 });
      expect(reports[0]!.refused).toBeUndefined();
    }
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

describe('onlyRefused', () => {
  const report = (over: Partial<ProviderReport>): ProviderReport =>
    ({ provider: 'ncbi', status: 'ok', retrieved: 1, latency: 1, ...over });
  const refused = report({ provider: 'openalex', status: 'error', retrieved: 0, error: 'OpenAlex 400', refused: true });

  it('is true when every provider that did not answer refused the query', () => {
    expect(onlyRefused([report({}), refused, report({ status: 'skipped' })])).toBe(true);
  });

  it('is false when anything that failed might answer a retry', () => {
    expect(onlyRefused([refused, report({ status: 'timeout', retrieved: 0 })])).toBe(false);
    expect(onlyRefused([refused, report({ status: 'error', retrieved: 0, error: 'HTTP 503' })])).toBe(false);
  });

  it('is false when nothing failed, so it never stands in for `isComplete`', () => {
    expect(onlyRefused([])).toBe(false);
    expect(onlyRefused([report({})])).toBe(false);
  });
});
