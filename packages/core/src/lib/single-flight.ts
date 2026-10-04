/**
 * Collapses concurrent work that shares a key.
 *
 * A search that misses the cache takes tens of seconds and fans out to every
 * provider. Without this, N users asking the same question in that window each
 * start their own fan-out: the same upstream requests N times over, for one
 * distinct result. The providers see a burst they have no reason to tolerate,
 * and the cache is written N times with the same value.
 *
 * The first caller for a key does the work; everyone arriving while it is still
 * running waits on that same promise and gets the same value. The key is
 * released as soon as the work settles, so a failure is retried by the next
 * caller rather than being cached as a rejection.
 *
 * In-process only. Two API instances will each do the work once, which is the
 * right trade for a guard that needs no coordination and cannot go stale.
 */

export type FlightResult<T> = {
  value: T;
  /** True when this caller joined work already in progress rather than starting it. */
  coalesced: boolean;
};

type Flight = { promise: Promise<unknown>; controller: AbortController; waiting: number; settled: boolean };

/**
 * A caller may pass a signal to stop waiting: it is rejected at once with the
 * signal's reason. The work itself is shared, so it is stopped — its own
 * signal aborted — only when every caller waiting on it has left that way, and
 * the key is let go then, so the next caller starts afresh rather than joining
 * work being torn down. A caller without a signal never leaves.
 */
export class SingleFlight {
  private readonly inFlight = new Map<string, Flight>();

  async run<T>(key: string, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<FlightResult<T>> {
    signal?.throwIfAborted();
    let flight = this.inFlight.get(key);
    const coalesced = flight !== undefined;
    if (!flight) {
      const controller = new AbortController();
      // Start the work before storing it, so a synchronous throw inside `work`
      // becomes a rejected promise rather than escaping past the bookkeeping.
      const promise = (async () => work(controller.signal))();
      const started: Flight = { promise, controller, waiting: 0, settled: false };
      // Released as soon as it settles, so a failure is retried by the next
      // caller. Handled here too, since every caller may have left by then.
      const done = () => {
        started.settled = true;
        this.release(key, started);
      };
      promise.then(done, done);
      this.inFlight.set(key, started);
      flight = started;
    }

    const joined = flight;
    joined.waiting++;
    try {
      // Followers share the leader's outcome, including its failure.
      const value = (await (signal ? untilAborted(joined.promise, signal) : joined.promise)) as T;
      return { value, coalesced };
    } finally {
      joined.waiting--;
      if (joined.waiting === 0 && !joined.settled && signal?.aborted) {
        joined.controller.abort(signal.reason);
        this.release(key, joined);
      }
    }
  }

  /** Number of keys currently in flight. For tests and diagnostics. */
  get pending(): number {
    return this.inFlight.size;
  }

  /** Lets the key go, unless a newer flight already holds it. */
  private release(key: string, flight: Flight): void {
    if (this.inFlight.get(key) === flight) this.inFlight.delete(key);
  }
}

/** `promise`, or the signal's reason as soon as it aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
