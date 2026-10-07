/** A paced host had no free slot within the caller's wait. */
export class SourceBusyError extends Error {
  constructor(readonly host: string, readonly retryAfterMs: number) {
    super(`${host} is paced: the next request may go in ${Math.ceil(retryAfterMs / 1000)} s`);
    this.name = 'SourceBusyError';
  }
}

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
 * Spaces the requests this process sends to one host — a robots.txt
 * `Crawl-delay`, kept by reservation. A caller takes the next free slot and
 * sleeps until it. One whose slot is further off than it will wait gets
 * `SourceBusyError` and takes nothing, so a refusal never delays anyone else.
 * One whose signal aborts while it sleeps rejects with the signal's reason,
 * and gives its slot back if nobody has reserved one after it.
 *
 * Per process, not per deployment: two server replicas would each send at
 * this rate. Divide the interval among them before running more than one.
 */
export class HostPacer {
  private nextSlot = 0;

  constructor(
    readonly host: string,
    private readonly intervalMs: number,
    private readonly clock: Clock = realClock
  ) {}

  async acquire(maxWaitMs: number, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const now = this.clock.now();
    const slot = Math.max(now, this.nextSlot);
    if (slot - now > maxWaitMs) throw new SourceBusyError(this.host, slot - now);
    // Reserved before the first await, so no two callers can take one slot.
    this.nextSlot = slot + this.intervalMs;
    if (slot <= now) return;
    try {
      await this.clock.sleep(slot - now, signal);
    } catch (error) {
      // Nothing will be sent in this slot. Still the last one reserved, it
      // is let go, so the next caller does not wait out a request never made;
      // with a later one reserved, the gap stays rather than move anyone.
      if (this.nextSlot === slot + this.intervalMs) this.nextSlot = slot;
      throw error;
    }
  }
}

/**
 * `Crawl-delay: 15` in arXiv's robots.txt, for /html and /pdf alike, which
 * also says indiscriminate automated downloads are not permitted (read
 * 2026-10-02). The search provider stays outside this pacer: it talks to
 * export.arxiv.org's API under that API's own terms.
 */
export const ARXIV_PACER = new HostPacer('arxiv.org', 15_000);

/** The pacer a URL's host must go through, if it has one. */
export function pacerFor(url: string): HostPacer | undefined {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  return host === 'arxiv.org' || host.endsWith('.arxiv.org') ? ARXIV_PACER : undefined;
}
