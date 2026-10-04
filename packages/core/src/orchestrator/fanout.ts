import type { Paper, ProviderId, ProviderReport, Query } from '@sci-open/shared';
import type { Plan } from './plan';
import type { ProviderCache } from './provider-cache';

/**
 * Ask every planned provider, in parallel, within a budget the orchestrator
 * owns.
 *
 * Every outcome becomes a ProviderReport — including the providers that were
 * never asked. A provider that is missing from the report is a bug; a provider
 * that contributed nothing has to say why. Phase 01 measured Europe PMC
 * returning zero records on one run and 600 on the next with nothing
 * distinguishing a timeout from an empty corpus, which is the failure this
 * shape exists to prevent.
 */

export type FanOutOptions = {
  query: Query;
  depth: number;
  offset: number;
  /** Per-provider budget. Owned here, not by the connectors. */
  timeoutMs: number;
  openAccessOnly: boolean;
  cache?: ProviderCache;
  userAgent?: string;
  now?: () => Date;
  /**
   * Called as each planned provider settles, with what it returned — before
   * the slowest one has. The facet counts are the listener: a provider that is
   * counted one bucket at a time waits for its own search, not for everyone's.
   */
  onSettled?: (settled: ProviderSettled) => void;
  /**
   * Providers not to ask this time, and why: the engine's quota state. Each is
   * reported failed and `cooling-down`, without a request — never `skipped`,
   * which says the provider cannot express the query and lets the set be held.
   */
  unavailable?: ReadonlyMap<ProviderId, string>;
  /**
   * The caller's: when it aborts, every provider still running is told to
   * stop, and reported failed. A caller that must not go on with what is left
   * checks it afterwards. A request shared through `cache` with another
   * caller goes on until every caller sharing it has left.
   */
  signal?: AbortSignal;
};

export type ProviderSettled = { report: ProviderReport; papers: readonly Paper[] };

export type FanOutResult = {
  papers: Paper[];
  reports: ProviderReport[];
};

class TimeoutError extends Error {
  constructor(ms: number) {
    super(`exceeded the ${ms}ms budget`);
    this.name = 'TimeoutError';
  }
}

/**
 * Races work against the budget and signals cancellation.
 *
 * The abort is what stops a timed-out provider from continuing to decode a
 * multi-megabyte payload on the same thread as everyone else — the reason a
 * slow provider used to make its neighbours look slow too. `signal`, the
 * caller's, stops it the same way, and rejects with its reason.
 */
