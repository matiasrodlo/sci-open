import { describe, it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import type { Engine, EngineLogger } from '@sci-open/core';
import { paper, ref } from '@sci-open/core/testing';
import { createServer } from '../src/server';
import { nullMetrics } from '../src/metrics';
import { verifyReferences } from '../src/tools/verify-references';
import { exportCitations } from '../src/tools/export-citations';
import { fakeEngine } from './fake-engine';

/**
 * The model is told a failure's code and what to do next, never its cause;
 * whoever runs the server is told the cause, in the log. Without that line an
 * `internal` is a counter in the metrics and nothing else.
 */

type Line = { level: string; fields: Record<string, unknown>; msg: string };

function capture(): { logger: EngineLogger; lines: Line[] } {
  const lines: Line[] = [];
  const at = (level: string) => (fields: Record<string, unknown>, msg: string) => void lines.push({ level, fields, msg });
  return { logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }, lines };
}

const STUDY = paper({ id: 'openalex:W1', doi: '10.1234/s.1', title: 'Crispr study', year: 2020, sources: [ref('openalex', { nativeId: 'W1' })] });

async function call(engine: Engine, logger: EngineLogger, name: string, args: Record<string, unknown>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ engine, config: fakeEngine([]).deps.config, metrics: nullMetrics, transport: 'stdio', logger });
  await server.connect(serverSide);
  const client = new Client({ name: 'failures-test', version: '0.0.0' });
  await client.connect(clientSide);
  try {
    const result = await client.callTool({ name, arguments: args });
    return { isError: result.isError, text: (result.content as Array<{ text?: string }>).map(c => c.text ?? '').join('\n') };
  } finally {
    await client.close();
    await server.close();
  }
}

describe('a failed tool call', () => {
  it('logs a fault in this server as an error with its stack, and tells the model only the code', async () => {
    const { engine } = fakeEngine([STUDY]);
    vi.spyOn(engine, 'lookup').mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'nativeId')"));
    const { logger, lines } = capture();

    const result = await call(engine, logger, 'get_paper', { id: 'openalex:W1' });

    expect(result.isError).toBe(true);
    expect(result.text).toBe('Error (internal): The server could not complete this request.');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'error',
      fields: { tool: 'get_paper', code: 'internal', err: "Cannot read properties of undefined (reading 'nativeId')" }
    });
    expect(lines[0]!.fields.stack).toContain('TypeError');
    // The call's arguments are the user's; they stay out of the log.
    expect(JSON.stringify(lines)).not.toContain('openalex:W1');
  });

  it('logs an upstream failure as a warning, a wait as info, and a tool’s own answer only at debug', async () => {
    const timeout = Object.assign(new Error('timeout of 15000ms exceeded'), { code: 'ECONNABORTED' });
    // As the arXiv client throws a status it is answered with, and as the HTTP client throws a 5xx.
    const refused = Object.assign(new Error('arXiv 429'), { status: 429 });
    const failed = Object.assign(new Error('Request failed with status code 503'), { response: { status: 503 } });
    const cases: Array<[string, Error | undefined, string]> = [
      ['upstream_unavailable', timeout, 'warn'],
      ['rate_limited', refused, 'info'],
      ['upstream_unavailable', failed, 'warn'],
      ['not_found', undefined, 'debug'] // no source holds it: an answer, not a failure
    ];
    for (const [code, thrown, level] of cases) {
      const { engine } = fakeEngine([STUDY]);
      if (thrown) vi.spyOn(engine, 'lookup').mockRejectedValue(thrown);
      const { logger, lines } = capture();
      const result = await call(engine, logger, 'get_paper', { id: thrown ? 'openalex:W1' : 'openalex:W404' });
      expect(result.text).toContain(`Error (${code})`);
      expect(lines.map(l => [l.level, l.fields.tool, l.fields.code])).toEqual([[level, 'get_paper', code]]);
    }
  });

  it('logs a failure that only cost one reference, or one paper of an export, though the call succeeds', async () => {
    // OpenAlex lacks the DOI, so it is looked up in every source, which fails.
    const verifying = fakeEngine([STUDY], { openalex: async () => ({ found: new Map(), unasked: [] }) });
    vi.spyOn(verifying.engine, 'lookupDoi').mockRejectedValue(new TypeError('boom in a normalizer'));
    const verified = capture();
    const { structured } = await verifyReferences.run({ references: ['10.1234/s.1'] }, { ...verifying.deps, logger: verified.logger });
    expect(structured.results[0]).toMatchObject({ verdict: 'not_checked', issues: ['lookup_failed: internal'] });
    expect(verified.lines).toMatchObject([{ level: 'error', fields: { tool: 'verify_references', code: 'internal', err: 'boom in a normalizer' } }]);

    // Measured live: arXiv's 429 on an arXiv id left the reference not checked
    // as `internal`. It is a wait, with a number on it.
    const busy = fakeEngine([STUDY]);
    vi.spyOn(busy.engine, 'lookup').mockRejectedValue(Object.assign(new Error('arXiv 429'), { status: 429 }));
    const waited = capture();
    const checked = await verifyReferences.run({ references: ['arXiv:1610.02415'] }, { ...busy.deps, logger: waited.logger });
    expect(checked.structured.results[0]).toMatchObject({ verdict: 'not_checked', issues: ['rate_limited: retry in 60 s'] });
    expect(waited.lines).toMatchObject([{ level: 'info', fields: { tool: 'verify_references', code: 'rate_limited' } }]);

    const exporting = fakeEngine([STUDY]);
    vi.spyOn(exporting.engine, 'lookup').mockRejectedValue(new TypeError('boom in a lookup'));
    const exported = capture();
    const outcome = await exportCitations.run(
      exportCitations.input.parse({ papers: ['10.1234/s.1', 'openalex:W2'] }),
      { ...exporting.deps, logger: exported.logger }
    );
    expect(outcome.structured.unresolved).toEqual([{ input: 'openalex:W2', reason: 'internal' }]);
    expect(exported.lines).toMatchObject([{ level: 'error', fields: { tool: 'export_citations', code: 'internal', err: 'boom in a lookup' } }]);
  });
});
