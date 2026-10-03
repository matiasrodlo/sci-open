import * as z from 'zod';
import type { SearchResponseV2 } from '@sci-open/shared';

export const coverageSchema = z.object({
  complete: z.boolean(),
  bounded: z.boolean(),
  answered: z.array(z.string()),
  failed: z.array(z.object({ source: z.string(), status: z.enum(['timeout', 'error']), rate_limited: z.boolean().optional() })),
  skipped: z.array(z.object({ source: z.string(), reason: z.string() })),
  per_source: z.array(z.object({ source: z.string(), status: z.string(), retrieved: z.number().int(), total_hits: z.number().int().optional() }))
});
export type Coverage = z.infer<typeof coverageSchema>;

/** What a search's sources did: which answered, failed or were skipped, and why. A
 * search response, or a count's reports, which have no rescue to bound. */
export function coverageOf(r: Pick<SearchResponseV2, 'complete' | 'bounded' | 'providers'>): Coverage {
  return {
    complete: r.complete,
    bounded: r.bounded,
    answered: r.providers.filter(p => p.status === 'ok').map(p => p.provider),
    failed: r.providers
      .filter((p): p is typeof p & { status: 'timeout' | 'error' } => p.status === 'timeout' || p.status === 'error')
      .map(p => ({ source: p.provider, status: p.status, ...(p.rateLimited ? { rate_limited: true } : {}) })),
    skipped: r.providers.filter(p => p.status === 'skipped').map(p => ({ source: p.provider, reason: p.skipReason ?? 'not asked' })),
    per_source: r.providers.map(p => ({
      source: p.provider,
      status: p.status,
      retrieved: p.retrieved,
      ...(p.totalHits !== undefined ? { total_hits: p.totalHits } : {})
    }))
  };
}

/** One sentence the model can repeat to the user verbatim. */
export function coverageSentence(c: Coverage): string {
  const asked = c.per_source.length - c.skipped.length;
  const parts = [`${c.answered.length} of ${asked} sources answered`];
  const down = c.failed.filter(f => !f.rate_limited);
  const limited = c.failed.filter(f => f.rate_limited);
  if (down.length) parts.push(`no answer from ${down.map(f => `${f.source} (${f.status})`).join(', ')} — the total is a lower bound`);
  // A spent quota is not a fault to retry at once: it says how long the gap lasts (D13).
  if (limited.length) parts.push(`${limited.map(f => `${f.source} (request quota spent)`).join(', ')} left out for a few minutes — the total is a lower bound`);
  if (c.skipped.length) parts.push(`skipped ${c.skipped.map(s => `${s.source} (${s.reason})`).join(', ')}`);
  if (c.bounded) parts.push('the access check was cut short, so a few papers may be missing');
  return `${parts.join('; ')}.`;
}
