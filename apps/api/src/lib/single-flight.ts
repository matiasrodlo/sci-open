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

export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<FlightResult<T>> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) {
      // Followers share the leader's outcome, including its failure.
      return { value: await existing, coalesced: true };
    }

    // Start the work before storing it, so a synchronous throw inside `work`
    // becomes a rejected promise rather than escaping past the bookkeeping.
    const flight = (async () => work())();
    this.inFlight.set(key, flight);

    try {
      return { value: await flight, coalesced: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  /** Number of keys currently in flight. For tests and diagnostics. */
  get pending(): number {
    return this.inFlight.size;
  }
}
