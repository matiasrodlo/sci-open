import * as z from 'zod';
import type { SearchResponse } from '@sci-open/shared';

export const coverageSchema = z.object({
  complete: z.boolean(),
  bounded: z.boolean(),
  answered: z.array(z.string()),
  failed: z.array(z.object({ source: z.string(), status: z.enum(['timeout', 'error']), rate_limited: z.boolean().optional() })),
  skipped: z.array(z.object({ source: z.string(), reason: z.string() })),
  /** Sources that matched more than a search reads from each: the top `read`
   * of their `matches`, so the total counts what was read, not every match. */
  truncated: z.array(z.object({ source: z.string(), read: z.number().int(), matches: z.number().int() })),
  /** For a sort other than relevance: the sources that read in that order,
   * and those that could only read by relevance, whose part is sorted among
   * their most relevant matches. */
  order: z.object({ sort: z.string(), sorted_by_source: z.array(z.string()), read_by_relevance: z.array(z.string()) }).optional(),
  /** `query` is what the source was sent, in its own syntax: the search as run there. */
  per_source: z.array(z.object({ source: z.string(), status: z.string(), retrieved: z.number().int(), total_hits: z.number().int().optional(), query: z.string().optional() }))
});
export type Coverage = z.infer<typeof coverageSchema>;

/** What a search's sources did: which answered, failed or were skipped, and why. A
 * search response, or a count's reports, which have no rescue to bound. */
export function coverageOf(r: Pick<SearchResponse, 'complete' | 'bounded' | 'providers'>, sort?: string): Coverage {
  const answered = r.providers.filter(p => p.status === 'ok');
  return {
    complete: r.complete,
    bounded: r.bounded,
    answered: r.providers.filter(p => p.status === 'ok').map(p => p.provider),
    failed: r.providers
      .filter((p): p is typeof p & { status: 'timeout' | 'error' } => p.status === 'timeout' || p.status === 'error')
      .map(p => ({ source: p.provider, status: p.status, ...(p.rateLimited ? { rate_limited: true } : {}) })),
    skipped: r.providers.filter(p => p.status === 'skipped').map(p => ({ source: p.provider, reason: p.skipReason ?? 'not asked' })),
    truncated: r.providers
      .filter((p): p is typeof p & { totalHits: number } => p.status === 'ok' && p.truncated === true && p.totalHits !== undefined)
      .sort((a, b) => b.totalHits - a.totalHits)
      .map(p => ({ source: p.provider, read: p.retrieved, matches: p.totalHits })),
    ...(sort && sort !== 'relevance'
      ? {
          order: {
            sort,
            sorted_by_source: answered.filter(p => p.sorted === sort).map(p => p.provider),
            read_by_relevance: answered.filter(p => p.sorted !== sort).map(p => p.provider)
          }
        }
      : {}),
    per_source: r.providers.map(p => ({
      source: p.provider,
      status: p.status,
      retrieved: p.retrieved,
      ...(p.totalHits !== undefined ? { total_hits: p.totalHits } : {}),
      ...(p.query ? { query: p.query } : {})
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
  if (c.truncated.length) parts.push(truncatedClause(c.truncated));
  if (c.order) parts.push(orderClause(c.order));
  return `${parts.join('; ')}.`;
}

const ORDERS: Record<string, string> = {
  date: 'newest first', date_asc: 'oldest first', citations: 'most cited first', citations_asc: 'least cited first'
};

/** Which sources read in the order asked, and what the rest contributed. */
function orderClause(order: NonNullable<Coverage['order']>): string {
  const name = ORDERS[order.sort] ?? order.sort;
  const sorted = order.sorted_by_source.length
    ? `${order.sorted_by_source.join(', ')} read ${name}`
    : `no source could read ${name}`;
  return order.read_by_relevance.length
    ? `${sorted}; ${order.read_by_relevance.join(', ')} can only read by relevance, so their part is sorted among their most relevant matches`
    : sorted;
}

/** The sources a search read only the top of, and what that makes the total. */
function truncatedClause(truncated: Coverage['truncated']): string {
  const listed = truncated.map(t => `${t.source} ${t.read.toLocaleString('en')} of ${t.matches.toLocaleString('en')}`).join(', ');
  return `some sources match more than a search reads, and only the top of their answers was read (${listed}), ` +
    'so the total counts what was read, not every match';
}

/** Whether a page's total is a floor: a source failed, the access check was
 * cut short, or a source matched more than was read from it. */
export function totalIsLowerBound(c: Coverage): boolean {
  return !c.complete || c.bounded || c.truncated.length > 0;
}
