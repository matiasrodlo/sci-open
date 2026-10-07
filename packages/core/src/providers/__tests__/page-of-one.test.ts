import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProviderId } from '@sci-open/shared';

/**
 * A count (`countSearch`) reads each source at a depth of one, and
 * `defineProvider` hands a provider its depth as the page size. Every provider
 * a keyword count can ask must then send a page of one: not a full page
 * trimmed afterwards, which is what the four that read through `readPages`
 * sent until it learned to ask for less than a page, and not a size the
 * provider's own clamp raised.
 *
 * Each provider's `fetchPage` is replaced by one that records the request and
 * refuses it, so nothing is normalised and nothing leaves the process.
 */

const { recorded, recorder } = vi.hoisted(() => {
  const recorded: Array<{ provider: string; pageSize: number; offset?: number }> = [];
  const recorder = (provider: string) => async (_query: unknown, options: { pageSize: number; offset?: number }) => {
    recorded.push({ provider, pageSize: options.pageSize, ...(options.offset !== undefined ? { offset: options.offset } : {}) });
    throw new Error('recorded');
  };
  return { recorded, recorder };
});

vi.mock('../arxiv/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('arxiv') }));
vi.mock('../doaj/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('doaj') }));
vi.mock('../europepmc/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('europepmc') }));
vi.mock('../ncbi/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('ncbi') }));
vi.mock('../openaire/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('openaire') }));
vi.mock('../plos/fetch', async original => ({ ...(await original<object>()), fetchPage: recorder('plos') }));

import { PROVIDERS } from '../../orchestrator/registry';
import { parseQuery } from '../../orchestrator/parse-query';

/** Every provider that takes a keyword query and reports a total: what a keyword count asks. */
const COUNTED: ProviderId[] = ['arxiv', 'doaj', 'europepmc', 'ncbi', 'openaire', 'plos'];

beforeEach(() => {
  recorded.length = 0;
});

describe('a read of one record', () => {
  it('is what the registry says a keyword count asks', () => {
    const counted = PROVIDERS.filter(p => p.capabilities.keywordSearch && p.capabilities.reportsTotal).map(p => p.id);
    expect(counted.sort()).toEqual([...COUNTED].sort());
  });

  it.each(COUNTED)('asks %s for a page of one, from the start', async id => {
    const provider = PROVIDERS.find(p => p.id === id)!;

    await expect(provider.search({
      query: parseQuery('crispr'), depth: 1, offset: 0, timeoutMs: 1000, openAccessOnly: true
    })).rejects.toThrow('recorded');

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ provider: id, pageSize: 1 });
    if (recorded[0]!.offset !== undefined) expect(recorded[0]!.offset).toBe(0);
  });
});
