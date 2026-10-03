import * as z from 'zod';
import type { SearchResponseV2 } from '@sci-open/shared';
import { encodeSearchHandle, type SearchSpec } from '../handles';
import { shapePaper, paperSchema, listedTitle, retractionWarning } from '../shape/paper';
import { fitWholeItems } from '../shape/budget';
import { coverageOf, coverageSchema, coverageSentence } from '../shape/coverage';
import { fenceUntrusted } from '../safety/untrusted';
import type { ToolOutcome } from '../framework/define-tool';

export const pageSchema = z.object({
  handle: z.string(),
  query: z.object({ q: z.string().optional(), doi: z.string().optional(), sort: z.string().optional() }),
  total: z.number().int(),
  total_is_lower_bound: z.boolean(),
  page: z.number().int(),
  page_size: z.number().int(),
  has_more: z.boolean(),
  next: z.object({ tool: z.literal('get_search_page'), handle: z.string(), page: z.number().int() }).nullable(),
  coverage: coverageSchema,
  facets: z.record(z.string(), z.array(z.object({ value: z.union([z.string(), z.number()]), count: z.number().int() }))).optional(),
  results: z.array(paperSchema),
  omitted_for_size: z.number().int().optional(),
  /** This page came from a fresh run of the search, not the held set. */
  rerun: z.boolean().optional()
});
export type PageOutput = z.infer<typeof pageSchema>;

/** One page of a search, as both search tools return it. */
export function presentPage(
  r: SearchResponseV2,
  spec: SearchSpec,
  opts: { detail: 'concise' | 'full'; includeFacets: boolean; structuredBudget: number; rerun?: boolean }
): ToolOutcome<PageOutput> {
  const handle = encodeSearchHandle(spec);
  const { kept, omitted } = fitWholeItems(r.papers.map(p => shapePaper(p, opts.detail)), opts.structuredBudget);
  const more = r.page * r.pageSize < r.total;
  const coverage = coverageOf(r);
  // A source that failed and a rescue cut short both leave the total short.
  const lowerBound = !r.complete || r.bounded;

  const structured: PageOutput = {
    handle,
    query: { ...(spec.q ? { q: spec.q } : {}), ...(spec.doi ? { doi: spec.doi } : {}), sort: spec.sort },
    total: r.total,
    total_is_lower_bound: lowerBound,
    page: r.page,
    page_size: r.pageSize,
    has_more: more,
    next: more ? { tool: 'get_search_page', handle, page: r.page + 1 } : null,
    coverage,
    ...(opts.includeFacets
      ? { facets: Object.fromEntries(Object.entries(r.facets).map(([k, v]) => [k, v.slice(0, 8).map(b => ({ value: b.value, count: b.count }))])) }
      : {}),
    results: kept,
    ...(omitted ? { omitted_for_size: omitted } : {}),
    ...(opts.rerun ? { rerun: true } : {})
  };

  const cell = (text: string) => text.replace(/\|/g, '/').replace(/\n/g, ' ');
  const lines = kept.map((p, i) =>
    `| ${(r.page - 1) * r.pageSize + i + 1} | ${cell(listedTitle(p))} | ${cell(p.authors[0] ?? '—')} | ${p.year ?? '—'} | ${p.access}${p.full_text?.verified ? ' ✓' : ''} | ${p.found_in.length} | \`${p.id}\` |`
  );
  const retracted = kept.flatMap((p, i) => (p.retracted ? [`#${(r.page - 1) * r.pageSize + i + 1}`] : []));
  const text = [
    retractionWarning(retracted.length === 1 ? [`Result ${retracted[0]}`] : retracted.length ? [`Results ${retracted.join(', ')}`] : []),
    `# ${r.total.toLocaleString('en')}${lowerBound ? '+' : ''} results${spec.q ? ` for \`${spec.q}\`` : spec.doi ? ` for DOI ${spec.doi}` : ''} — page ${r.page}`,
    '',
    `**Coverage:** ${coverageSentence(coverage)}`,
    more ? `**Next:** get_search_page(handle="${handle}", page=${r.page + 1})` : '**End of results.**',
    omitted ? `**Note:** the last ${omitted} result(s) of this page were omitted to fit the response limit; run search_papers again with a smaller page_size.` : '',
    opts.rerun ? '**Note:** the search was run again for this page (the held set had expired or was incomplete), so it may overlap or skip results from earlier pages.' : '',
    '',
    kept.length
      ? fenceUntrusted('search results table', [
          '| # | Title | First author | Year | Access | Sources | ID |',
          '|---|---|---|---|---|---|---|',
          ...lines
        ].join('\n'))
      : 'No results on this page.'
  ].filter(l => l !== '').join('\n');

  return {
    structured,
    text,
    provenance: { sources: r.providers, complete: !lowerBound, negativeResult: r.total === 0 }
  };
}
