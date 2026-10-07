import { upstreamUsage, usageSince, type EngineLogger, type UpstreamUsage } from '@sci-open/core';

/** What `registerTools` records about one call. Never its arguments. */
export type ToolCall = {
  tool: string;
  ok: boolean;
  /** The ToolError code, when `ok` is false. */
  code?: string;
  ms: number;
  textChars?: number;
  /** Result sets this call resolved, rather than found held. */
  newSearches: number;
  /** What it asked of the sources (`measureUpstream`). */
  upstream?: UpstreamUsage;
};

type ToolTotals = {
  calls: number; errors: Record<string, number>; totalMs: number; maxMs: number; textChars: number; newSearches: number;
  /** Requests its calls sent the sources. */
  upstreamRequests: number;
};

export type Metrics = {
  record(call: ToolCall): void;
  /** `upstream` is everything the process asked of the sources in the window,
   * by source, whichever call asked it. */
  snapshot(): { since: string; tools: Record<string, ToolTotals>; upstream: UpstreamUsage };
  stop(): void;
};

const NOTHING: UpstreamUsage = { requests: 0, sources: {} };

/**
 * Per-tool totals in memory. On stdio a summary line goes to the log every ten
 * minutes, then a fresh window starts, so the log reads as a series rather
 * than one total; over HTTP the host can serve `snapshot()` as well.
 */
export function createMetrics(
  logger: EngineLogger,
  options: { summaryEveryMs?: number; upstream?: () => UpstreamUsage } = {}
): Metrics {
  const upstream = options.upstream ?? upstreamUsage;
  let since = new Date();
  let base = upstream();
  let tools: Record<string, ToolTotals> = {};

  const metrics: Metrics = {
    record(call) {
      const t = (tools[call.tool] ??= { calls: 0, errors: {}, totalMs: 0, maxMs: 0, textChars: 0, newSearches: 0, upstreamRequests: 0 });
      t.calls++;
      t.totalMs += call.ms;
      t.maxMs = Math.max(t.maxMs, call.ms);
      t.textChars += call.textChars ?? 0;
      t.newSearches += call.newSearches;
      t.upstreamRequests += call.upstream?.requests ?? 0;
      if (!call.ok) t.errors[call.code ?? 'internal'] = (t.errors[call.code ?? 'internal'] ?? 0) + 1;
    },
    snapshot: () => ({ since: since.toISOString(), tools: structuredClone(tools), upstream: usageSince(upstream(), base) }),
    stop: () => clearInterval(timer)
  };

  const timer = setInterval(() => {
    if (Object.keys(tools).length) logger.info({ metrics: metrics.snapshot() }, 'tool calls');
    since = new Date();
    base = upstream();
    tools = {};
  }, options.summaryEveryMs ?? 600_000);
  timer.unref(); // never what keeps the process alive

  return metrics;
}

/** For tests and for the CLI, which have nothing to report to. */
export const nullMetrics: Metrics = {
  record: () => {},
  snapshot: () => ({ since: new Date(0).toISOString(), tools: {}, upstream: NOTHING }),
  stop: () => {}
};
