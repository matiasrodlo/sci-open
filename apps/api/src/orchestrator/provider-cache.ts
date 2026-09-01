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
 *
 * It is bounded in bytes rather than in entries, for the reason `MemoryCache`
 * is: what it holds are pages of search results, and nothing about how many
 * there are says how large they are. See `DEFAULT_MAX_BYTES`.
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

type Entry = { outcome: ProviderSearchOutcome; bytes: number; expiresAt: number };

export type ProviderCacheOptions = {
  /** Per-provider time to live, in milliseconds. */
  ttlMs?: Partial<Record<ProviderId, number>>;
  defaultTtlMs?: number;
  /** How much this cache may hold. See `sizeOf` for what a byte means here. */
  maxBytes?: number;
  now?: () => number;
};

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/**
 * How much the fan-out cache may hold, charged as serialised size.
 *
 * It used to be bounded at 500 *entries*, under a comment saying a page of
 * Papers has no fixed size — which is the reason a count cannot bound it, not a
 * reason to use one. `MemoryCache` had already been through this: its header
 * spends a paragraph on why 10,000 entries of search results is 1.6 GB rather
 * than a limit, and it caps in bytes for exactly that reason. This is the same
 * fix on its sibling.
 *
 * The arithmetic the old bound allowed: an entry holds up to `depth` papers and
 * `DEFAULT_DEPTH` is 600, so 500 entries is 300,000 records. Measured against a
 * normalised Europe PMC record at 1,809 bytes of JSON, that is about 518 MB
 * serialised — and live objects run two to three times their serialised size,
 * so roughly 1 to 1.5 GB of retained heap. It fills slowly, over about fifty
 * distinct queries, which is why it would first appear as an out-of-memory in
 * production rather than as a failing test.
 *
 * 128 MB here is serialised size, not heap: expect two to three times this
 * resident. It is about a dozen full fan-outs at maximum depth and many more at
 * realistic ones, which is the working set this cache exists to serve — a
 * page-2 click reusing the fan-out it was paged from.
 */
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;

function configuredMaxBytes(): number {
  const raw = Number(process.env.PROVIDER_CACHE_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BYTES;
}

/**
 * A flat charge per record, on top of the text it carries.
 *
 * Serialising to measure would be exact and is what `MemoryCache` gets for
 * free, because it stores the JSON it is accounting for. This one stores live
 * objects, so measuring that way means a full `JSON.stringify` of up to 600
 * records on every provider response, and then throwing the string away.
 *
 * Reading the lengths of the fields that actually vary — title, abstract,
 * authors, topics — costs a walk with no allocation, and this constant covers
 * the rest: ids, DOI, venue, publisher, URLs, the source refs and timestamps.
 *
 * Calibrated rather than guessed. Against the committed fixtures for Europe
 * PMC, OpenAIRE, DataCite and DOAJ, the estimate lands at 1.01, 1.01, 1.14 and
 * 1.01 times the real serialised length. Never under, which is the direction a
 * budget should be wrong in: over-charging costs cache entries, under-charging
 * costs the bound.
 */
const PAPER_OVERHEAD_BYTES = 700;

/** A skipped record is a short reason string and two small fields. */
const SKIPPED_OVERHEAD_BYTES = 80;

export function sizeOf(outcome: ProviderSearchOutcome): number {
  let bytes = 0;

  for (const paper of outcome.papers) {
    bytes += PAPER_OVERHEAD_BYTES + paper.title.length + (paper.abstract?.length ?? 0);
    for (const author of paper.authors) bytes += author.length;
    for (const topic of paper.topics) bytes += topic.length;
  }

  for (const skipped of outcome.skipped) {
    bytes += SKIPPED_OVERHEAD_BYTES + skipped.reason.length + (skipped.nativeId?.length ?? 0);
  }

  return bytes;
}

export class ProviderCache {
  private readonly entries = new Map<string, Entry>();
  private readonly flights = new SingleFlight();
  private readonly ttlMs: Partial<Record<ProviderId, number>>;
  private readonly defaultTtlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private held = 0;

  constructor(options: ProviderCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? {};
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS;
    this.maxBytes = options.maxBytes ?? configuredMaxBytes();
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
      this.drop(key);
      return undefined;
    }
    return entry.outcome;
  }

  private write(provider: ProviderId, key: string, outcome: ProviderSearchOutcome): void {
    const bytes = sizeOf(outcome);

    // One entry larger than the whole budget is not cached at all, rather than
    // admitted and immediately evicting everything else. Same rule as
    // `MemoryCache`, and it is reachable here: at maximum depth a single
    // provider's answer is around a megabyte, so a small configured budget is
    // a budget one entry can exceed.
    if (bytes > this.maxBytes) return;

    const ttl = this.ttlMs[provider] ?? this.defaultTtlMs;

    this.drop(key);
    this.entries.set(key, { outcome, bytes, expiresAt: this.now() + ttl });
    this.held += bytes;
    this.evictIfNeeded();
  }

  /** Removes one entry and gives back what it was charged. */
  private drop(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.held -= entry.bytes;
    this.entries.delete(key);
    return true;
  }

  /**
   * Oldest-first, expired before live.
   *
   * The second half matters more once the bound is bytes: an expired megabyte
   * sitting in front of a warm entry would otherwise cost that entry its place
   * for no memory that could not have been reclaimed anyway. `MemoryCache`
   * sweeps in the same order for the same reason.
   */
  private evictIfNeeded(): void {
    if (this.held <= this.maxBytes) return;

    const at = this.now();
    for (const [key, entry] of this.entries) {
      if (this.held <= this.maxBytes) return;
      if (entry.expiresAt <= at) this.drop(key);
    }

    for (const key of [...this.entries.keys()]) {
      if (this.held <= this.maxBytes) return;
      this.drop(key);
    }
  }

  /** Drops every entry for one provider, leaving the others intact. */
  invalidateProvider(provider: ProviderId): number {
    const prefix = `provider:${provider}:`;
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix) && this.drop(key)) removed++;
    }
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  /** What the entries are charged, against the budget they are held under. */
  stats(): { entries: number; bytes: number; maxBytes: number } {
    return { entries: this.entries.size, bytes: this.held, maxBytes: this.maxBytes };
  }
}
