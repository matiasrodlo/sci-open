import * as z from 'zod';
import type { ProviderReport } from '@sci-open/shared';
import type { CountOutcome } from '@sci-open/core';
import { pageSchema } from './present-page';
import { coverageOf, coverageSchema, coverageSentence } from '../shape/coverage';
import type { ToolOutcome } from '../framework/define-tool';

export const countsSchema = z.object({
  query: z.string(),
  per_source: z.array(z.object({ source: z.string(), status: z.string(), count: z.number().int().optional() })),
  largest: z.object({ source: z.string(), count: z.number().int() }).nullable(),
  coverage: coverageSchema
});

/** A page, or counts: one schema with the parts each mode fills. */
export const searchOutputSchema = pageSchema.partial().extend({ counts: countsSchema.optional() });

/**
 * `count_only`, shaped to be used as the tuning loop it is: counts per source,
 * the largest of them, the coverage sentence, and what to do next — and no
 * handle, since nothing was resolved to page through. No fence: everything in
 * the text is a number, a source id or the caller's own query.
 */
export function presentCounts(outcome: CountOutcome, q: string): ToolOutcome<z.infer<typeof searchOutputSchema>> {
  const counted = outcome.reports
    .filter((r): r is ProviderReport & { totalHits: number } => r.status === 'ok' && r.totalHits !== undefined)
    .sort((a, b) => b.totalHits - a.totalHits);
  const top = counted[0];
  const coverage = coverageOf({ complete: outcome.complete, bounded: false, providers: outcome.reports });
  const counts = {
    query: q,
    per_source: outcome.reports.map(r => ({
      source: r.provider,
      status: r.status,
      ...(r.status === 'ok' && r.totalHits !== undefined ? { count: r.totalHits } : {})
    })),
    largest: top ? { source: top.provider, count: top.totalHits } : null,
    coverage
  };

  const text = [
    `# Match counts for \`${q}\` — no results read`,
    '',
    `**Coverage:** ${coverageSentence(coverage)}`,
    '',
    ...(counted.length
      ? ['| Source | Matches |', '|---|---|', ...counted.map(r => `| ${r.provider} | ${r.totalHits.toLocaleString('en')} |`), '']
      : []),
    top ? `Largest: ${top.provider}, ${top.totalHits.toLocaleString('en')}.` : 'No source reported a count.',
    'Each source counts the query as it could express it, before duplicates and the open-access check. Compare query variants with these; do not report them as the number of results.',
    '**Next:** search_papers with this query and without count_only, to read results.'
  ].join('\n');

  return {
    structured: { counts },
    text,
    provenance: { sources: outcome.reports, complete: outcome.complete, negativeResult: counted.length > 0 && counted.every(r => r.totalHits === 0) }
  };
}
