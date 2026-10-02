import type { AuthorityFacts, AuthorityId } from '@open-access-explorer/shared';

const keyOf = (authority: AuthorityId, doi: string) => `${authority}:${doi.toLowerCase()}`;

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
 * Per search, because a flight carries the abort signal of the step that
 * started it: shared with a second search, one search's budget running out
 * would fail the other's lookups. Answers outlive the search through
 * `AuthorityFactsCache`, which holds only lookups that have settled.
 */
export class AuthorityCache {
  private readonly entries = new Map<string, Promise<AuthorityFacts | null>>();

  constructor(private readonly facts?: AuthorityFactsCache) {}

  fetch(
    authority: AuthorityId,
    doi: string,
    work: () => Promise<AuthorityFacts | null>
  ): Promise<AuthorityFacts | null> {
    const key = keyOf(authority, doi);
    const existing = this.entries.get(key);
    if (existing) return existing;

    const known = this.facts?.get(authority, doi);
    const flight = known !== undefined ? Promise.resolve(known) : (async () => work())();
    this.entries.set(key, flight);

    // Remembered on success, evicted on failure — the second so that a
    // resolved lookup stays, which is the entire point.
    flight.then(
      answer => { if (known === undefined) this.facts?.set(authority, doi, answer); },
      () => this.entries.delete(key)
    );

    return flight;
  }

  /** Distinct (authority, DOI) pairs asked about. For tests and diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}

/** How long an authority's answer is believed. */
export const DEFAULT_FACTS_TTL_MS = 60 * 60 * 1000;

/**
 * How many answers are held. Most are a few hundred bytes; Crossref's carry an
 * abstract, so budget a few kilobytes each — tens of megabytes at the bound.
 */
export const DEFAULT_FACTS_MAX_ENTRIES = 10_000;

export type AuthorityFactsOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

/**
 * What each authority said about each DOI, across searches.
 *
 * The page a reader turns to is enriched when it is shown, and before this
 * every showing asked again: page 2 and back to page 1 was forty lookups for
 * twenty papers, and a paper on the pages of two searches was asked about
 * twice. An authority's answer — Unpaywall's route, Crossref's publisher, a
 * citation count — changes over months, not minutes, so an hour of believing
 * it costs nothing a reader could see.
 *
 * Only settled answers, null included: "Unpaywall knows nothing about this
 * DOI" is an answer. A failed lookup is never held, so an outage is not
 * remembered past it. Least recently used goes first when full.
 */
export class AuthorityFactsCache {
  private readonly entries = new Map<string, { facts: AuthorityFacts | null; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: AuthorityFactsOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_FACTS_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_FACTS_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  /** The answer, `null` when the answer was "nothing", or `undefined` when there is none to give. */
  get(authority: AuthorityId, doi: string): AuthorityFacts | null | undefined {
    const key = keyOf(authority, doi);
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    this.entries.delete(key);
    if (entry.expiresAt <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.facts;
  }

  set(authority: AuthorityId, doi: string, facts: AuthorityFacts | null): void {
    const key = keyOf(authority, doi);
    this.entries.delete(key);
    this.entries.set(key, { facts, expiresAt: this.now() + this.ttlMs });

    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
