import type { AuthorityReport, Paper, ProviderId, ProviderReport, Query, SearchSort } from '@open-access-explorer/shared';
import { matchesQuery } from '@open-access-explorer/shared';
import { AUTHORITIES, type AuthorityEntry } from '../authorities';
import { PROVIDERS, type ProviderEntry } from './registry';
import { plan } from './plan';
import { fanOut, isComplete, type ProviderSettled } from './fanout';
import { ProviderCache } from './provider-cache';
import { mergePapers } from './merge';
import { rank } from './rank';
import { applyPolicy, partitionByPolicy, type PolicyOptions, type UserFilters } from './policy';
import { canRescue, rescueCandidates, DEFAULT_RESCUE_BUDGET_MS, DEFAULT_RESCUE_LIMIT, type RescueReport } from './rescue';
import { AuthorityCache, type AuthorityFactsCache } from './authority-cache';
import { resultSetKey, type ResultSet, type ResultSetCache, type ResultSetKeyParts } from './result-set';
import type { UpstreamStats } from './upstream-stats';
import { facetBaseSets, generateFacets, withSourceCounts, type Facets } from './facet';
import { countSourceFacets, type FacetQueries } from './source-facets';
import { sortPapers } from './sort';
import { enrichPage } from './enrich';

export * from './parse-query';
export * from './lookup';
export { PROVIDERS, plan, fanOut, isComplete, ProviderCache, mergePapers, rank, applyPolicy, generateFacets, facetBaseSets, sortPapers, enrichPage };
export { partitionByPolicy } from './policy';
export { countSourceFacets, yearWindow, YEAR_BUCKETS } from './source-facets';
export type { FacetQueries } from './source-facets';
export { rescueCandidates, canRescue, DEFAULT_RESCUE_LIMIT, DEFAULT_RESCUE_BUDGET_MS } from './rescue';
export type { RescueReport } from './rescue';
export { AuthorityCache, AuthorityFactsCache } from './authority-cache';
export { ResultSetCache, resultSetKey } from './result-set';
export type { ResultSet } from './result-set';
export { UpstreamStats } from './upstream-stats';
export type { UpstreamStatsSnapshot } from './upstream-stats';

/**
 * plan -> fan out -> merge/dedupe -> rank -> filter -> rescue -> facet -> paginate -> enrich
 *
 * The order is load-bearing, not stylistic. Ranking after pagination ranks a
 * page; ranking before dedupe ranks duplicates; faceting before filtering
 * describes a set the caller never sees.
 *
 * Enrichment is last for the same kind of reason, and it is the one step whose
 * position is about cost rather than correctness: the authorities are per-DOI
 * lookups, so pointing them at the set costs one request per record and
 * pointing them at the page costs twenty in total.
 *
 * The rescue is the one place that cost is paid before pagination, and it is
 * why it sits where it does. The policy gate reads fields the authorities
 * supply, so applying it to what the providers happened to return drops papers
 * that were never actually judged. Asking about those — and only those, and
 * only up to a limit — is what keeps `total` and the facets describing the set
 * the caller could see rather than the set the providers described. It runs
 * before faceting for exactly the reason faceting runs after filtering.
 *
 * Everything up to the facets resolves the *set*, and depends on neither the
 * page nor the sort; what follows presents one page of it. The two halves are
 * `resolveResultSet` and the rest of `search`, and the line between them is
 * where `ResultSetCache` holds the set — see `result-set.ts`.
 */

