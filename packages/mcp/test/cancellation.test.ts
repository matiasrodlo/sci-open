import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { paper, ref } from '@sci-open/core/testing';
import { createServer } from '../src/server';
import { createMetrics } from '../src/metrics';
import { verifyReferences } from '../src/tools/verify-references';
import { fakeEngine, quietLogger } from './fake-engine';

/**
 * A client that cancels a call gets no answer; the sources should not go on
 * answering it either. The engine is handed the call's signal, and stops what
 * it asked of them (packages/core, `SingleFlight` and `fanOut`).
 */

const STUDY = paper({ id: 'openalex:W1', doi: '10.1234/s.1', title: 'Crispr study', year: 2020, sources: [ref('openalex', { nativeId: 'W1' })] });

describe('a cancelled call', () => {
  it('hands the engine a signal that aborts when the client cancels, and is counted as cancelled', async () => {
    const { engine, deps } = fakeEngine([STUDY]);
    let seen: AbortSignal | undefined;
    vi.spyOn(engine, 'search').mockImplementation((_params, options) => {
      seen = options?.signal;
      return new Promise((_resolve, reject) => seen!.addEventListener('abort', () => reject(seen!.reason), { once: true }));
    });
    const metrics = createMetrics(quietLogger);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createServer({ engine, config: deps.config, metrics, logger: quietLogger, transport: 'stdio' });
    await server.connect(serverSide);
    const client = new Client({ name: 'cancellation-test', version: '0.0.0' });
    await client.connect(clientSide);

    const caller = new AbortController();
    const calling = client.callTool({ name: 'search_papers', arguments: { query: 'crispr' } }, { signal: caller.signal });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen!.aborted).toBe(false);
    caller.abort();

    await expect(calling).rejects.toThrow();
    await vi.waitFor(() => expect(seen!.aborted).toBe(true));
    await vi.waitFor(() => expect(metrics.snapshot().tools.search_papers?.errors).toEqual({ cancelled: 1 }));

    metrics.stop();
    await client.close();
    await server.close();
  });

  it('starts no reference once the call is cancelled, and asks nothing more of the sources', async () => {
    const fake = fakeEngine([STUDY], { openalex: async () => ({ found: new Map(), unasked: [] }) });
    const caller = new AbortController();
    const lookupDoi = vi.spyOn(fake.engine, 'lookupDoi').mockImplementation(async () => {
      caller.abort(); // the client gives up while the first lookup is out
      return null;
    });
    const references = Array.from({ length: 6 }, (_, i) => `Study ${i}. Some title here. 2020. doi:10.1234/s.${i + 10}`);

    await expect(verifyReferences.run({ references }, { ...fake.deps, signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    // Three were in flight when it was cancelled; none of the rest started.
    expect(lookupDoi.mock.calls.length).toBeLessThanOrEqual(3);
    expect(lookupDoi.mock.calls.every(([, options]) => options?.signal === caller.signal)).toBe(true);
  });
});
