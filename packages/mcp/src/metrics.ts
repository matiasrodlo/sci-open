import type { EngineLogger } from '@sci-open/core';

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
};

type ToolTotals = { calls: number; errors: Record<string, number>; totalMs: number; maxMs: number; textChars: number; newSearches: number };

export type Metrics = {
  record(call: ToolCall): void;
  snapshot(): { since: string; tools: Record<string, ToolTotals> };
  stop(): void;
};

/**
 * Per-tool totals in memory. On stdio a summary line goes to the log every ten
 * minutes, then a fresh window starts, so the log reads as a series rather
 * than one total; over HTTP the host can serve `snapshot()` as well.
 */
export function createMetrics(logger: EngineLogger, options: { summaryEveryMs?: number } = {}): Metrics {
  let since = new Date();
  let tools: Record<string, ToolTotals> = {};

  const metrics: Metrics = {
    record(call) {
      const t = (tools[call.tool] ??= { calls: 0, errors: {}, totalMs: 0, maxMs: 0, textChars: 0, newSearches: 0 });
      t.calls++;
      t.totalMs += call.ms;
      t.maxMs = Math.max(t.maxMs, call.ms);
      t.textChars += call.textChars ?? 0;
      t.newSearches += call.newSearches;
      if (!call.ok) t.errors[call.code ?? 'internal'] = (t.errors[call.code ?? 'internal'] ?? 0) + 1;
    },
    snapshot: () => ({ since: since.toISOString(), tools: structuredClone(tools) }),
    stop: () => clearInterval(timer)
  };

  const timer = setInterval(() => {
    if (Object.keys(tools).length) logger.info({ metrics: metrics.snapshot() }, 'tool calls');
    since = new Date();
    tools = {};
  }, options.summaryEveryMs ?? 600_000);
  timer.unref(); // never what keeps the process alive

  return metrics;
}

/** For tests and for the CLI, which have nothing to report to. */
export const nullMetrics: Metrics = {
  record: () => {},
  snapshot: () => ({ since: new Date(0).toISOString(), tools: {} }),
  stop: () => {}
};
