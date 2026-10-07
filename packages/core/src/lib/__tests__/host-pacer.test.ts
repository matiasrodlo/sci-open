import { describe, it, expect } from 'vitest';
import { HostPacer, SourceBusyError, pacerFor, ARXIV_PACER } from '../host-pacer';

/** A clock that only moves when told to, and records every sleep it was asked for. */
function fakeClock(start = 0) {
  let t = start;
  const slept: number[] = [];
  return {
    clock: { now: () => t, sleep: async (ms: number) => { slept.push(ms); } },
    slept,
    advance: (ms: number) => { t += ms; }
  };
}

/** A clock whose sleeps end only when their signal aborts. */
const stuckClock = {
  now: () => 0,
  sleep: (_ms: number, signal?: AbortSignal) =>
    new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
};

describe('HostPacer', () => {
  it('gives callers at the same instant consecutive slots, one interval apart', async () => {
    const { clock, slept } = fakeClock();
    const pacer = new HostPacer('arxiv.org', 15_000, clock);

    await Promise.all([pacer.acquire(60_000), pacer.acquire(60_000), pacer.acquire(60_000)]);

    // The first goes at once; the others sleep until their slots.
    expect(slept).toEqual([15_000, 30_000]);
  });

  it('refuses a caller whose slot is further off than it will wait, and reserves nothing for it', async () => {
    const { clock } = fakeClock();
    const pacer = new HostPacer('arxiv.org', 15_000, clock);
    await pacer.acquire(20_000);
    await pacer.acquire(20_000);

    const refused = await pacer.acquire(20_000).catch(error => error);
    expect(refused).toBeInstanceOf(SourceBusyError);
    expect(refused).toMatchObject({ host: 'arxiv.org', retryAfterMs: 30_000 });

    // Still 30 s away: the refusal took no slot.
    const again = await pacer.acquire(20_000).catch(error => error);
    expect(again.retryAfterMs).toBe(30_000);
  });

  it('lets a caller go whose signal aborts while it waits, and frees its slot when nobody reserved after it', async () => {
    const pacer = new HostPacer('arxiv.org', 15_000, stuckClock);
    await pacer.acquire(60_000);
    const leaving = new AbortController();
    const waiting = pacer.acquire(60_000, leaving.signal);
    leaving.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

    // The next caller waits for the slot it left, not the one after.
    expect(await pacer.acquire(0).catch(error => error)).toMatchObject({ retryAfterMs: 15_000 });
  });

  it('keeps the gap a leaving caller makes when a later one already reserved', async () => {
    const pacer = new HostPacer('arxiv.org', 15_000, stuckClock);
    await pacer.acquire(60_000);
    const [leaving, later] = [new AbortController(), new AbortController()];
    const waiting = pacer.acquire(60_000, leaving.signal);
    const behind = pacer.acquire(60_000, later.signal);
    leaving.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });

    // Moving the later caller up would break its spacing from whoever came before.
    expect(await pacer.acquire(0).catch(error => error)).toMatchObject({ retryAfterMs: 45_000 });
    later.abort();
    await expect(behind).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reserves nothing for a caller already stopped', async () => {
    const pacer = new HostPacer('arxiv.org', 15_000, stuckClock);
    await expect(pacer.acquire(60_000, AbortSignal.abort())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pacer.acquire(0)).resolves.toBeUndefined();
  });

  it('wakes a real sleep when its signal aborts', async () => {
    const pacer = new HostPacer('example.org', 60_000);
    await pacer.acquire(120_000);
    const leaving = new AbortController();
    const waiting = pacer.acquire(120_000, leaving.signal);
    setTimeout(() => leaving.abort(), 5);
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('frees the slots as time passes', async () => {
    const { clock, slept, advance } = fakeClock();
    const pacer = new HostPacer('arxiv.org', 15_000, clock);
    await pacer.acquire(0);
    advance(15_000);
    await pacer.acquire(0);
    expect(slept).toEqual([]);
  });
});

describe('pacerFor', () => {
  it('paces arXiv and its subdomains, and nothing else', () => {
    expect(pacerFor('https://arxiv.org/pdf/2101.00001')).toBe(ARXIV_PACER);
    expect(pacerFor('https://export.arxiv.org/abs/2101.00001')).toBe(ARXIV_PACER);
    expect(pacerFor('https://journals.plos.org/x.pdf')).toBeUndefined();
    expect(pacerFor('https://notarxiv.org/x.pdf')).toBeUndefined();
    expect(pacerFor('not a url')).toBeUndefined();
  });
});
