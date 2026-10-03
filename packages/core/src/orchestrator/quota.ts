import type { ProviderId, ProviderReport } from '@sci-open/shared';

/** Long enough not to spend a request per search on a known refusal; short
 * enough that a burst limit, mistaken for a spent budget, costs minutes. */
const DEFAULT_COOL_DOWN_MS = 10 * 60_000;

/**
 * Which sources have refused for their rate limit, and until when they are
 * left out.
 *
 * A 429 starts a cool-down. Until it ends, the fan-out does not ask that source
 * and reports it failed and `cooling-down`. The first search after the
 * cool-down asks again — a probe, not a schedule: a 429 does not say whether it
 * was a burst limit or the day's budget, and when OpenAlex resets a budget is
 * not something this service knows. An answer ends a cool-down early.
 *
 * There is no counter of our own searches: the budget is the source's, priced
 * in its own units, and its 429 is the authoritative signal that it is spent.
 */
export class QuotaState {
  private readonly until = new Map<ProviderId, number>();
  private readonly coolDownMs: number;
  private readonly now: () => number;

  constructor(options: { coolDownMs?: number; now?: () => number } = {}) {
    this.coolDownMs = options.coolDownMs ?? DEFAULT_COOL_DOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /** The providers not to ask now, each with the reason its report gives. */
  unavailable(): ReadonlyMap<ProviderId, string> {
    const t = this.now();
    const out = new Map<ProviderId, string>();
    for (const [provider, until] of this.until) {
      if (until <= t) this.until.delete(provider);
      else out.set(provider, `rate-limited; not asked again before ${new Date(until).toISOString().slice(11, 16)} UTC`);
    }
    return out;
  }

  /** A refusal seen outside a fan-out — a batch lookup by DOI — starts the
   * same cool-down a refused search would. */
  refuse(provider: ProviderId): void {
    this.until.set(provider, this.now() + this.coolDownMs);
  }

  /** What a fan-out learned. Only a refusal starts a cool-down; a report of one
   * already running does not extend it. */
  note(reports: readonly ProviderReport[]): void {
    for (const report of reports) {
      if (report.rateLimited === 'refused') this.until.set(report.provider, this.now() + this.coolDownMs);
      else if (report.status === 'ok') this.until.delete(report.provider);
    }
  }
}
