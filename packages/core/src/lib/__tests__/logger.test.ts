import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, useLogger, withLogger } from '../logger';

/**
 * Phase 03's acceptance list says one search should produce "tens of
 * structured log lines, not thousands of unstructured ones", and phase 10's
 * audit found nothing asserting either half of that.
 *
 * The count is a property of the call sites and cannot be tested here. The two
 * properties that *made* the count possible can be, and they are the ones that
 * would regress silently: that every line goes through Fastify's pino instance
 * rather than `console`, which is what puts it under the configured level; and
 * that the detail argument becomes structured fields rather than being
 * stringified into the message.
 *
 * A `console.log` added back to a connector would not fail this suite — but a
 * change that stopped `log` forwarding to the sink, or that flattened the
 * fields, would.
 */

function sink() {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), silent: vi.fn(), level: 'debug', child: vi.fn()
  } as any;
}

let spies: Array<{ mockRestore: () => void }> = [];
beforeEach(() => { spies = []; });
afterEach(() => { spies.forEach(s => s.mockRestore()); useLogger(sink()); });

describe('log — levelled through the server logger', () => {
  it('forwards every level to the injected sink', () => {
    const s = sink();
    useLogger(s);

    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');

    expect(s.debug).toHaveBeenCalledWith({}, 'd');
    expect(s.info).toHaveBeenCalledWith({}, 'i');
    expect(s.warn).toHaveBeenCalledWith({}, 'w');
    expect(s.error).toHaveBeenCalledWith({}, 'e');
  });

  it('does not write to console once a sink is installed', () => {
    // This is what puts every line under the configured level. Connectors used
    // `console.*` directly, which is outside Fastify's logger entirely, so
    // LOG_LEVEL did nothing and production silenced none of it.
    const s = sink();
    useLogger(s);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    spies.push(spy);

    log.error('boom');

    expect(spy).not.toHaveBeenCalled();
    expect(s.error).toHaveBeenCalled();
  });
});

describe('log — structured detail', () => {
  it('passes an object through as pino fields, message second', () => {
    const s = sink();
    useLogger(s);

    log.info('search complete', { query: 'crispr', ms: 812 });

    expect(s.info).toHaveBeenCalledWith({ query: 'crispr', ms: 812 }, 'search complete');
  });

  it('unpacks an Error into a serialisable err field', () => {
    const s = sink();
    useLogger(s);
    const error = new Error('upstream refused');

    log.error('provider failed', error);

    const [fields, msg] = s.error.mock.calls[0];
    expect(msg).toBe('provider failed');
    expect(fields.err).toMatchObject({ message: 'upstream refused', name: 'Error' });
    expect(typeof fields.err.stack).toBe('string');
  });

  it('wraps a primitive rather than losing it or breaking the shape', () => {
    const s = sink();
    useLogger(s);

    log.warn('retrying', 3);

    expect(s.warn).toHaveBeenCalledWith({ detail: 3 }, 'retrying');
  });

  it('sends no fields when there is no detail', () => {
    const s = sink();
    useLogger(s);

    log.debug('bare');

    expect(s.debug).toHaveBeenCalledWith({}, 'bare');
  });

  it('does not treat an array as a field bag', () => {
    const s = sink();
    useLogger(s);

    log.info('ids', [1, 2]);

    expect(s.info).toHaveBeenCalledWith({ detail: [1, 2] }, 'ids');
  });
});

describe('withLogger — the request a line belongs to', () => {
  it('logs to the request\'s logger inside, and to the server\'s outside', () => {
    const server = sink();
    const request = sink();
    useLogger(server);

    withLogger(request, () => log.warn('inside'));
    log.warn('outside');

    expect(request.warn).toHaveBeenCalledWith({}, 'inside');
    expect(server.warn).toHaveBeenCalledWith({}, 'outside');
    expect(server.warn).toHaveBeenCalledTimes(1);
  });

  it('follows the work across an await, which is where pipeline code logs from', async () => {
    const request = sink();
    useLogger(sink());

    await withLogger(request, async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      log.info('after a timer', { provider: 'europepmc' });
    });

    expect(request.info).toHaveBeenCalledWith({ provider: 'europepmc' }, 'after a timer');
  });

  it('keeps two requests running at once apart', async () => {
    const a = sink();
    const b = sink();
    const logAfter = (ms: number, msg: string) =>
      new Promise<void>(resolve => setTimeout(() => { log.info(msg); resolve(); }, ms));

    await Promise.all([withLogger(a, () => logAfter(5, 'a')), withLogger(b, () => logAfter(1, 'b'))]);

    expect(a.info).toHaveBeenCalledWith({}, 'a');
    expect(b.info).toHaveBeenCalledWith({}, 'b');
    expect(a.info).toHaveBeenCalledTimes(1);
    expect(b.info).toHaveBeenCalledTimes(1);
  });
});
