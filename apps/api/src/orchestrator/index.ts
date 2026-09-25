import type { AuthorityReport, Paper, ProviderId, ProviderReport, Query, SearchSort } from '@open-access-explorer/shared';
import { matchesQuery } from '@open-access-explorer/shared';
import type { AuthorityEntry } from '../authorities';
import { PROVIDERS, type ProviderEntry } from './registry';
import { plan } from './plan';
import { fanOut, isComplete, type ProviderSettled } from './fanout';
import { ProviderCache } from './provider-cache';
import { mergePapers } from './merge';
import { rank } from './rank';
import { applyPolicy, partitionByPolicy, type PolicyOptions, type UserFilters } from './policy';
import { rescueCandidates, type RescueReport } from './rescue';
import { AuthorityCache } from './authority-cache';
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
export { AuthorityCache } from './authority-cache';

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
   * counts run beside the search and the rescue and enrichment after it, so a
   * budget no longer than the search's own adds nothing to the worst case.
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
  duration: number;
};

/**
 * How deep each provider is read, and the ceiling on what that may be set to.
 *
 * 600 is the measured default, and the number the comments throughout this
 * package are written against. It is configurable — `SEARCH_DEPTH`, read at the
 * request boundary in `from-search-params.ts` — because it is the one setting
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
 * asked for and not the service — and `searchDepth` warns when it binds, so the
 * setting cannot quietly be a number nobody is using.
 */
export const DEFAULT_DEPTH = 600;
export const MAX_DEPTH = 2000;

const DEFAULT_TIMEOUT_MS = 20000;

export async function search(query: Query, options: SearchOptions = {}): Promise<OrchestratorResult> {
  const startedAt = Date.now();
  const {
    page = 1,
    pageSize = 20,
    // Deliberately independent of `page`. Letting depth grow with the page
    // would change the reported total as the user walks through the results,
    // so every page answers from the same window.
    depth: requestedDepth = DEFAULT_DEPTH,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    filters = {},
    sort = 'relevance',
    policy = {},
    authorities,
    enrichBudgetMs,
    rescueLimit,
    rescueBudgetMs,
    openAccessOnly = true,
    facetQueries,
    facetBudgetMs,
    filtersSent = false,
    cache,
    providers = PROVIDERS,
    userAgent,
    now
  } = options;

  // Bounded here rather than where the setting is read, so that every caller
  // is bounded by it — the route, the offline scripts and the comparison
  // harness alike. See `MAX_DEPTH`.
  const depth = Math.min(Math.max(requestedDepth, 1), MAX_DEPTH);

  const planned = plan(query, providers);

  // Each planned provider's search, as it settles — which is what a source
  // counted one bucket at a time waits for before it starts counting.
  const settling = new Map<ProviderId, { promise: Promise<ProviderSettled>; resolve: (s: ProviderSettled) => void }>();
  for (const provider of planned.planned) {
    let resolve!: (s: ProviderSettled) => void;
    const promise = new Promise<ProviderSettled>(r => { resolve = r; });
    settling.set(provider.id, { promise, resolve });
  }

  // Started before the fan-out and awaited only once the page is built: the
  // counts run beside the search, and then beside the rescue and enrichment,
  // none of which needs them.
  const counting = facetQueries && Object.keys(facetQueries).length > 0
    ? countSourceFacets(providers, {
        queries: facetQueries,
        searched: query,
        settled: id => settling.get(id)?.promise ?? Promise.resolve(undefined),
        openAccessOnly,
        budgetMs: facetBudgetMs ?? timeoutMs,
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

  // Shared with the rescue below, so a paper that is asked about twice is
  // fetched once.
  const authorityCache = new AuthorityCache();

  // The gate reads `fullText`, `oaStatus` and `stage`, and the authorities
  // fill all three — so a paper failing it has been judged on what the
  // providers happened to say rather than on what is knowable. `kept` needs no
  // question asked; `candidates` are the ones the answer could still move.
  const { kept, candidates } = partitionByPolicy(ranked, filters, policy);

  const { papers: rescuedPapers, report: rescueReport } = await rescueCandidates(candidates, {
    ...(authorities ? { authorities } : {}),
    ...(rescueLimit !== undefined ? { limit: rescueLimit } : {}),
    ...(rescueBudgetMs !== undefined ? { budgetMs: rescueBudgetMs } : {}),
    ...(userAgent ? { userAgent } : {}),
    cache: authorityCache,
    filters,
    policy
  });

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

  // After filtering so it only orders what will be returned, and before
  // pagination so a page is a slice of the sorted set.
  const sorted = sortPapers(filtered, sort);

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
  const readFacets = generateFacets(sorted, facetBaseSets(ranked, filters, policy, admitted), now?.());

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

  /**
   * A publication type every source asked could express. One that holds
   * several stages and cannot narrow to some of them would answer with its
   * whole match set, and its count would be of that.
   */
  const stagesSent = !query.stages?.length || planned.planned.every(({ capabilities: { stages } }) =>
    stages.filter || stages.holds.every(stage => query.stages!.includes(stage))
  );

  return {
    papers,
    total: sorted.length,
    page,
    pageSize,
    facets,
    reports,
    authorities: authorityReports,
    rescue: rescueReport,
    complete: isComplete(reports),
    countsFromSources: filtersSent && stagesSent,
    duration: Date.now() - startedAt
  };
}