export async function withBudget<T>(ms: number, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;

  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
    if (signal) {
      onAbort = () => {
        controller.abort(signal.reason);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([work(controller.signal), budget]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal!.removeEventListener('abort', onAbort);
  }
}

export async function fanOut(plan: Plan, options: FanOutOptions): Promise<FanOutResult> {
  const { query, depth, offset, timeoutMs, openAccessOnly, cache, userAgent, now, onSettled, unavailable, signal } = options;

  const skippedReports: ProviderReport[] = plan.skipped.map(s => ({
    provider: s.provider,
    status: 'skipped',
    retrieved: 0,
    latency: 0,
    skipReason: s.reason
  }));

  const settled = await Promise.all(
    plan.planned.map(async (provider): Promise<{ papers: Paper[]; report: ProviderReport }> => {
      const result = await ask(provider);
      onSettled?.(result);
      return result;
    })
  );

  return {
    papers: settled.flatMap(s => s.papers),
    reports: [...settled.map(s => s.report), ...skippedReports]
  };

  async function ask(provider: Plan['planned'][number]): Promise<{ papers: Paper[]; report: ProviderReport }> {
    const startedAt = Date.now();
    const nativeQuery = provider.translate(query, { openAccessOnly });

    /**
     * Nothing of this query the provider can express — a wildcard its API
     * refuses, an `OR` with such a wildcard in it. Every provider's `search`
     * already answers an empty translation without a request, so asking would
     * only have reported `ok` with nothing retrieved, which the coverage panel
     * prints as "0" — a claim about the source's holdings that it never made.
     * This is the same case `plan` skips for a query with nothing left to
     * search, found one step later because only `translate` knows it.
     */
    if (!nativeQuery) {
      return {
        papers: [],
        report: { provider: provider.id, status: 'skipped', retrieved: 0, latency: 0, skipReason: 'cannot express this query' }
      };
    }

    // A provider whose rate limit refused a recent request, left alone until
    // it can answer. After the check above: a query it cannot express is
    // skipped whatever its quota, and that is the truer report.
    const cooling = unavailable?.get(provider.id);
    if (cooling) {
      return {
        papers: [],
        report: { provider: provider.id, status: 'error', retrieved: 0, latency: 0, error: cooling, rateLimited: 'cooling-down' }
      };
    }

    const run = async () => {
      const work = (signal: AbortSignal) =>
        provider.search({
          query, depth, offset, timeoutMs, openAccessOnly, signal,
          ...(userAgent ? { userAgent } : {}),
          ...(now ? { now } : {})
        });

      if (!cache) return withBudget(timeoutMs, work, signal);

      // The request is the flight's, stopped only once every caller sharing
      // it has left; this caller stops waiting on its own signal.
      const { outcome } = await cache.fetch(
        {
          provider: provider.id,
          nativeQuery,
          depth,
          offset
        },
        shared => withBudget(timeoutMs, work, shared),
        signal
      );
      return outcome;
    };

    try {
      const outcome = await run();
      return {
        papers: outcome.papers,
        report: {
          provider: provider.id,
          status: 'ok',
          retrieved: outcome.papers.length,
          ...(outcome.totalHits !== undefined ? { totalHits: outcome.totalHits } : {}),
          latency: Date.now() - startedAt
        }
      };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      return {
        papers: [],
        report: {
          provider: provider.id,
          // A timeout is not an error: the provider may be fine and simply
          // slower than this request could wait for. Retrying it is
          // reasonable; retrying a 400 is not — which `refused` records.
          status: timedOut ? 'timeout' : 'error',
          retrieved: 0,
          error: error instanceof Error ? error.message : String(error),
          ...(!timedOut && refusedQuery(error) ? { refused: true } : {}),
          ...(!timedOut && statusOf(error) === 429 ? { rateLimited: 'refused' as const } : {}),
          latency: Date.now() - startedAt
        }
      };
    }
  }
}

/** What an API answers a request it will never run: malformed, or unprocessable. */
const REFUSALS = new Set([400, 422]);

/**
 * Whether a provider's failure was it refusing the query, as opposed to failing
 * to answer it.
 *
 * Read off a status the error carries — every provider's error raised for an
 * HTTP status carries it as `status`, and an axios error on its response — and
 * not guessed at from a message. An error that carries none, such as a 200
 * with a body that is not a result page, counts as a failure to answer: how
 * every failure was treated before, and the side to be wrong on, since it costs
 * a repeated fan-out where the other mistake would hold a set a retry could
 * have completed.
 */
function refusedQuery(error: unknown): boolean {
  const code = statusOf(error);
  return code !== undefined && REFUSALS.has(code);
}

/** The HTTP status a provider's error carries, as `status` or on an axios `response`. */
function statusOf(error: unknown): number | undefined {
  const { status, response } = (error ?? {}) as { status?: unknown; response?: { status?: unknown } };
  const code = typeof status === 'number' ? status : response?.status;
  return typeof code === 'number' ? code : undefined;
}

/**
 * True when every planned provider answered.
 *
 * When it is false the reported total is a lower bound, and a caller should
 * say so rather than present a partial result as complete.
 */
export function isComplete(reports: readonly ProviderReport[]): boolean {
  return reports.every(r => r.status === 'ok' || r.status === 'skipped');
}

/**
 * True when some provider did not answer, and every one that did not refused
 * the query outright.
 *
 * Such a set is incomplete — `total` is a lower bound, exactly as it is after a
 * timeout — and it is also the set every later resolution would produce, since
 * a refusal is an answer about the query and not about the provider's minute.
 * Declining to hold it bought nothing and cost a great deal: every page and
 * every repeat re-ran the fan-out, and `total` moved while a reader paged —
 * which is what every wildcard search did while OpenAlex was sent wildcards it
 * answers with a 400.
 *
 * False when nothing failed, so it is not a second spelling of `isComplete`.
 */
export function onlyRefused(reports: readonly ProviderReport[]): boolean {
  const failed = reports.filter(r => r.status === 'error' || r.status === 'timeout');
  return failed.length > 0 && failed.every(r => r.refused === true);
}
