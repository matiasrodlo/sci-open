import { createHash } from 'crypto';
import type { ProviderId } from '@open-access-explorer/shared';
import { SingleFlight } from '../lib/single-flight';
import type { ProviderSearchOutcome } from './registry';

/**
 * Caches what each provider returned, not what the search returned.
 *
 * This is the structural fix for the measured 29-second page-2 click. The old
 * cache keyed on the whole request, so changing page, sort or a post-fetch
 * filter missed and refetched every provider — even though none of those
 * changes affect what any provider was asked. Keying per provider means the
 * fan-out is reused and only merge, rank and slice re-run.
 *
 * Two further things fall out of it. TTLs become per provider rather than one
 * number for the whole search, and a provider that failed can be retried
 * without discarding the ones that succeeded.
 *
 * The key deliberately excludes page, sort and user filters — including them
 * would recreate exactly the miss this exists to remove. It includes the
 * normaliser version, so a change to how a payload is read does not serve
 * records shaped by the previous one.
 */

export type ProviderCacheKeyParts = {
  provider: ProviderId;
  /** The native query string, not the user's text: what was actually asked. */
  nativeQuery: string;
  depth: number;
  offset: number;
  normalizerVersion: number;
};

export function providerCacheKey(parts: ProviderCacheKeyParts): string {
  const canonical = [
    parts.provider,
    parts.nativeQuery,
    `depth=${parts.depth}`,
    `offset=${parts.offset}`,
    `v=${parts.normalizerVersion}`
  ].join('|');

  // Hashed for a bounded key length. The provider stays in the clear so
  // entries remain greppable and one provider can be invalidated on its own.
  return `provider:${parts.provider}:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

type Entry = { outcome: ProviderSearchOutcome; expiresAt: number };

export type ProviderCacheOptions = {
  /** Per-provider time to live, in milliseconds. */
  ttlMs?: Partial<Record<ProviderId, number>>;
  defaultTtlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;

export class ProviderCache {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new SingleFlight();
  private readonly ttlMs: Partial<Record<ProviderId, number>>;
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: ProviderCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? {};
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns the cached outcome, or runs `work` once for this key however many
   * callers arrive while it is running.
   */
  async fetch(
    parts: ProviderCacheKeyParts,
    work: () => Promise<ProviderSearchOutcome>
  ): Promise<{ outcome: ProviderSearchOutcome; hit: boolean }> {
    const key = providerCacheKey(parts);
    const cached = this.read(key);
    if (cached) return { outcome: cached, hit: true };

    const { value } = await this.flights.run(key, async () => {
      // Re-read inside the flight: a leader may have populated the entry
      // between this caller missing and joining.
      const raced = this.read(key);
      if (raced) return raced;

      const outcome = await work();
      this.write(parts.provider, key, outcome);
      return outcome;
    });

    // `hit` reports whether the cache served it, not whether this caller did
    // the work — a coalesced caller still caused no upstream request.
    return { outcome: value, hit: false };
  }

  private read(key: string): ProviderSearchOutcome | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.outcome;
  }

  private write(provider: ProviderId, key: string, outcome: ProviderSearchOutcome): void {
    const ttl = this.ttlMs[provider] ?? this.defaultTtlMs;
    this.entries.set(key, { outcome, expiresAt: this.now() + ttl });
    this.evictIfNeeded();
  }

  /** Oldest-first eviction. Bounded by entries because a page of Papers has no fixed size. */
  private evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** Drops every entry for one provider, leaving the others intact. */
  invalidateProvider(provider: ProviderId): number {
    const prefix = `provider:${provider}:`;
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }
}
