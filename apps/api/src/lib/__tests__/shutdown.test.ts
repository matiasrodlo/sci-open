import { describe, it, expect, vi } from 'vitest';
import { gracefulShutdown } from '../shutdown';

/**
 * A deploy sends SIGTERM while searches are running. What they need —
 * upstream sockets, Redis — has to outlive them, so the server drains first
 * and the resources go after.
 */

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

describe('gracefulShutdown', () => {
  it('releases nothing until the requests in flight have been answered', async () => {
    const drained = deferred();
    const order: string[] = [];
    const server = { close: vi.fn(async () => { await drained.promise; order.push('server'); }) };
    const stop = gracefulShutdown(server, [
      { name: 'upstream connections', close: () => { order.push('upstream'); } },
      { name: 'cache', close: async () => { order.push('cache'); } }
    ]);

    const stopping = stop();
    await Promise.resolve();
    expect(order).toEqual([]);

    drained.resolve();
    await stopping;
    expect(order).toEqual(['server', 'upstream', 'cache']);
  });

  it('closes every resource even when one of them fails', async () => {
    const cache = vi.fn();
    const stop = gracefulShutdown({ close: async () => {} }, [
      { name: 'upstream connections', close: () => { throw new Error('already destroyed'); } },
      { name: 'cache', close: cache }
    ]);

    await expect(stop()).resolves.toBeUndefined();
    expect(cache).toHaveBeenCalledOnce();
  });

  it('runs once however many signals arrive', async () => {
    const server = { close: vi.fn(async () => {}) };
    const cache = vi.fn();
    const stop = gracefulShutdown(server, [{ name: 'cache', close: cache }]);

    await Promise.all([stop(), stop(), stop()]);
    expect(server.close).toHaveBeenCalledOnce();
    expect(cache).toHaveBeenCalledOnce();
  });
});
