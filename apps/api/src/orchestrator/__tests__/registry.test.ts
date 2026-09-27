import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Paper, Query } from '@open-access-explorer/shared';
import { defineProvider, type ProviderCallOptions, type ProviderModule, type ProviderSearchOutcome } from '../registry';
import { useApiKeys } from '../../lib/api-key';
import { parseQuery } from '../parse-query';
import { paper } from './helpers';

/**
 * The one adapter between the orchestrator and every provider module. It
 * replaced ten written out by hand, so what it forwards is what all ten get —
 * the key most of all, since a provider sent no key is metered as anonymous
 * and nothing about the answer says so.
 */

/** A provider's own result, which may carry more than the orchestrator reads. */
type ModuleOutcome = ProviderSearchOutcome & { latency?: number };

function fakeModule() {
  return {
    capabilities: { facets: [] } as unknown as ProviderModule['capabilities'],
    translate: vi.fn((q: Query) => q.terms.join(' ')),
    search: vi.fn(async (_q: Query, _options: object): Promise<ModuleOutcome> => ({ papers: [paper()], skipped: [], latency: 12 })),
    lookup: vi.fn(async (_id: string, _options: ProviderCallOptions): Promise<Paper | null> => paper()),
    facets: vi.fn(async (_args: unknown, _options: { apiKey?: string }) => ({ facets: {}, failures: [] }))
  };
}

const query = parseQuery('crispr');

afterEach(() => useApiKeys({}));

describe('defineProvider', () => {
  it('asks for depth records, and carries what the call carries', async () => {
    const module = fakeModule();
    const signal = new AbortController().signal;
    const now = () => new Date(0);
    const entry = defineProvider('europepmc', module, { normalizerVersion: 2 });

    await entry.search({ query, depth: 600, offset: 0, timeoutMs: 20000, openAccessOnly: true, signal, userAgent: 'ua', now });

    expect(module.search).toHaveBeenCalledWith(query, {
      pageSize: 600, offset: 0, timeoutMs: 20000, openAccessOnly: true, signal, userAgent: 'ua', now
    });
  });

  it('leaves out what the call did not carry, rather than sending undefined', async () => {
    const module = fakeModule();
    await defineProvider('europepmc', module, { normalizerVersion: 2 })
      .search({ query, depth: 50, offset: 0, timeoutMs: 1000, openAccessOnly: false });

    expect(Object.keys(module.search.mock.calls[0]![1]).sort())
      .toEqual(['offset', 'openAccessOnly', 'pageSize', 'timeoutMs']);
  });

  it('sends a keyed provider its key on every kind of call, read when the call is made', async () => {
    const module = fakeModule();
    const entry = defineProvider('openalex', module, { normalizerVersion: 2, key: 'openalex' });
    // Configured after the entry was built, as `useConfig` is at startup.
    useApiKeys({ openalex: 'secret' });

    await entry.search({ query, depth: 10, offset: 0, timeoutMs: 1000, openAccessOnly: true });
    await entry.lookup!({ nativeId: 'W1', timeoutMs: 1000 });
    await entry.facets!({ requests: [], years: [], openAccessOnly: true, timeoutMs: 1000 });

    expect(module.search.mock.calls[0]![1]).toMatchObject({ apiKey: 'secret' });
    expect(module.lookup).toHaveBeenCalledWith('W1', { timeoutMs: 1000, apiKey: 'secret' });
    expect(module.facets.mock.calls[0]![1]).toEqual({ apiKey: 'secret' });
  });

  it('sends an unkeyed provider no key, even when some other provider has one', async () => {
    useApiKeys({ openalex: 'secret' });
    const module = fakeModule();
    await defineProvider('arxiv', module, { normalizerVersion: 1 })
      .search({ query, depth: 10, offset: 0, timeoutMs: 1000, openAccessOnly: true });

    expect(module.search.mock.calls[0]![1]).not.toHaveProperty('apiKey');
  });

  it('returns the outcome the orchestrator reads, and nothing else', async () => {
    const module = fakeModule();
    const entry = defineProvider('europepmc', module, { normalizerVersion: 2 });

    const outcome = await entry.search({ query, depth: 10, offset: 0, timeoutMs: 1000, openAccessOnly: true });
    expect(Object.keys(outcome).sort()).toEqual(['papers', 'skipped']);

    module.search.mockResolvedValueOnce({ papers: [], totalHits: 42, skipped: [] });
    expect((await entry.search({ query, depth: 10, offset: 0, timeoutMs: 1000, openAccessOnly: true })).totalHits).toBe(42);
  });

  it('offers a lookup and a facet count only when the module has them', () => {
    const { lookup: _lookup, facets: _facets, ...bare } = fakeModule();
    const entry = defineProvider('plos', bare, { normalizerVersion: 1, facetsAggregate: true });

    expect(entry.lookup).toBeUndefined();
    expect(entry.facets).toBeUndefined();
    expect(entry.facetsAggregate).toBe(true);
    expect(defineProvider('plos', bare, { normalizerVersion: 1 }).facetsAggregate).toBeUndefined();
  });
});
