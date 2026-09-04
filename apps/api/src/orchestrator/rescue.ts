import type { AuthorityReport, Paper } from '@open-access-explorer/shared';
import { AUTHORITIES, type AuthorityEntry } from '../authorities';
import type { AuthorityCache } from './authority-cache';
import { enrichPage } from './enrich';
import { applyPolicy, type PolicyOptions, type UserFilters } from './policy';

/**
 * Give the papers the policy is about to drop a chance to answer for
 * themselves.
 *
 * `passesPolicy` asks two questions — is there a retrievable copy, and is this
 * open — and both read fields the providers frequently do not supply. Before
 * this step existed, a paper whose only PDF Unpaywall knows about was
 * discarded by `applyPolicy` and then never enriched, because enrichment runs
 * on the page and the paper never reached one. The gap was self-concealing:
 * the record was missing from `total`, missing from the facets, and there was
 * nothing in the response to say it had ever been considered.
 *
 * The obvious fix is to enrich the whole filtered set before the gate. That is
 * a per-DOI request each — a measured set of 2,388 records is 2,388 requests —
 * and it is the cost the whole pipeline is arranged to avoid. This is the
 * bounded version of it:
 *
 * - Only the papers the gate would drop, and only those carrying a DOI. A
 *   paper excluded by a filter the caller ticked is settled, and a paper with
 *   no DOI has no question left to ask.
 * - Only the authorities that could actually change the answer, chosen by
 *   their declared capabilities rather than by name.
 * - Only the first `limit` of them, in rank order, so the requests are spent
 *   on the records most likely to be seen.
 *
 * Whatever the limit or the budget cuts off is simply not rescued, which is
 * exactly the old behaviour. This step can only ever add papers back.
 */

/**
 * The gates a rescue can reopen, and therefore the fields an authority has to
 * be *authoritative* on to be worth asking here.
 *
 * Gap-filling is not enough. An authority that merely declares `fullText` may
 * offer a link that is not a copy anyone can fetch — Crossref's are
 * `intended-application: text-mining`, several of them pointing at
 * `api.wiley.com`, which wants a token. `applyFacts` tolerates those on a page
 * that is already being returned, where the worst case is a dead button. Here
 * the same value would *admit a paper to the result set*, and a result set
 * padded with records whose PDF does not resolve is worse than one that is
 * honestly smaller. Widening this to the gap-fillers is a measurement, not a
 * free win.
 */
const GATED_FIELDS = ['fullText', 'oaStatus'] as const;

export function canRescue(authority: AuthorityEntry): boolean {
  return GATED_FIELDS.some(field => authority.capabilities.authoritative.includes(field));
}

export type RescueOptions = {
  authorities?: readonly AuthorityEntry[];
  /**
   * How many candidates to examine, in rank order. The cost of this step is
   * one request per candidate per rescuing authority, so this is the number
   * that bounds it.
   *
   * Deliberately independent of the requested page, for the same reason
   * `depth` is: a window that grew as the reader paged would change `total`
   * underneath them. Zero disables the step.
   */
  limit?: number;
  /** Per-lookup budget. */
  timeoutMs?: number;
  /** Wall clock for the whole step. */
  budgetMs?: number;
  /** Lookups in flight at once. */
  concurrency?: number;
  userAgent?: string;
  cache?: AuthorityCache;
  /** Re-tested against these, because a rescued value can fail them too. */
  filters?: UserFilters;
  policy?: PolicyOptions;
};

export type RescueReport = {
  /** Papers the gate would have dropped that were worth a question. */
  candidates: number;
  /**
   * Of those, how many actually came back with an answer — which the limit, the
   * budget and a failing authority each cut into. `candidates - examined` is
   * the number dropped without ever being judged.
   */
  examined: number;
  /** Of those, how many now pass and rejoin the set. */
  rescued: number;
  /**
   * True when a candidate went unanswered — the limit cut the list short, or
   * the budget expired with lookups still outstanding. It is the one case
   * where `total` remains a lower bound for a reason other than a failed
   * provider, so it is reported rather than inferred from the counts.
   */
  bounded: boolean;
  /** What each rescuing authority was asked and what it was worth. */
  authorities: AuthorityReport[];
};

