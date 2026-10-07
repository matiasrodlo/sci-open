import { SourceBusyError } from './host-pacer';

/**
 * Crossref's own limits, which every request to api.crossref.org goes
 * through: the search provider's and the authority's alike, since Crossref
 * counts them against one allowance.
 *
 * As Crossref states them (effective 2025-12-01, read 2026-10-07): a request
 * whose User-Agent carries a `mailto:` is in the polite pool, and may send ten
 * single-DOI requests a second and three lists — queries and filters — three
 * at once. Without one it is in the public pool: five singles and one list a
 * second, one at a time. A public-pool search answered with
 * `x-rate-limit-limit: 1` and `x-concurrency-limit: 1` when measured.
 *
 * The rate is kept per kind and the concurrency across both: run as three
 * lists and three singles at once, a references eval drew a 429, and a 429
 * benches Crossref for the engine's cool-down.
 *
 * Per process, like `HostPacer`: replicas behind one address each send at
 * this rate.
 */
export type CrossrefKind = 'single' | 'list';
type Pool = 'polite' | 'public';

const LIMITS: Record<Pool, { concurrent: number; perSecond: Record<CrossrefKind, number> }> = {
  polite: { concurrent: 3, perSecond: { single: 10, list: 3 } },
  public: { concurrent: 1, perSecond: { single: 5, list: 1 } }
};

export const CROSSREF_HOST = 'api.crossref.org';

type Clock = { now(): number; sleep(ms: number, signal?: AbortSignal): Promise<void> };

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    })
};

/**
 * So many requests at once, each started at least `intervalMs` after the one
 * before. A caller that cannot start within its wait gets `SourceBusyError`
 * and takes nothing; one whose signal aborts while it waits rejects with the
 * signal's reason and leaves the queue.
 */
export class CrossrefLane {
  private active = 0;
  private nextStart = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly intervalMs: number,
    private readonly concurrent: number,
    private readonly clock: Clock = realClock
  ) {}

  async run<T>(work: () => Promise<T>, maxWaitMs: number, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const deadline = this.clock.now() + maxWaitMs;
    await this.enter(deadline, signal);
    try {
      const now = this.clock.now();
      const start = Math.max(now, this.nextStart);
      if (start > deadline) throw new SourceBusyError(CROSSREF_HOST, start - now);
      // Reserved before the first await, so no two callers share a start.
      this.nextStart = start + this.intervalMs;
      if (start > now) await this.clock.sleep(start - now, signal);
      return await work();
    } finally {
      this.leave();
    }
  }

  private enter(deadline: number, signal?: AbortSignal): Promise<void> {
    if (this.active < this.concurrent) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const admit = () => {
        settle();
        this.active++;
        resolve();
      };
      const settle = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        const at = this.waiting.indexOf(admit);
        if (at >= 0) this.waiting.splice(at, 1);
      };
      const onAbort = () => {
        settle();
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        settle();
        reject(new SourceBusyError(CROSSREF_HOST, this.intervalMs));
      }, Math.max(0, deadline - this.clock.now()));
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(admit);
    });
  }

  private leave(): void {
    this.active--;
    this.waiting[0]?.();
  }
}

type Gates = { concurrent: CrossrefLane; spaced: Record<CrossrefKind, CrossrefLane> };
const pools = new Map<Pool, Gates>();

function gatesFor(userAgent: string | undefined): Gates {
  const pool: Pool = userAgent?.includes('mailto:') ? 'polite' : 'public';
  let gates = pools.get(pool);
  if (!gates) {
    const { concurrent, perSecond } = LIMITS[pool];
    const spaced = (kind: CrossrefKind) => new CrossrefLane(Math.ceil(1000 / perSecond[kind]), Number.POSITIVE_INFINITY);
    gates = { concurrent: new CrossrefLane(0, concurrent), spaced: { single: spaced('single'), list: spaced('list') } };
    pools.set(pool, gates);
  }
  return gates;
}

/** One request to Crossref, inside its limits for the pool the User-Agent puts it in. */
export function crossrefRequest<T>(
  kind: CrossrefKind,
  work: () => Promise<T>,
  options: { userAgent?: string; signal?: AbortSignal; maxWaitMs: number }
): Promise<T> {
  const { concurrent, spaced } = gatesFor(options.userAgent);
  // A place among the requests in flight first, then this kind's next start.
  return concurrent.run(() => spaced[kind].run(work, options.maxWaitMs, options.signal), options.maxWaitMs, options.signal);
}
