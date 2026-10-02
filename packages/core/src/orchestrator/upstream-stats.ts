import type { AuthorityReport, ProviderReport } from '@open-access-explorer/shared';

/**
 * How each source has fared across searches, from the reports every search
 * already writes.
 *
 * Every search reports, per provider, whether it answered, timed out, failed
 * or was skipped, and how long it took — and per authority, what it was asked
 * and what that bought. None of it was kept past the response, so "is Europe
 * PMC slow today" and "is Unpaywall answering at all" had no answer short of
 * reading logs. The HTTP metrics count requests to hosts; this counts what the
 * pipeline got out of each source, which is the question an operator asks.
 */

/** How many latencies each source keeps for its percentiles. */
const SAMPLES = 256;

type Status = 'ok' | 'timeout' | 'error' | 'skipped';

type Tally = {
  statuses: Record<Status, number>;
  latencies: number[];
  lastError?: { message: string; at: string };
  asked: number;
  answered: number;
  applied: number;
};

export type SourceStats = {
  /** Times this source was part of a search, by how it ended. */
  ok: number;
  timeout: number;
  error: number;
  skipped: number;
  /** Over the last answers that were not skipped, in milliseconds. */
  latency: { p50: number; p95: number; samples: number } | null;
  lastError?: { message: string; at: string };
};

export type AuthorityStats = SourceStats & {
  /** DOIs asked about, answered with a record, and fields those answers wrote. */
  asked: number;
  answered: number;
  applied: number;
};

export type UpstreamStatsSnapshot = {
  providers: Record<string, SourceStats>;
  authorities: Record<string, AuthorityStats>;
};

const tally = (): Tally => ({
  statuses: { ok: 0, timeout: 0, error: 0, skipped: 0 },
  latencies: [],
  asked: 0,
  answered: 0,
  applied: 0
});

function percentile(sorted: readonly number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(index, 0)]!;
}

export class UpstreamStats {
  private readonly providers = new Map<string, Tally>();
  private readonly authorities = new Map<string, Tally>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A fan-out's reports. Recorded once per resolved set, not per page served from it. */
  recordProviders(reports: readonly ProviderReport[]): void {
    for (const report of reports) {
      this.count(this.providers, report.provider, report.status, report.latency, report.error);
    }
  }

  /** An enrichment's reports, from the rescue or a page. */
  recordAuthorities(reports: readonly AuthorityReport[]): void {
    for (const report of reports) {
      const entry = this.count(this.authorities, report.authority, report.status, report.latency, report.error);
      entry.asked += report.asked;
      entry.answered += report.answered;
      entry.applied += report.applied;
    }
  }

  snapshot(): UpstreamStatsSnapshot {
    const sourceStats = (entry: Tally): SourceStats => {
      const sorted = [...entry.latencies].sort((a, b) => a - b);
      return {
        ...entry.statuses,
        latency: sorted.length > 0
          ? { p50: percentile(sorted, 50), p95: percentile(sorted, 95), samples: sorted.length }
          : null,
        ...(entry.lastError ? { lastError: entry.lastError } : {})
      };
    };

    return {
      providers: Object.fromEntries([...this.providers].map(([id, entry]) => [id, sourceStats(entry)])),
      authorities: Object.fromEntries([...this.authorities].map(([id, entry]) => [id, {
        ...sourceStats(entry),
        asked: entry.asked,
        answered: entry.answered,
        applied: entry.applied
      }]))
    };
  }

  private count(into: Map<string, Tally>, id: string, status: Status, latency: number, error?: string): Tally {
    let entry = into.get(id);
    if (!entry) {
      entry = tally();
      into.set(id, entry);
    }

    entry.statuses[status] += 1;
    if (status !== 'skipped') {
      entry.latencies.push(latency);
      if (entry.latencies.length > SAMPLES) entry.latencies.shift();
    }
    if (error !== undefined && (status === 'error' || status === 'timeout')) {
      entry.lastError = { message: error, at: this.now().toISOString() };
    }
    return entry;
  }
}
