import { AdmissionError } from './errors';

/**
 * How many new result sets a process may resolve, as a token bucket refilled
 * continuously at `perMinute`.
 *
 * Everything that resolves something new spends a token: a search, a page of
 * a set no longer held, a DOI lookup (which is a search), and a count, which
 * resolves nothing but still asks every source. A page of a held set does not
 * — the engine asks admission only when it must resolve. It protects the
 * sources from bursts; a source's daily budget is a different limit, which
 * the engine handles by the source's own 429.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private readonly perMinute: number, private readonly now: () => number = Date.now) {
    this.tokens = perMinute;
    this.last = now();
  }

  /** Spends a token, or throws `AdmissionError` saying when one will be free. */
  take(): void {
    const t = this.now();
    this.tokens = Math.min(this.perMinute, this.tokens + ((t - this.last) / 60_000) * this.perMinute);
    this.last = t;
    if (this.tokens < 1) throw new AdmissionError(Math.ceil(((1 - this.tokens) * 60) / this.perMinute));
    this.tokens -= 1;
  }

  /** Returns a token spent on a call another bucket then refused. */
  giveBack(): void {
    this.tokens = Math.min(this.perMinute, this.tokens + 1);
  }
}

/** A `TokenBucket` as an `admit`: one per process on stdio. */
export function tokenBucket(perMinute: number, now: () => number = Date.now) {
  const bucket = new TokenBucket(perMinute, now);
  return async function admit(): Promise<void> {
    bucket.take();
  };
}
