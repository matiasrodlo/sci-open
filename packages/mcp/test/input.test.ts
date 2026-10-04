import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { createServer } from '../src/server';
import { createMetrics } from '../src/metrics';
import { defaultMcpConfig } from '../src/config';
import { fakeEngine, quietLogger } from './fake-engine';

/**
 * What a client is told about a tool's input, and what it is told when the
 * input is wrong: every failure in the server's own form (`Error (code):` and
 * a hint), counted like any other, and a parameter the tool does not take
 * refused rather than dropped — `pagesize: 5` used to run at the default ten.
 */

async function serve(options: { transport?: 'stdio' | 'http'; allowWrites?: boolean } = {}) {
  const metrics = createMetrics(quietLogger);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer(
    {
      engine: fakeEngine([]).engine,
      config: { ...defaultMcpConfig('test'), allowWrites: options.allowWrites ?? true },
      metrics,
      logger: quietLogger,
      transport: options.transport ?? 'stdio'
    },
    { toolsets: ['all'] }
  );
  await server.connect(serverSide);
  const client = new Client({ name: 'input-test', version: '0.0.0' });
  await client.connect(clientSide);
  return {
    client,
    metrics,
    close: async () => {
      metrics.stop();
      await client.close();
      await server.close();
    }
  };
}

const text = (result: { content: unknown }) => (result.content as Array<{ text?: string }>).map(c => c.text ?? '').join('\n');

describe('a tool’s input', () => {
  it('out of bounds is refused in the server’s own form, with a hint, and counted', async () => {
    const { client, metrics, close } = await serve();
    const result = await client.callTool({ name: 'search_papers', arguments: { query: 'crispr', page_size: 100 } });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Error \(invalid_input\): .*page_size/s);
    expect(text(result)).toContain('Hint:');
    expect(metrics.snapshot().tools.search_papers?.errors).toEqual({ invalid_input: 1 });
    await close();
  });

  it('that names a parameter the tool does not take is refused, naming it', async () => {
    const { client, close } = await serve();
    const result = await client.callTool({ name: 'search_papers', arguments: { query: 'crispr', pagesize: 5 } });

    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/^Error \(invalid_input\): .*pagesize/s);
    await close();
  });

  it('is advertised as taking nothing beyond its schema', async () => {
    const { client, close } = await serve();
    for (const tool of (await client.listTools()).tools) {
      expect(tool.inputSchema, tool.name).toMatchObject({ type: 'object', additionalProperties: false });
    }
    await close();
  });
});
