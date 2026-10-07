import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { paper, ref } from '@sci-open/core/testing';
import { createServer } from '../src/server';
import { createMetrics } from '../src/metrics';
import { verifyReferences } from '../src/tools/verify-references';
import { readPaper } from '../src/tools/read-paper';
import { savePaper } from '../src/tools/save-paper';
import { getPaper } from '../src/tools/get-paper';
import { getCitations } from '../src/tools/get-citations';
import { exportCitations } from '../src/tools/export-citations';
import { fakeEngine, quietLogger } from './fake-engine';

/**
 * A client that cancels a call gets no answer; the sources should not go on
 * answering it either. The engine is handed the call's signal, and stops what
 * it asked of them (packages/core, `SingleFlight` and `fanOut`).
 */

const STUDY = paper({ id: 'openalex:W1', doi: '10.1234/s.1', title: 'Crispr study', year: 2020, sources: [ref('openalex', { nativeId: 'W1' })] });
const DOC = {
  paperId: STUDY.id, tier: 'europepmc-jats' as const, url: 'https://www.ebi.ac.uk/x', retrievedAt: '2026-10-06T00:00:00Z',
  sections: [{ id: 's1', title: 'Introduction', text: 'Crispr.' }], totalChars: 7
};

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

  it('hands the call\'s signal to every engine call each tool makes, not only to its searches', async () => {
    const fake = fakeEngine([STUDY], { documents: { [STUDY.id]: DOC } });
    const signal = new AbortController().signal;
    const deps = { ...fake.deps, signal };
    const methods = ['lookup', 'doiRegistered', 'readFullText', 'citationLinks', 'resolveDois'] as const;
    const spies = methods.map(method => vi.spyOn(fake.engine, method));

    await readPaper.run({ paper: STUDY.id, view: 'outline', offset: 0, max_chars: 12_000 }, deps);
    const saveTo = path.join(mkdtempSync(path.join(tmpdir(), 'sci-open-cancel-')), 'study');
    await savePaper.run({ paper: STUDY.id, path: saveTo, overwrite: false }, { ...deps, config: { ...deps.config, allowWrites: true } });
    await getPaper.run({ id: STUDY.id }, deps);
    await getCitations.run({ paper: STUDY.id, direction: 'cited_by', limit: 20, offset: 0 }, deps);
    await exportCitations.run({ papers: [STUDY.id, STUDY.doi!], format: 'bibtex', include_abstracts: false, overwrite: false }, deps);
    await verifyReferences.run({ references: ['A made-up study. 2020. doi:10.9999/unknown', 'arXiv:2101.00001'] }, deps);

    for (const [i, method] of methods.entries()) {
      const calls = spies[i]!.mock.calls as unknown[][];
      expect(calls.length, method).toBeGreaterThan(0);
      // Each takes its options last.
      expect(calls.map(call => (call.at(-1) as { signal?: AbortSignal } | undefined)?.signal), method).toEqual(calls.map(() => signal));
    }
  });
});
