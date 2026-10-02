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