export type SearchOptions = {
  page?: number;
  pageSize?: number;
  /** How deep to read into each provider. Independent of page — see below. */
  depth?: number;
  /** Per-provider budget, owned here rather than by the connectors. */
  timeoutMs?: number;
  filters?: UserFilters;
  /** Replaces the ranked order. `relevance` keeps it. */
  sort?: SearchSort;
  policy?: PolicyOptions;
  /** Authorities consulted about the returned page. Empty disables enrichment. */
  authorities?: readonly AuthorityEntry[];
  /** Wall clock for the whole enrichment step. */
  enrichBudgetMs?: number;
  /**
   * How many papers the policy would drop may be asked about before it drops
   * them. See `rescue.ts`. Zero disables the step.
   */
  rescueLimit?: number;
  /** Wall clock for the whole rescue step. */
  rescueBudgetMs?: number;
  /** Passed to providers that support it. Default true, matching prior behaviour. */
  openAccessOnly?: boolean;
  /**
   * The facets to count across everything the sources match, each under the
   * query it is counted under. Absent counts every facet over the read, as
   * this always did. See `source-facets.ts`.
   */
  facetQueries?: FacetQueries;
  /**
   * Wall clock for the whole-index counts, from the start of the fan-out.
   * Defaults to `timeoutMs`, which is what the search itself may take: the
   * counts run beside the fan-out and the rescue, so a budget no longer than
   * the search's own adds nothing to the worst case.
   */
  facetBudgetMs?: number;
  /**
   * True when every filter the caller ticked was sent to the sources rather
   * than only applied to what they returned — which, with every planned source
   * able to express it, is what makes their counts counts of this search. See
   * `OrchestratorResult.countsFromSources`.
   */
  filtersSent?: boolean;
  cache?: ProviderCache;
  /**
   * Where resolved sets are held between requests, so every page of a search
   * slices the same one. Absent resolves the set on every call.
   */
  resultSets?: ResultSetCache;
  /** Authorities' answers, held across searches. See `AuthorityFactsCache`. */
  authorityFacts?: AuthorityFactsCache;
  /** Where each source's reports are tallied across searches. See `UpstreamStats`. */
  stats?: UpstreamStats;
  /**
   * Asked once before this search resolves a set of its own — not when the set
   * is held, or is being resolved by another search — and may throw to refuse
   * it. How the route charges a caller for the searches that cost the sources
   * something. See `ResultSetCache.resolve`.
   */
  admit?: () => Promise<void>;
  providers?: readonly ProviderEntry[];
  userAgent?: string;
  now?: () => Date;
};

export type OrchestratorResult = {
  papers: Paper[];
  /** Length of the filtered set, which is what pagination walks. */
  total: number;
  page: number;
  pageSize: number;
  facets: Facets;
  reports: ProviderReport[];
  /**
   * What each authority was asked and what it was worth. Kept apart from
   * `reports` because an authority is not a source of results — it never adds
   * a paper, so it has no `retrieved` to report and nothing to contribute to
   * the source facet.
   */
  authorities: AuthorityReport[];
  /**
   * What the rescue pass cost and what it bought. Reported separately from
   * `authorities` because those describe the page and this describes the set:
   * it is the one step that changes which papers are in the result at all.
   */
  rescue: RescueReport;
  /**
   * False when a provider failed or timed out, which makes `total` a lower
   * bound rather than an answer.
   *
   * An authority failing does not make a search incomplete. The result set is
   * whole without enrichment; what an authority adds is detail on records that
   * were already going to be returned.
   */
  complete: boolean;
  /**
   * True when the sources' own counts describe this search: the filters were
   * all sent (`filtersSent`), and every source asked could express the
   * publication type among them. The header's "at least" count is the largest
   * source's `totalHits` only then.
   */
  countsFromSources: boolean;
  /** True when the set came from `resultSets` — held, or resolved by a concurrent identical search. */
  fromCache: boolean;
  duration: number;
};

/**
 * How deep each provider is read, and the ceiling on what that may be set to.
 *
 * 600 is the measured default, and the number the comments throughout this
 * package are written against. It is configurable — `SEARCH_DEPTH`, read in
 * `config.ts` — because it is the one setting
 * that decides how much of a corpus a search actually sees. The header reading
 * "2,754 retrieved of 977,761+ matching" is reporting this bound and nothing
 * else: the first figure is `depth x providers that answered`, less duplicates
 * and less what the gates dropped.
 *
 * The ceiling is why the number is clamped here rather than taken on trust.
 * Depth is not one cost, it is a cost per provider per page:
 *
 * - DOAJ and OpenAIRE serve 100 records a page, so each pays `depth / 100`
 *   requests, and `readPages` issues everything after the first in one burst.
 *   At 2,000 that is twenty requests arriving at one API at once.
 * - OpenAlex serves 200, against a daily budget its own header notes a 22-query
 *   sweep can already exhaust at the default's three requests per query.
 * - `ProviderCache` charges bytes, and a normalised record measures about
 *   1.8 KB, so one provider's answer at 2,000 is roughly 3.6 MB against a
 *   128 MB budget — still cacheable, which an entry larger than the whole
 *   budget would not be.
 *
 * Two thousand is where all three stay tolerable. It clamps rather than
 * rejects, because a mis-set variable should cost an operator the depth they
 * asked for and not the service — and `config.ts` warns when it binds, so the
 * setting cannot quietly be a number nobody is using.
 */
