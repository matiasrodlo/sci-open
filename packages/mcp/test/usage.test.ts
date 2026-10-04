import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { Engine, UpstreamUsage } from '@sci-open/core';
import { paper, recordUpstream, ref } from '@sci-open/core/testing';
import { createServer } from '../src/server';
import { createMetrics } from '../src/metrics';
import { USAGE_KEY } from '../src/provenance';
import { fakeEngine, quietLogger } from './fake-engine';

/**
 * What each call asked of the sources, so the budget a run spends can be
 * traced to the tool and the call that spent it: in the metrics, and in the
 * result's `_meta`, where the evals read it. Requests are counted in the engine
 * (packages/core, `upstream-usage.ts`); a fake engine stands in for them here.
 */

const STUDY = paper({ id: 'openalex:W1', doi: '10.1234/s.1', title: 'Crispr study', year: 2020, sources: [ref('openalex', { nativeId: 'W1' })] });

/** Requests as the pooled client records them, made inside an engine call. */
async function asks(...urls: string[]) {
  for (const url of urls) recordUpstream(url, url.includes('openalex') ? { status: 200, costUsd: 0.001 } : { status: 429 });
}

async function call(engine: Engine, name: string, args: Record<string, unknown>) {
  const metrics = createMetrics(quietLogger);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ engine, config: fakeEngine([]).deps.config, metrics, logger: quietLogger, transport: 'stdio' });
  await server.connect(serverSide);
  const client = new Client({ name: 'usage-test', version: '0.0.0' });
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: args });
    return { result, tools: metrics.snapshot().tools };
  } finally {
    metrics.stop();
    await client.close();
    await server.close();
  }
}

describe('what a call asked of the sources', () => {
  it('is in the result’s _meta and in the tool’s metrics', async () => {
    const { engine } = fakeEngine([STUDY]);
    const search = engine.search.bind(engine);
    vi.spyOn(engine, 'search').mockImplementation(async (params, options) => {
      await asks('https://api.openalex.org/works', 'https://api.openalex.org/works', 'https://eutils.ncbi.nlm.nih.gov/esearch');
      return search(params, options);
    });

    const { result, tools } = await call(engine, 'search_papers', { query: 'crispr' });

    expect(result._meta?.[USAGE_KEY]).toEqual({ upstream_requests: 3, openalex_cost_usd: 0.002, by_source: { openalex: 2, ncbi: 1 } });
    expect(tools.search_papers).toMatchObject({ calls: 1, upstreamRequests: 3, openalexCostUsd: 0.002 });
  });

  it('is there for a call that failed too: a failure can still have cost', async () => {
    const { engine } = fakeEngine([STUDY]);
    vi.spyOn(engine, 'lookup').mockImplementation(async () => {
      await asks('https://api.openalex.org/works/W1');
      throw new TypeError('boom');
    });

    const { result, tools } = await call(engine, 'get_paper', { id: 'openalex:W1' });

    expect(result.isError).toBe(true);
    expect(result._meta?.[USAGE_KEY]).toMatchObject({ upstream_requests: 1 });
    expect(tools.get_paper).toMatchObject({ calls: 1, upstreamRequests: 1 });
  });

  it('is summed by source for each window of the metrics', () => {
    let now: UpstreamUsage = { requests: 10, costUsd: 0.01, sources: { openalex: { requests: 10, failed: 0, rateLimited: 0, costUsd: 0.01 } } };
    const metrics = createMetrics(quietLogger, { upstream: () => now });
    now = {
      requests: 14, costUsd: 0.012,
      sources: {
        openalex: { requests: 12, failed: 1, rateLimited: 1, costUsd: 0.012 },
        ncbi: { requests: 2, failed: 0, rateLimited: 0, costUsd: 0 }
      }
    };
    expect(metrics.snapshot().upstream).toEqual({
      requests: 4, costUsd: 0.002,
      sources: {
        openalex: { requests: 2, failed: 1, rateLimited: 1, costUsd: 0.002 },
        ncbi: { requests: 2, failed: 0, rateLimited: 0, costUsd: 0 }
      }
    });
    metrics.stop();
  });
});
