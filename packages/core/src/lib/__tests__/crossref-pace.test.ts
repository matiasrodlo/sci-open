import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CrossrefLane } from '../crossref-pace';
import { SourceBusyError } from '../host-pacer';

/** Crossref's limits, kept: so many requests at once, and a request a slot. */

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Work that records when it started and finishes when told. */
function gate() {
  const started: number[] = [];
  const release: Array<() => void> = [];
  const work = () => new Promise<void>(resolve => {
    started.push(Date.now());
    release.push(resolve);
  });
  return { started, release, work };
}

describe('CrossrefLane', () => {
  it('runs no more at once than it allows, the next starting as one finishes', async () => {
    const lane = new CrossrefLane(0, 2);
    const { started, release, work } = gate();
    const runs = [1, 2, 3].map(() => lane.run(work, 10_000));
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(2);

    release[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(3);
    release.slice(1).forEach(done => done());
    await Promise.all(runs);
  });

  it('spaces the starts by its interval', async () => {
    const lane = new CrossrefLane(334, 3);
    const t0 = Date.now();
    const starts: number[] = [];
    const runs = [1, 2, 3].map(() => lane.run(async () => void starts.push(Date.now() - t0), 10_000));
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(runs);
    expect(starts).toEqual([0, 334, 668]);
  });

  it('refuses a caller that cannot start within its wait, and lets the queue move on', async () => {
    const lane = new CrossrefLane(0, 1);
    const { release, work } = gate();
    const first = lane.run(work, 10_000);
    const second = lane.run(work, 500).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(600);
    expect(await second).toBeInstanceOf(SourceBusyError);

    // The refusal took no slot: the next caller starts when the first ends.
    const { started, release: finish, work: next } = gate();
    const third = lane.run(next, 10_000);
    release[0]!();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(1);
    finish[0]!();
    await third;
  });

  it('keeps Crossref’s concurrency across lists and singles together', async () => {
    // Three lists and three singles at once drew a 429 on a live eval.
    vi.resetModules();
    const { crossrefRequest } = await import('../crossref-pace');
    const { started, release, work } = gate();
    const polite = { userAgent: 'test (mailto:someone@example.org)', maxWaitMs: 60_000 };
    const runs = (['list', 'list', 'single', 'single'] as const).map(kind => crossrefRequest(kind, work, polite));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started).toHaveLength(3);

    release[0]!();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(started).toHaveLength(4);
    release.slice(1).forEach(done => done());
    await Promise.all(runs);
  });

  it('leaves the queue when its signal aborts, with the signal’s reason', async () => {
    const lane = new CrossrefLane(0, 1);
    const { release, work } = gate();
    const first = lane.run(work, 10_000);
    const reader = new AbortController();
    const waiting = lane.run(work, 10_000, reader.signal).catch((error: unknown) => error);
    reader.abort(new Error('stopped'));
    expect(await waiting).toMatchObject({ message: 'stopped' });
    release[0]!();
    await first;
  });
});
