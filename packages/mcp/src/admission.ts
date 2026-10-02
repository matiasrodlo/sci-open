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
export function tokenBucket(perMinute: number, now: () => number = Date.now) {
  let tokens = perMinute;
  let last = now();
  return async function admit(): Promise<void> {
    const t = now();
    tokens = Math.min(perMinute, tokens + ((t - last) / 60_000) * perMinute);
    last = t;
    if (tokens < 1) throw new AdmissionError(Math.ceil(((1 - tokens) * 60) / perMinute));
    tokens -= 1;
  };
}