export const DEFAULT_RESCUE_LIMIT = 200;
const DEFAULT_TIMEOUT_MS = 2500;

/**
 * Wall clock for the whole step, and — not the limit — the constraint that
 * actually decides how many candidates get asked about.
 *
 * The two defaults cannot both bind. 200 candidates at a concurrency of 16 is
 * 12.5 waves, which fits in five seconds only if the mean Unpaywall lookup is
 * under 400ms, while the per-lookup timeout alone is 2500ms. So on any broad
 * query the budget expires first and the limit is never reached, and an
 * operator who raises `SEARCH_RESCUE_LIMIT` to rescue more papers changes
 * nothing at all.
 *
 * Exported and configurable for that reason. It is the number worth moving.
 */
export const DEFAULT_RESCUE_BUDGET_MS = 5000;
const DEFAULT_CONCURRENCY = 16;

export type RescueResult = {
  /** Enriched copies that now pass. Never the caller's objects. */
  papers: Paper[];
  report: RescueReport;
};

const empty = (candidates: number, bounded: boolean): RescueResult => ({
  papers: [],
  report: { candidates, examined: 0, rescued: 0, bounded, authorities: [] }
});

export async function rescueCandidates(
  candidates: readonly Paper[],
  options: RescueOptions = {}
): Promise<RescueResult> {
  const {
    authorities = AUTHORITIES,
    limit = DEFAULT_RESCUE_LIMIT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    budgetMs = DEFAULT_RESCUE_BUDGET_MS,
    concurrency = DEFAULT_CONCURRENCY,
    userAgent,
    cache,
    filters = {},
    policy = {}
  } = options;

  if (candidates.length === 0) return empty(0, false);

  const rescuers = authorities.filter(canRescue);

  // Nothing that *could* have been asked means nothing was left unasked: the
  // set is as complete as the configured authorities can make it, and saying
  // otherwise would report a shortfall no setting can close.
  if (rescuers.length === 0) return empty(candidates.length, false);

  // A limit of zero is an operator turning the step off, and it cuts the list
  // short like any other limit — so it is reported the same way. The choice
  // being deliberate does not make `total` any less of a lower bound.
  if (limit <= 0) return empty(candidates.length, true);

  // What the limit allows us to try. How many of these are actually reached is
  // the budget's business, and is what `RescueReport.examined` reports.
  const attempted = candidates.slice(0, limit);

  // The same step as the page enrichment, pointed at a different set. Reusing
  // it rather than repeating its pool, budget and abort handling is deliberate
  // — the care in `enrichPage` about a lookup that outlives its budget applies
  // here word for word.
  const { papers, reports, examined: answered } = await enrichPage(attempted, {
    authorities: rescuers,
    timeoutMs,
    budgetMs,
    concurrency,
    ...(userAgent ? { userAgent } : {}),
    ...(cache ? { cache } : {})
  });

  // Re-tested in full, not just against the gate that dropped them. A route
  // arriving from Unpaywall can fail a `filters.oaStatus` the paper satisfied
  // while it was still `unknown`, and admitting it on the strength of the gate
  // alone would put a paper on the page that the caller filtered out.
  const rescued = applyPolicy(papers, filters, policy);

  return {
    papers: rescued,
    report: {
      candidates: candidates.length,
      // What was actually asked, not what was handed over to be asked. These
      // differ exactly when the budget expires mid-flight, which is the case
      // this number exists to make visible — reporting the size of the slice
      // said 200 candidates were examined when the budget had stopped the pass
      // at forty, and the field's own comment already promised "the limit *and
      // the budget*".
      examined: answered,
      rescued: rescued.length,
      // A budget that expired mid-flight leaves the set as short as a limit
      // that never asked, so both say so — and with `answered` counting only
      // the candidates that came back, the first term now carries the limit,
      // the budget and a failed lookup alike.
      //
      // The timeout check is not redundant behind it. With more than one
      // rescuing authority, one can answer for every candidate while another is
      // cut off partway: every paper is examined, and a question that might
      // have changed the answer still went unasked.
      bounded: answered < candidates.length || reports.some(r => r.status === 'timeout'),
      authorities: reports
    }
  };
}
