import { createHash } from 'crypto';
import type { Paper, ProviderReport, Query } from '@open-access-explorer/shared';
import { SingleFlight } from '../lib/single-flight';
import type { Facets } from './facet';
import { onlyRefused } from './fanout';
import type { PolicyOptions, UserFilters } from './policy';
import type { RescueReport } from './rescue';
import type { FacetQueries } from './source-facets';
import { sizeOf } from './provider-cache';

/**
 * Everything a search returns before it is cut into a page.
 *
 * A search used to be resolved again for every page. The fan-out came from
 * `ProviderCache`, but the rescue ran again each time against a wall-clock
 * budget, and how many candidates it reached depended on how fast Unpaywall
 * answered that second — so the same search reported a total of 123 on page 1,
 * 126 on page 2 and 136 on page 3, and a paper could appear on two pages or on
 * none. Each click also paid for up to two hundred lookups again.
 *
 * Now the set is resolved once and every page is a slice of it: the total, the
 * facets and which paper sits on which page are fixed for as long as the set
 * is held. Only presenting a page — sorting, slicing, enriching twenty papers —
 * happens per request.
 */
export type ResultSet = {
  /** Every paper the search returns, in ranked order. */
  papers: Paper[];
  /** Counted over `papers`, each facet with its own selection lifted. See `facet.ts`. */
  facets: Facets;
  reports: ProviderReport[];
  rescue: RescueReport;
  /** False when a provider failed, which also keeps the set out of the cache. */
  complete: boolean;
  /** Whether the sources' own counts describe this search. See `OrchestratorResult`. */
  countsFromSources: boolean;
};

/**
 * What decides which papers are in a set, and nothing that only decides how
 * it is shown — page, page size and sort are deliberately absent, since
 * leaving them out is the point.
 */
export type ResultSetKeyParts = {
  query: Query;
  filters: UserFilters;
  policy: Required<PolicyOptions>;
  openAccessOnly: boolean;
  depth: number;
  timeoutMs: number;
  /** Which facets are counted across the sources, and under which queries. */
  facetQueries: FacetQueries | undefined;
  facetBudgetMs: number;
  filtersSent: boolean;
  /** A normaliser change changes the papers, as it does the provider cache's key. */
  providers: ReadonlyArray<{ id: string; normalizerVersion: number }>;
  rescue: { authorities: readonly string[]; limit: number; budgetMs: number };
};

export function resultSetKey(parts: ResultSetKeyParts): string {
  // A filter is a set of values joined by OR, so its order says nothing.
  const filters = Object.fromEntries(
    Object.entries(parts.filters).map(([name, value]) => [name, Array.isArray(value) ? [...value].sort() : value])
  );
  const canonical = stableJson({ ...parts, filters });
  return `results:${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}`;
}

/** JSON with object keys in a fixed order, so equal parts always hash equally. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * How long a set is held. Long enough for a reader to page through it; short
 * against how fast the sources change — and past it the set is resolved
 * afresh, fan-out included once `ProviderCache` has let go too.
 */
export const DEFAULT_RESULT_SET_TTL_MS = 30 * 60 * 1000;

/**
 * How long a set is held when some source's whole-index counts failed.
 *
 * `ProviderCache` never keeps partial counts — a rate limit that cost three of
 * ten years is a passing condition, and keeping it would show the gap to every
 * search. Holding the set for the full half hour would do exactly that, and
 * not holding it at all would cut each page from a different set again. A
 * minute keeps one reader's pages consistent and has the gap counted again
 * soon after.
 */
export const DEFAULT_PARTIAL_COUNTS_TTL_MS = 60 * 1000;

/**
 * How much the held sets may be charged, in the serialised bytes
 * `ProviderCache` also counts. A set at the default depth is a few thousand
 * papers, a few megabytes — so this is a dozen or two searches being paged
 * through at once. Charged as though nothing were shared with `ProviderCache`,
 * though a paper no provider shared with another is the same object in both.
 */
