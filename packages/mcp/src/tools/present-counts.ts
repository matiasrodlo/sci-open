import * as z from 'zod';
import type { ProviderReport } from '@sci-open/shared';
import type { CountOutcome } from '@sci-open/core';
import { pageSchema, filtersLine, readAsWords, readAsWordsSchema, wordsLine } from './present-page';
import type { SearchSpec } from '../handles';
import { coverageOf, coverageSchema, coverageSentence } from '../shape/coverage';
import type { ToolOutcome } from '../framework/define-tool';

export const countsSchema = z.object({
  query: z.string(),
  read_as_words: readAsWordsSchema.optional(),
  per_source: z.array(z.object({
    source: z.string(), status: z.string(), count: z.number().int().optional(),
    /** Whether a search would read all of this source's matches, or only its top `reads_per_source`. */
    read_in_full: z.boolean().optional()
  })),
  largest: z.object({ source: z.string(), count: z.number().int() }).nullable(),
  /** Records a search reads from each source. A source counting more is read only in part. */
  reads_per_source: z.number().int(),
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
export function presentCounts(outcome: CountOutcome, spec: SearchSpec, depth: number): ToolOutcome<z.infer<typeof searchOutputSchema>> {
  const q = spec.q ?? '';
  const counted = outcome.reports
    .filter((r): r is ProviderReport & { totalHits: number } => r.status === 'ok' && r.totalHits !== undefined)
    .sort((a, b) => b.totalHits - a.totalHits);
  const top = counted[0];
  const coverage = coverageOf({ complete: outcome.complete, bounded: false, providers: outcome.reports });
  const read = readAsWords(q);
  const counts = {
    query: q,
    ...(read ? { read_as_words: read } : {}),
    per_source: outcome.reports.map(r => ({
      source: r.provider,
      status: r.status,
      ...(r.status === 'ok' && r.totalHits !== undefined ? { count: r.totalHits, read_in_full: r.totalHits <= depth } : {})
    })),
    largest: top ? { source: top.provider, count: top.totalHits } : null,
    reads_per_source: depth,
    coverage
  };
  const over = counted.filter(r => r.totalHits > depth);
  const sent = outcome.reports.filter((r): r is ProviderReport & { query: string } => r.status === 'ok' && typeof r.query === 'string');

  const text = [
    `# Match counts for \`${q}\` — no results read`,
    filtersLine(spec),
    ...(read ? [wordsLine(q)] : []),
    `**Coverage:** ${coverageSentence(coverage)}`,
    '',
    ...(counted.length
      ? [
          '| Source | Matches | A search reads |',
          '|---|---|---|',
          ...counted.map(r => `| ${r.provider} | ${r.totalHits.toLocaleString('en')} | ${r.totalHits <= depth ? 'all' : `the top ${depth.toLocaleString('en')}`} |`),
          ''
        ]
      : []),
    top ? `Largest: ${top.provider}, ${top.totalHits.toLocaleString('en')}.` : 'No source reported a count.',
    'Each source counts the query as it could express it, before duplicates and the open-access check. Compare query variants with these; do not report them as the number of results.',
    over.length
      ? `A search reads ${depth.toLocaleString('en')} records a source, so it would read only the top of ${over.map(r => r.provider).join(', ')}. ` +
        'For an exhaustive search, narrow the query or split it by PY= ranges until every source is within that.'
      : `Every source is within the ${depth.toLocaleString('en')} records a search reads from each, so a search would read all of their matches.`,
    ...(sent.length
      ? ['', '**Sent to each source**, in its own syntax — the search as run there, for a methods section:', ...sent.map(r => `- ${r.provider}: \`${r.query}\``)]
      : []),
    '**Next:** search_papers with this query and without count_only, to read results.'
  ].join('\n');

  return {
    structured: { counts },
    text,
    provenance: { sources: outcome.reports, complete: outcome.complete, negativeResult: counted.length > 0 && counted.every(r => r.totalHits === 0) }
  };
}
