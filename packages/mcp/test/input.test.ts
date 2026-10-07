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

describe('a tool that can write a file', () => {
  it('offers save_paper, and export_citations\' save_to, and says they can write, where writes are allowed', async () => {
    const { client, close } = await serve();
    const tools = (await client.listTools()).tools;
    const save = tools.find(t => t.name === 'save_paper')!;
    expect(Object.keys(save.inputSchema.properties ?? {})).toEqual(['paper', 'path', 'overwrite']);
    expect(save.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    const exporter = tools.find(t => t.name === 'export_citations')!;
    expect(Object.keys(exporter.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['save_to', 'overwrite']));
    expect(exporter.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    await close();
  });

  it('keeps read_paper read-only even where writes are allowed: saving is save_paper\'s', async () => {
    const { client, close } = await serve();
    const read = (await client.listTools()).tools.find(t => t.name === 'read_paper')!;
    expect(Object.keys(read.inputSchema.properties ?? {})).not.toContain('save_to');
    expect(read.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    await close();
  });

  it.each([
    ['over HTTP', { transport: 'http' as const }],
    ['with writes turned off', { allowWrites: false }]
  ])('%s, serves no save_paper, offers no save_to, and answers a save_to with why', async (_case, options) => {
    const { client, close } = await serve(options);
    const tools = (await client.listTools()).tools;
    expect(tools.map(t => t.name)).not.toContain('save_paper');
    for (const tool of tools) {
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain('save_to');
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain('overwrite');
      expect(tool.annotations, tool.name).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    const refused = await client.callTool({ name: 'export_citations', arguments: { papers: ['crossref:W1'], save_to: '/tmp/sci-open-x' } });
    expect(text(refused)).toMatch(/^Error \(writes_disabled\)/);
    await close();
  });
});