export const DEFAULT_RESULT_SET_MAX_BYTES = 64 * 1024 * 1024;

export type ResultSetCacheOptions = {
  ttlMs?: number;
  /** For a set some of whose facet counts failed. See `DEFAULT_PARTIAL_COUNTS_TTL_MS`. */
  partialCountsTtlMs?: number;
  maxBytes?: number;
  now?: () => number;
};

/**
 * Resolved sets, held in this process as they are — not serialised, because a
 * set is read on every page of every search and parsing megabytes to show
 * twenty papers is the cost this exists to remove. Readers must not mutate a
 * set's papers; `enrichPage` copies the ones it writes to.
 *
 * Per process, like `ProviderCache`. Two instances each hold their own sets,
 * so pages stay consistent only while a reader is served by one of them.
 *
 * Only complete sets are kept: one missing a provider is returned and resolved
 * again next time, so a retry can reach the provider that failed. The exception
 * is a provider that refused the query outright, which a retry will not reach
 * either — see `onlyRefused`.
 */
export class ResultSetCache {
  private readonly entries = new Map<string, { set: ResultSet; bytes: number; expiresAt: number }>();
  private readonly flights = new SingleFlight();
  private readonly ttlMs: number;
  private readonly partialCountsTtlMs: number;
  private readonly maxBytes: number;
  private readonly now: () => number;
  private held = 0;

  constructor(options: ResultSetCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_RESULT_SET_TTL_MS;
    this.partialCountsTtlMs = options.partialCountsTtlMs ?? DEFAULT_PARTIAL_COUNTS_TTL_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_RESULT_SET_MAX_BYTES;
    this.now = options.now ?? Date.now;
  }

  /**
   * The held set for `key`, or `work`'s — run once however many callers ask
   * while it runs. `cached` is true when this caller did not resolve it.
   *
   * `admit` is asked first when this caller would start the work — the set is
   * neither held nor being resolved — and may throw to refuse; nothing is
   * resolved then. Joining a resolution already running costs the sources
   * nothing more, so it is not asked.
   */
  async resolve(
    key: string,
    work: () => Promise<ResultSet>,
    admit?: () => Promise<void>
  ): Promise<{ set: ResultSet; cached: boolean }> {
    const held = this.read(key);
    if (held) return { set: held, cached: true };

    if (admit && !this.flights.running(key)) await admit();

    const { value, coalesced } = await this.flights.run(key, async () => {
      const set = await work();
      if (set.complete || onlyRefused(set.reports)) this.write(key, set);
      return set;
    });
    return { set: value, cached: coalesced };
  }

  clear(): void {
    this.entries.clear();
    this.held = 0;
  }

  stats(): { entries: number; bytes: number; maxBytes: number } {
    return { entries: this.entries.size, bytes: this.held, maxBytes: this.maxBytes };
  }

  private read(key: string): ResultSet | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.drop(key);
    if (entry.expiresAt <= this.now()) return undefined;
    // Back in at the end: least recently read goes first.
    this.entries.set(key, entry);
    this.held += entry.bytes;
    return entry.set;
  }

  private write(key: string, set: ResultSet): void {
    const bytes = sizeOf({ papers: set.papers, skipped: [] });
    // Larger than the whole budget is not held, rather than evicting everything.
    if (bytes > this.maxBytes) return;

    const partial = set.reports.some(report => report.facetError !== undefined);
    const ttl = partial ? Math.min(this.partialCountsTtlMs, this.ttlMs) : this.ttlMs;

    this.drop(key);
    this.entries.set(key, { set, bytes, expiresAt: this.now() + ttl });
    this.held += bytes;

    for (const oldest of [...this.entries.keys()]) {
      if (this.held <= this.maxBytes) break;
      this.drop(oldest);
    }
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.held -= entry.bytes;
    this.entries.delete(key);
  }
}