export const DEFAULT_DEPTH = 600;
export const MAX_DEPTH = 2000;

const DEFAULT_TIMEOUT_MS = 20000;

/** `SearchOptions` with the defaults applied, for the steps that resolve the set. */
type Settled = ResultSetKeyParts & {
  query: Query;
  providers: readonly ProviderEntry[];
  authorities: readonly AuthorityEntry[] | undefined;
  cache: ProviderCache | undefined;
  stats: UpstreamStats | undefined;
  userAgent: string | undefined;
  now: (() => Date) | undefined;
};

function settle(query: Query, options: SearchOptions): Settled {
  const providers = options.providers ?? PROVIDERS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    query,
    filters: options.filters ?? {},
    policy: {
      requireFullText: options.policy?.requireFullText ?? true,
      requireOpenAccess: options.policy?.requireOpenAccess ?? true
    },
    openAccessOnly: options.openAccessOnly ?? true,
    // Bounded here rather than where the setting is read, so that every caller
    // is bounded by it — the route, the offline scripts and the comparison
    // harness alike. See `MAX_DEPTH`. Deliberately independent of `page`:
    // letting depth grow with the page would change the reported total as the
    // user walks through the results, so every page answers from the same
    // window.
    depth: Math.min(Math.max(options.depth ?? DEFAULT_DEPTH, 1), MAX_DEPTH),
    timeoutMs,
    facetQueries: options.facetQueries && Object.keys(options.facetQueries).length > 0 ? options.facetQueries : undefined,
    facetBudgetMs: options.facetBudgetMs ?? timeoutMs,
    filtersSent: options.filtersSent ?? false,
    providers,
    authorities: options.authorities,
    rescue: {
      authorities: (options.authorities ?? AUTHORITIES).filter(canRescue).map(authority => authority.id),
      limit: options.rescueLimit ?? DEFAULT_RESCUE_LIMIT,
      budgetMs: options.rescueBudgetMs ?? DEFAULT_RESCUE_BUDGET_MS
    },
    cache: options.cache,
    stats: options.stats,
    userAgent: options.userAgent,
    now: options.now
  };
}

function keyOf(settled: Settled): string {
  const { query, filters, policy, openAccessOnly, depth, timeoutMs, facetQueries, facetBudgetMs, filtersSent, providers, rescue } = settled;
  return resultSetKey({
    query, filters, policy, openAccessOnly, depth, timeoutMs, facetQueries, facetBudgetMs, filtersSent, rescue,
    providers: providers.map(({ id, normalizerVersion }) => ({ id, normalizerVersion }))
  });
}

/**
 * A year range that starts after it ends, which nothing can be published in.
 *
 * Reached three ways, none of them a typo the parser could refuse: `yearFrom`
 * after `yearTo` in the filters, a ticked year outside that bound, and `PY=`
 * in the query text disjoint from either — the bounds are intersected, and two
 * that do not overlap intersect to this. Asked of the sources, it cost a whole
 * fan-out, facet counts included, for an answer that could only be empty, and
 * each source read the backwards range its own way.
 */
function emptyYears(query: Query): boolean {
  const { from, to } = query.years ?? {};
  return from !== undefined && to !== undefined && from > to;
}

/** The set a search with no possible answer resolves to, without asking anyone. */
function emptySet(settled: Settled): ResultSet {
  const { filters, policy, providers, now } = settled;
  return {
    papers: [],
    facets: generateFacets([], facetBaseSets([], filters, policy, new Map()), now?.()),
    reports: providers.map((provider: ProviderEntry): ProviderReport => ({
      provider: provider.id,
      status: 'skipped',
      retrieved: 0,
      latency: 0,
      skipReason: 'the year range ends before it starts'
    })),
    rescue: { candidates: 0, examined: 0, rescued: 0, bounded: false, authorities: [] },
    complete: true,
    countsFromSources: false
  };
}

/**
 * plan -> fan out -> merge/dedupe -> match -> rank -> filter -> rescue -> facet:
 * the set, before any page is cut from it.
 */
