import type { Paper, ProviderReport, Query } from '@open-access-explorer/shared';
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
};

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
 * slow provider used to make its neighbours look slow too.
 */
async function withBudget<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const budget = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });

  try {
    return await Promise.race([work(controller.signal), budget]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function fanOut(plan: Plan, options: FanOutOptions): Promise<FanOutResult> {
  const { query, depth, offset, timeoutMs, openAccessOnly, cache, userAgent, now } = options;

  const skippedReports: ProviderReport[] = plan.skipped.map(s => ({
    provider: s.provider,
    status: 'skipped',
    retrieved: 0,
    latency: 0,
    skipReason: s.reason
  }));

  const settled = await Promise.all(
    plan.planned.map(async (provider): Promise<{ papers: Paper[]; report: ProviderReport }> => {
      const startedAt = Date.now();
      const nativeQuery = provider.translate(query, { openAccessOnly });

      const run = async () => {
        const work = (signal: AbortSignal) =>
          provider.search({
            query, depth, offset, timeoutMs, openAccessOnly, signal,
            ...(userAgent ? { userAgent } : {}),
            ...(now ? { now } : {})
          });

        if (!cache) return withBudget(timeoutMs, work);

        const { outcome } = await cache.fetch(
          {
            provider: provider.id,
            nativeQuery,
            depth,
            offset,
            normalizerVersion: provider.normalizerVersion
          },
          () => withBudget(timeoutMs, work)
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
            // reasonable; retrying a 400 is not.
            status: timedOut ? 'timeout' : 'error',
            retrieved: 0,
            error: error instanceof Error ? error.message : String(error),
            latency: Date.now() - startedAt
          }
        };
      }
    })
  );

  return {
    papers: settled.flatMap(s => s.papers),
    reports: [...settled.map(s => s.report), ...skippedReports]
  };
}

/**
 * True when every planned provider answered.
 *
 * When it is false the reported total is a lower bound, and the UI should say
 * so rather than presenting a partial result as complete.
 */
export function isComplete(reports: readonly ProviderReport[]): boolean {
  return reports.every(r => r.status === 'ok' || r.status === 'skipped');
}
