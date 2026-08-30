/**
 * The in-process half of the cache: TTL plus a byte budget, least-recently-used
 * first out.
 *
 * Two things it does differently from the `node-cache` instance it replaces,
 * both of which phase 10 exists to fix.
 *
 * **It is bounded in bytes, not in entries.** The old L1 capped at 10,000 keys
 * and the old L3 trimmed above 50,000, which at the response sizes phase 01
 * measured — around 158 KB each — is roughly 1.6 GB and 7.9 GB of heap. A
 * count is not a bound when the things being counted are pages of search
 * results, because nothing about the number says how large they are.
 *
 * **It stores serialised values, so a reader cannot corrupt it.** The old L1
 * ran with `useClones: false` and handed every caller a reference to the same
 * object; anything that sorted or mutated a cached response in place would
 * have changed what the next caller saw. Storing the JSON means each read
 * returns a fresh object, which is what "no in-process mutable state in the
 * request path" has to mean for a cache that is itself in-process. It also
 * makes the byte accounting exact rather than estimated, since the bytes
 * counted are the bytes held.
 *
 * Expiry is lazy — checked on read, and swept ahead of eviction — so there is
 * no interval timer holding the process open.
 */

type Entry = { value: string; bytes: number; expiresAt: number };

export type MemoryCacheStats = {
  keys: number;
  bytes: number;
  maxBytes: number;
  evictions: number;
};

export class MemoryCache {
  // Insertion order is the LRU order: a read re-inserts, so the oldest live
  // key is always the first one iteration yields.
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  private evictions = 0;

  constructor(private readonly maxBytes: number, private readonly now: () => number = Date.now) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlSeconds: number): void {
    this.delete(key);

    const bytes = Buffer.byteLength(value) + Buffer.byteLength(key);
    // A single entry larger than the whole budget is not cached at all, rather
    // than being admitted and immediately evicting everything else.
    if (bytes > this.maxBytes) return;

    this.entries.set(key, { value, bytes, expiresAt: this.now() + ttlSeconds * 1000 });
    this.bytes += bytes;
    this.evict();
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.bytes -= entry.bytes;
    this.entries.delete(key);
    return true;
  }

  /** Every key under a prefix. The basis of subject invalidation. */
  deleteByPrefix(prefix: string): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix) && this.delete(key)) removed += 1;
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.evictions = 0;
  }

  stats(): MemoryCacheStats {
    return { keys: this.entries.size, bytes: this.bytes, maxBytes: this.maxBytes, evictions: this.evictions };
  }

  /**
   * Expired entries go before live ones. Without that the budget would evict a
   * warm entry to make room while dead ones sat in front of it.
   */
  private evict(): void {
    if (this.bytes <= this.maxBytes) return;

    const at = this.now();
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.maxBytes) return;
      if (entry.expiresAt <= at) this.delete(key);
    }

    for (const key of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) return;
      this.delete(key);
      this.evictions += 1;
    }
  }
}
