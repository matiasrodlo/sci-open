import type { AuthorityFacts, AuthorityId } from '@open-access-explorer/shared';

/**
 * What each authority said about each DOI, for the life of one search.
 *
 * The sibling of `ProviderCache`, and it exists for the same reason at a
 * smaller scale: the rescue pass and the page enrichment are the same
 * question asked at two points in the pipeline, and a paper that was rescued
 * is by definition a paper that is about to be enriched. Without this, every
 * rescued record on the visible page costs Unpaywall a second identical
 * request within the same call.
 *
 * The promise is stored rather than the value, so two concurrent lookups of
 * one DOI collapse onto a single request the way `SingleFlight` collapses two
 * identical searches. A rejection is evicted rather than remembered — a
 * transient failure during the rescue should not deny the page a fact it could
 * still get.
 *
 * Deliberately per-search rather than per-process. A cached fact would need a
 * TTL and an invalidation story to outlive the request, and neither is worth
 * having for a memo whose whole job is to stop one step repeating another.
 */
export class AuthorityCache {
  private readonly entries = new Map<string, Promise<AuthorityFacts | null>>();

  fetch(
    authority: AuthorityId,
    doi: string,
    work: () => Promise<AuthorityFacts | null>
  ): Promise<AuthorityFacts | null> {
    const key = `${authority}:${doi.toLowerCase()}`;
    const existing = this.entries.get(key);
    if (existing) return existing;

    const flight = (async () => work())();
    this.entries.set(key, flight);

    // Evicted on failure only. Attached here rather than with `finally` so a
    // resolved lookup stays, which is the entire point.
    flight.catch(() => this.entries.delete(key));

    return flight;
  }

  /** Distinct (authority, DOI) pairs asked about. For tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}
