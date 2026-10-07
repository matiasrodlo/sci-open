import * as z from 'zod';
import type { SearchResponse } from '@sci-open/shared';
import { encodeSearchHandle, type SearchSpec } from '../handles';
import { shapePaper, paperSchema, listedTitle, placeIn, retractionWarning, type ShapedPaper } from '../shape/paper';
import { fitWholeItems } from '../shape/budget';
import { coverageOf, coverageSchema, coverageSentence, totalIsLowerBound } from '../shape/coverage';
import { fenceUntrusted } from '../safety/untrusted';
import { sanitizeText } from '../safety/sanitize';
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

/** The facets as the output gives them: the top values of each. */
const TOP_FACET_VALUES = 8;

/** Authors a full entry lists before it counts the rest. */
const LISTED_AUTHORS = 10;

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

/**
 * A result as `detail: "full"` shows it in the text: what screening reads —
 * the abstract whole, the venue, the DOI, the citation count — so a model
 * whose client shows it only the text need not call get_paper for each.
 */
function fullEntry(p: ShapedPaper, n: number): string {
  const authors = `${p.authors.slice(0, LISTED_AUTHORS).join(', ')}${p.authors.length > LISTED_AUTHORS ? ', …' : ''}`;
  const facts = [
    `\`${p.id}\``,
    p.doi ? `doi:${p.doi}` : '',
    `access ${p.access}${p.full_text?.verified ? ' (full text verified)' : ''}`,
    p.citations !== undefined ? `cited ${p.citations.toLocaleString('en')} times` : '',
    `found in ${p.found_in.length} source${p.found_in.length === 1 ? '' : 's'}`
  ].filter(Boolean).join(' · ');
  return [
    `### ${n}. ${oneLine(listedTitle(p))} (${p.year ?? 'n.d.'})`,
    [authors, [p.venue ? oneLine(p.venue) : '', placeIn(p)].filter(Boolean).join(' ')].filter(Boolean).join(' · '),
    facts,
    ...(p.abstract ? ['', p.abstract] : [])
  ].join('\n');
}

/** One page of a search, as both search tools return it. */
export function presentPage(
  r: SearchResponse,
  spec: SearchSpec,
  opts: { detail: 'concise' | 'full'; includeFacets: boolean; structuredBudget: number; rerun?: boolean }
): ToolOutcome<PageOutput> {
  const handle = encodeSearchHandle(spec);
  const { kept, omitted } = fitWholeItems(r.papers.map(p => shapePaper(p, opts.detail)), opts.structuredBudget);
  const more = r.page * r.pageSize < r.total;
  const coverage = coverageOf(r, spec.sort);
  // A source that failed, a rescue cut short and a source read only to the
  // depth all leave the total short of what matches.
  const lowerBound = totalIsLowerBound(coverage);
  const facets = opts.includeFacets
    ? Object.fromEntries(Object.entries(r.facets).map(([k, v]) => [k, v.slice(0, TOP_FACET_VALUES).map(b => ({ value: b.value, count: b.count }))]))
    : undefined;

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
    ...(facets ? { facets } : {}),
    results: kept,
    ...(omitted ? { omitted_for_size: omitted } : {}),
    ...(opts.rerun ? { rerun: true } : {})
  };

  const cell = (text: string) => text.replace(/\|/g, '/').replace(/\n/g, ' ');
  const lines = kept.map((p, i) =>
    `| ${(r.page - 1) * r.pageSize + i + 1} | ${cell(listedTitle(p))} | ${cell(p.authors[0] ?? '—')} | ${p.year ?? '—'} | ${p.access}${p.full_text?.verified ? ' ✓' : ''} | ${p.found_in.length} | \`${p.id}\` |`
  );
  const retracted = kept.flatMap((p, i) => (p.retracted ? [`#${(r.page - 1) * r.pageSize + i + 1}`] : []));
  // Venues, publishers and topics are the sources' text as much as titles are.
  const facetLines = Object.entries(facets ?? {}).filter(([, values]) => values.length).map(([name, values]) =>
    `${name}: ${values.map(b => `${typeof b.value === 'string' ? oneLine(sanitizeText(b.value)) : b.value} (${b.count.toLocaleString('en')})`).join(', ')}`);
  const text = [
    retractionWarning(retracted.length === 1 ? [`Result ${retracted[0]}`] : retracted.length ? [`Results ${retracted.join(', ')}`] : []),
    `# ${r.total.toLocaleString('en')}${lowerBound ? '+' : ''} results${spec.q ? ` for \`${spec.q}\`` : spec.doi ? ` for DOI ${spec.doi}` : ''} — page ${r.page}`,
    '',
    `**Coverage:** ${coverageSentence(coverage)}`,
    more
      ? `**Next:** get_search_page(handle="${handle}", page=${r.page + 1})`
      : coverage.truncated.length
        // Not the end of what matches: the end of the top that was read.
        ? '**End of what was read.** The sources hold more matches than a search reads: to reach them, narrow the query or split it by PY= ranges until search_papers with count_only=true shows every source within what a search reads.'
        : '**End of results.**',
    omitted ? `**Note:** the last ${omitted} result(s) of this page were omitted to fit the response limit; run search_papers again with a smaller page_size.` : '',
    opts.rerun ? '**Note:** the search was run again for this page (the held set had expired or was incomplete), so it may overlap or skip results from earlier pages.' : '',
    ...(facetLines.length ? ['', '**Facets**, the top values of each:', fenceUntrusted('facet values', facetLines.join('\n'))] : []),
    '',
    !kept.length
      ? 'No results on this page.'
      : opts.detail === 'full'
        ? fenceUntrusted('search results', kept.map((p, i) => fullEntry(p, (r.page - 1) * r.pageSize + i + 1)).join('\n\n'))
        : fenceUntrusted('search results table', [
            '| # | Title | First author | Year | Access | Sources | ID |',
            '|---|---|---|---|---|---|---|',
            ...lines
          ].join('\n'))
  ].filter(l => l !== '').join('\n');

  return {
    structured,
    text,
    provenance: { sources: r.providers, complete: !lowerBound, negativeResult: r.total === 0 }
  };
}