async function resolveResultSet(settled: Settled, authorityCache: AuthorityCache): Promise<ResultSet> {
  const {
    query, filters, policy, openAccessOnly, depth, timeoutMs, facetQueries, facetBudgetMs, filtersSent,
    providers, authorities, cache, stats, userAgent, now
  } = settled;

  if (emptyYears(query)) return emptySet(settled);

  const planned = plan(query, providers);

  // Each planned provider's search, as it settles — which is what a source
  // counted one bucket at a time waits for before it starts counting.
  const settling = new Map<ProviderId, { promise: Promise<ProviderSettled>; resolve: (s: ProviderSettled) => void }>();
  for (const provider of planned.planned) {
    let resolve!: (s: ProviderSettled) => void;
    const promise = new Promise<ProviderSettled>(r => { resolve = r; });
    settling.set(provider.id, { promise, resolve });
  }

  // Started before the fan-out and awaited only once the set is assembled: the
  // counts run beside the search, and then beside the rescue, neither of which
  // needs them.
  const counting = facetQueries
    ? countSourceFacets(providers, {
        queries: facetQueries,
        searched: query,
        settled: id => settling.get(id)?.promise ?? Promise.resolve(undefined),
        openAccessOnly,
        budgetMs: facetBudgetMs,
        ...(cache ? { cache } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      })
    : Promise.resolve([]);

  const { papers: fetched, reports: searchReports } = await fanOut(planned, {
    query, depth, offset: 0, timeoutMs, openAccessOnly,
    onSettled: settled => settling.get(settled.report.provider)?.resolve(settled),
    ...(cache ? { cache } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(now ? { now } : {})
  });

  const merged = mergePapers(fetched);

  /**
   * The query itself, applied to the records rather than only to the requests.
   *
   * `Query.terms` is a deliberate *widening* of what was typed — see `flatten`
   * — and each provider widens it again by whatever its API cannot express:
   * arXiv has no `NOT`, OpenAIRE has no query language at all, and no two of
   * them index the same text under "title". So the fan-out returns a superset
   * of the answer by construction, and this is where it becomes the answer.
   *
   * Before merging would be cheaper and wrong: the fields a clause reads are
   * merged fields, so a record whose abstract came from one provider and whose
   * author list came from another can only be judged once it is one record.
   *
   * It is subtractive and it keeps anything it cannot positively rule out —
   * `matchesQuery` answers on three values, not two, and a paper this service
   * holds no abstract for is not convicted by an `AB=` clause it cannot be
   * tested against.
   */
  const matched = query.expression
    ? merged.filter(paper => matchesQuery(paper, query.expression!))
    : merged;

  const ranked = rank(matched, { query, ...(now ? { now: now().getTime() } : {}) }).map(s => s.paper);

  // The gate reads `fullText`, `oaStatus` and `stage`, and the authorities
  // fill all three — so a paper failing it has been judged on what the
  // providers happened to say rather than on what is knowable. `kept` needs no
  // question asked; `candidates` are the ones the answer could still move.
  const { kept, candidates } = partitionByPolicy(ranked, filters, policy);

  const { papers: rescuedPapers, report: rescueReport } = await rescueCandidates(candidates, {
    ...(authorities ? { authorities } : {}),
    limit: settled.rescue.limit,
    budgetMs: settled.rescue.budgetMs,
    ...(userAgent ? { userAgent } : {}),
    cache: authorityCache,
    filters,
    policy
  });
  stats?.recordAuthorities(rescueReport.authorities);

  // Back into rank order. A rescued paper takes the position it always had —
  // it was ranked with everything else and only ever excluded by the gate — so
  // the set is rebuilt by walking `ranked` rather than by appending, and the
  // enriched copy is substituted for the original it was made from.
  const admitted = new Map(kept.map(paper => [paper.id, paper]));
  for (const paper of rescuedPapers) admitted.set(paper.id, paper);
  const filtered = ranked.flatMap(paper => {
    const included = admitted.get(paper.id);
    return included ? [included] : [];
  });

  // Facets describe the filtered set — after the rescue, so a paper Unpaywall
  // found a copy for is counted in the buckets it belongs to. Counting before
  // it would have described a set the caller never sees, which is the same
  // mistake as faceting before filtering.
  //
  // With one exception, and it is what makes the panel usable: a facet is not
  // counted over its own selection. Ticking one year used to leave the year
  // facet holding only that year, so a second one could be neither seen nor
  // added, and the OR semantics these filters already have were unreachable
  // from the UI. `facetBaseSets` rebuilds, per ticked facet, the set the other
  // filters admit. It costs nothing when nothing is ticked. See `facet.ts`.
  //
  // Counted in ranked order, not in whatever order a page is sorted by: the
  // counts are the same either way, but a bucket is labelled with the spelling
  // its best-ranked paper carries on a tie, and that should not change with
  // the sort.
  const readFacets = generateFacets(filtered, facetBaseSets(ranked, filters, policy, admitted), now?.());

  // The whole-index counts, raised into the read's facets for every facet
  // that could be counted across the sources. See `withSourceCounts`.
  const sourceCounts = await counting;
  const facets = facetQueries
    ? withSourceCounts(readFacets, sourceCounts, Object.keys(facetQueries) as Array<keyof FacetQueries>, now?.())
    : readFacets;

  // A count that went missing is a floor that could have been higher, and says
  // so on the provider it belongs to — not as a failed search.
  const facetErrors = new Map(sourceCounts.flatMap(r => (r.error ? [[r.provider, r.error] as const] : [])));
  const reports = searchReports.map(report => {
    const facetError = facetErrors.get(report.provider);
    return facetError ? { ...report, facetError } : report;
  });
  stats?.recordProviders(reports);

  /**
   * A publication type every source asked could express. One that holds
   * several stages and cannot narrow to some of them would answer with its
   * whole match set, and its count would be of that.
   */
  const stagesSent = !query.stages?.length || planned.planned.every(({ capabilities: { stages } }) =>
    stages.filter || stages.holds.every(stage => query.stages!.includes(stage))
  );

  return {
    papers: filtered,
    facets,
    reports,
    rescue: rescueReport,
    complete: isComplete(reports),
    countsFromSources: filtersSent && stagesSent
  };
}

export async function search(query: Query, options: SearchOptions = {}): Promise<OrchestratorResult> {
  const startedAt = Date.now();
  const { page = 1, pageSize = 20, sort = 'relevance', authorities, enrichBudgetMs, userAgent, resultSets } = options;

  const settled = settle(query, options);

  // Shared by the rescue and the page, so a paper that is asked about twice in
  // one request is fetched once — and backed by the answers held across
  // requests, so a page shown again is not asked about again.
  const authorityCache = new AuthorityCache(options.authorityFacts);

  const resolve = () => resolveResultSet(settled, authorityCache);
  const { set, cached } = resultSets
    ? await resultSets.resolve(keyOf(settled), resolve, options.admit)
    : await (async () => {
        await options.admit?.();
        return { set: await resolve(), cached: false };
      })();

  // After filtering so it only orders what will be returned, and before
  // pagination so a page is a slice of the sorted set.
  const sorted = sortPapers(set.papers, sort);

  const start = Math.max(page - 1, 0) * pageSize;

  // Enrichment sees the page and only the page. It cannot change which papers
  // are on it, so `total`, `facets` and the page boundary above all still
  // describe the set they were computed over.
  const { papers: enriched, reports: authorityReports } = await enrichPage(sorted.slice(start, start + pageSize), {
    ...(authorities ? { authorities } : {}),
    ...(enrichBudgetMs !== undefined ? { budgetMs: enrichBudgetMs } : {}),
    ...(userAgent ? { userAgent } : {}),
    cache: authorityCache
  });
  options.stats?.recordAuthorities(authorityReports);

  /**
   * Order the page again, because enrichment just rewrote the keys it was
   * ordered by.
   *
   * The authorities fill `title`, `authors`, `year`, `venue`, `publisher` and
   * `citationCount` — every field a sort keys on — and they run after
   * `sortPapers`, so the page was arranged on the values it had *before* they
   * arrived and then displayed with the values it has after. Measured on
   * "crispr" sorted by author: a page reading blank, blank, `С.А. Тимощук`,
   * blank, blank. The comparator is right; that paper genuinely had no author
   * when it was placed, and gained one a moment later.
   *
   * This makes the page consistent with what it shows. It deliberately does
   * not re-slice: membership stays decided on pre-enrichment values, because
   * fixing that would mean enriching the whole filtered set rather than a
   * page, which is the cost this pipeline is built to avoid. So the ordering
   * *within* a page is exact and the ordering *across* pages remains an
   * approximation — a paper that gains a citation count on page 5 stays on
   * page 5.
   */
  const papers = sortPapers(enriched, sort);

  return {
    papers,
    total: set.papers.length,
    page,
    pageSize,
    facets: set.facets,
    reports: set.reports,
    authorities: authorityReports,
    rescue: set.rescue,
    complete: set.complete,
    countsFromSources: set.countsFromSources,
    fromCache: cached,
    duration: Date.now() - startedAt
  };
}
