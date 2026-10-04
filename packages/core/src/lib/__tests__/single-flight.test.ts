import { describe, it, expect, vi } from 'vitest';
import { SingleFlight } from '../single-flight';

/** A promise plus the handles to settle it from the test. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('SingleFlight', () => {
  it('runs the work once for concurrent callers on the same key', async () => {
    const sf = new SingleFlight();
    const gate = deferred<string>();
    const work = vi.fn(() => gate.promise);

    const all = Promise.all([
      sf.run('k', work),
      sf.run('k', work),
      sf.run('k', work),
      sf.run('k', work)
    ]);

    gate.resolve('result');
    const results = await all;

    expect(work).toHaveBeenCalledTimes(1);
    expect(results.map(r => r.value)).toEqual(['result', 'result', 'result', 'result']);
  });

  it('reports which caller started the work', async () => {
    const sf = new SingleFlight();
    const gate = deferred<number>();

    const all = Promise.all([sf.run('k', () => gate.promise), sf.run('k', () => gate.promise)]);
    gate.resolve(1);
    const [first, second] = await all;

    expect([first.coalesced, second.coalesced]).toEqual([false, true]);
  });

  it('keeps different keys independent', async () => {
    const sf = new SingleFlight();
    const a = vi.fn(async () => 'a');
    const b = vi.fn(async () => 'b');

    const [ra, rb] = await Promise.all([sf.run('a', a), sf.run('b', b)]);

    expect(ra.value).toBe('a');
    expect(rb.value).toBe('b');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('runs again once the previous flight has settled', async () => {
    const sf = new SingleFlight();
    const work = vi.fn(async () => 'x');

    await sf.run('k', work);
    await sf.run('k', work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it('gives every waiter the same failure', async () => {
    const sf = new SingleFlight();
    const gate = deferred<never>();
    const work = vi.fn(() => gate.promise);
    const boom = new Error('upstream exploded');

    const results = Promise.allSettled([sf.run('k', work), sf.run('k', work)]);
    gate.reject(boom);
    const settled = await results;

    expect(work).toHaveBeenCalledTimes(1);
    expect(settled.every(s => s.status === 'rejected')).toBe(true);
    settled.forEach(s => expect((s as PromiseRejectedResult).reason).toBe(boom));
  });

  it('does not cache a failure — the next caller retries', async () => {
    const sf = new SingleFlight();
    const work = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    await expect(sf.run('k', work as any)).rejects.toThrow('transient');
    const second = await sf.run('k', work as any);

    expect(second.value).toBe('recovered');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('releases the key after success and after failure', async () => {
    const sf = new SingleFlight();

    await sf.run('ok', async () => 1);
    expect(sf.pending).toBe(0);

    await expect(sf.run('bad', async () => { throw new Error('no'); })).rejects.toThrow('no');
    expect(sf.pending).toBe(0);
  });

  it('surfaces a synchronous throw as a rejection, leaving no key behind', async () => {
    const sf = new SingleFlight();
    await expect(sf.run('k', () => { throw new Error('sync'); })).rejects.toThrow('sync');
    expect(sf.pending).toBe(0);
  });

  describe('a caller that cancels', () => {
    it('stops waiting at once, while the others still get the value and the work is not stopped', async () => {
      const sf = new SingleFlight();
      const gate = deferred<string>();
      let seen: AbortSignal | undefined;
      const work = (signal: AbortSignal) => { seen = signal; return gate.promise; };
      const leaving = new AbortController();

      const first = sf.run('k', work, leaving.signal);
      const second = sf.run('k', work);
      leaving.abort(new Error('cancelled'));

      await expect(first).rejects.toThrow('cancelled');
      expect(seen?.aborted).toBe(false);
      gate.resolve('result');
      expect((await second).value).toBe('result');
    });

    it('stops the work when every caller has cancelled, and lets the next caller start afresh', async () => {
      const sf = new SingleFlight();
      const signals: AbortSignal[] = [];
      const work = vi.fn((signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<string>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          if (signals.length > 1) resolve('fresh');
        });
      });
      const a = new AbortController();
      const b = new AbortController();

      const runs = [sf.run('k', work, a.signal), sf.run('k', work, b.signal)];
      a.abort(new Error('a left'));
      expect(signals[0]!.aborted).toBe(false);
      b.abort(new Error('b left'));
      await Promise.allSettled(runs);

      expect(signals[0]!.aborted).toBe(true);
      expect(sf.pending).toBe(0);
      expect((await sf.run('k', work)).value).toBe('fresh');
      expect(work).toHaveBeenCalledTimes(2);
    });

    it('refuses at once when it has already been cancelled, starting nothing', async () => {
      const sf = new SingleFlight();
      const work = vi.fn(async () => 'x');
      const done = new AbortController();
      done.abort(new Error('already'));

      await expect(sf.run('k', work, done.signal)).rejects.toThrow('already');
      expect(work).not.toHaveBeenCalled();
    });
  });
});
