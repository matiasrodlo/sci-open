import { describe, it, expect } from 'vitest';
import type { ProviderId, ProviderReport } from '@sci-open/shared';
import { QuotaState } from '../quota';
import { fanOut, isComplete } from '../fanout';
import { plan } from '../plan';
import { parseQuery } from '../parse-query';
import type { ProviderEntry } from '../registry';
import { paper, ref } from './helpers';

/**
 * A spent quota is a state, not an error per call: a source that answered 429
 * is left alone for a while, and reported as missing for that reason.
 */

const report = (provider: ProviderId, over: Partial<ProviderReport>): ProviderReport =>
  ({ provider, status: 'ok', retrieved: 0, latency: 0, ...over });

describe('QuotaState', () => {
  it('leaves a source out from its 429 until the cool-down ends', () => {
    let t = Date.UTC(2026, 9, 2, 12, 0);
    const quota = new QuotaState({ coolDownMs: 600_000, now: () => t });

    quota.note([report('crossref', { status: 'error', rateLimited: 'refused' })]);
    expect(quota.unavailable().get('crossref')).toBe('rate-limited; not asked again before 12:10 UTC');

    t += 599_999;
    expect(quota.unavailable().has('crossref')).toBe(true);
    t += 1;
    expect(quota.unavailable().size).toBe(0);
  });

  it('ends a cool-down early when the source answers', () => {
    const quota = new QuotaState({ now: () => 0 });

    quota.note([report('crossref', { status: 'error', rateLimited: 'refused' })]);
    quota.note([report('crossref', { status: 'ok' })]);

    expect(quota.unavailable().size).toBe(0);
  });

  it('is not extended by a report of the cool-down itself', () => {
    let t = 0;
    const quota = new QuotaState({ coolDownMs: 1000, now: () => t });

    quota.note([report('crossref', { status: 'error', rateLimited: 'refused' })]);
    t = 900;
    quota.note([report('crossref', { status: 'error', rateLimited: 'cooling-down' })]);
    t = 1000;

    expect(quota.unavailable().size).toBe(0);
  });

  it('starts nothing for a failure that was not a rate limit', () => {
    const quota = new QuotaState({ now: () => 0 });

    quota.note([report('europepmc', { status: 'error', error: 'HTTP 503' }), report('arxiv', { status: 'timeout' })]);

    expect(quota.unavailable().size).toBe(0);
  });
});

function source(id: ProviderId, search: ProviderEntry['search']): ProviderEntry & { calls: number } {
  const entry = {
    id,
    capabilities: {
      keywordSearch: true, fieldedSearch: true, doiLookup: true, fields: [],
      maxPageSize: 100, reportsTotal: true,
      stages: { holds: ['published'], filter: false }, facets: []
    },
    translate: () => 'native',
    calls: 0,
    search: async (args: Parameters<ProviderEntry['search']>[0]) => {
      entry.calls++;
      return search(args);
    }
  } as ProviderEntry & { calls: number };
  return entry;
}

const ask = (providers: ProviderEntry[], unavailable?: ReadonlyMap<ProviderId, string>) =>
  fanOut(plan(parseQuery('crispr'), providers), {
    query: parseQuery('crispr'), depth: 10, offset: 0, timeoutMs: 1000, openAccessOnly: true,
    ...(unavailable ? { unavailable } : {})
  });

describe('fanOut and a rate limit', () => {
  it('reports a 429 as a rate limit, and as a failure', async () => {
    const limited = source('crossref', async () => {
      throw Object.assign(new Error('Crossref 429'), { status: 429 });
    });

    const { reports } = await ask([limited]);

    expect(reports[0]).toMatchObject({ provider: 'crossref', status: 'error', rateLimited: 'refused' });
    expect(reports[0]!.refused).toBeUndefined();
    expect(isComplete(reports)).toBe(false);
  });

  it('reads the status off an axios response too', async () => {
    const limited = source('doaj', async () => {
      throw Object.assign(new Error('Request failed'), { response: { status: 429 } });
    });

    expect((await ask([limited])).reports[0]!.rateLimited).toBe('refused');
  });

  it('does not ask a source it is told is cooling down, and says why it is missing', async () => {
    const cooling = source('crossref', async () => ({ papers: [], skipped: [] }));
    const fine = source('arxiv', async () => ({ papers: [paper({ id: 'arxiv:1', sources: [ref('arxiv')] })], totalHits: 1, skipped: [] }));

    const { reports } = await ask([cooling, fine], new Map([['crossref', 'rate-limited; not asked again before 12:10 UTC']]));

    expect(cooling.calls).toBe(0);
    expect(reports.find(r => r.provider === 'crossref')).toEqual({
      provider: 'crossref', status: 'error', retrieved: 0, latency: 0,
      error: 'rate-limited; not asked again before 12:10 UTC', rateLimited: 'cooling-down'
    });
    // Incomplete, never skipped: a skip is a permanent fact a set may be held on.
    expect(isComplete(reports)).toBe(false);
  });
});
