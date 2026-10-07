import * as z from 'zod';
import { parseQuery } from '@sci-open/core';
import { defineTool } from '../framework/define-tool';
import { presentPage } from './present-page';
import { presentCounts, searchOutputSchema } from './present-counts';
import { searchProgress } from '../shape/progress';
import { ToolError } from '../errors';
import { hasVisibleText } from '../safety/sanitize';
import { PUBLICATION_TYPES, SORTS, SOURCES, engineCall, type SearchSpec } from '../handles';
import { doiIn } from './resolve-paper';

export const searchPapers = defineTool({
  name: 'search_papers',
  title: 'Search papers',
  toolset: 'core',
  description:
    'Search open-access scientific literature across ten sources at once, or look up one DOI. ' +
    'Use the Web of Science query grammar described in the server instructions. ' +
    'Returns the first page, a handle for get_search_page, and coverage: which sources answered, failed or were skipped. ' +
    'Set count_only=true to tune a query: each source\'s own match count, with no results read. Use get_paper for a full record.',
  input: z.object({
    query: z.string().max(2000).optional().describe('Query in the Web of Science grammar, e.g. TS=(crispr OR cas9) AND PY=2020-2024. Untagged words search title, abstract and keywords.'),
    doi: z.string().max(300).optional().describe('Look up one DOI instead of searching. Bare (10.1234/x) or as a https://doi.org/ URL.'),
    year_from: z.number().int().min(1600).max(2100).optional(),
    year_to: z.number().int().min(1600).max(2100).optional(),
    sources: z.array(z.enum(SOURCES)).max(SOURCES.length).optional().describe('Ask only these sources; coverage then reports only them. Omit to ask every source able to answer the query.'),
    publication_type: z.array(z.enum(PUBLICATION_TYPES)).optional(),
    open_access_only: z.boolean().default(true).describe('Keep only papers with a legal open copy. Set false to include closed papers (metadata only).'),
    sort: z.enum(SORTS).default('relevance').describe('relevance, date (newest first), date_asc, citations (most cited first) or citations_asc. A source that can sort reads in that order; one that cannot reads by relevance, and coverage says which did which.'),
    page_size: z.number().int().min(1).max(25).default(10),
    detail: z.enum(['concise', 'full']).default('concise').describe('concise: a compact table. full: every field, each abstract whole in the text, and which source supplied each field — for screening.'),
    include_facets: z.boolean().default(false).describe('Add the top values per facet (year, venue, publisher, topics, source, access), counted across everything each source holds. It costs the sources dozens of extra requests: set it only when the distribution itself is wanted.'),
    count_only: z.boolean().default(false).describe('Return only each source\'s own count of matches, reading no results: one request per source, no handle. Use it to compare query variants; then search without it.')
  }),
  output: searchOutputSchema,
  async run(args, deps) {
    const query = args.query?.trim();
    const doiText = args.doi?.trim();
    if (Boolean(query) === Boolean(doiText)) {
      throw new ToolError('invalid_input', 'Pass exactly one of query or doi.', 'Use query to search and doi to look up one paper.');
    }
    // Text that is not a DOI would reach the sources as keywords, and its
    // results would be listed as that DOI's.
    const doi = doiText ? doiIn(doiText) : undefined;
    if (doiText && !doi) {
      throw new ToolError('invalid_input', 'doi is not a DOI.', 'A DOI looks like 10.1234/abc, doi:10.1234/abc or https://doi.org/10.1234/abc. Use query to search for words.');
    }
    if (query && !hasVisibleText(query)) throw new ToolError('invalid_input', 'The query has no visible characters.');
    // Parsed here as well as in the engine: a syntax error is answered before
    // it spends an admission, and the same way against any Engine — the
    // fixture one included. Throws QueryParseError, which maps to invalid_input.
    if (query) parseQuery(query);
    if (args.year_from !== undefined && args.year_to !== undefined && args.year_from > args.year_to) {
      throw new ToolError('invalid_input', 'year_from is after year_to.');
    }

    const spec: SearchSpec = {
      ...(query ? { q: query } : {}),
      ...(doi ? { doi } : {}),
      filters: {
        openAccessOnly: args.open_access_only,
        ...(args.year_from !== undefined ? { yearFrom: args.year_from } : {}),
        ...(args.year_to !== undefined ? { yearTo: args.year_to } : {}),
        ...(args.sources?.length ? { source: args.sources } : {}),
        ...(args.publication_type?.length ? { publicationType: args.publication_type } : {})
      },
      sort: args.sort,
      pageSize: args.page_size,
      // Counted across the sources only when they are to be shown: dozens of
      // requests a search, for numbers most calls never read.
      ...(args.include_facets ? { facets: true as const } : {})
    };

    const { params, options } = engineCall(spec);
    const engineOptions = { admit: deps.admit, onProgress: searchProgress(deps), signal: deps.signal, ...options };

    if (args.count_only) {
      if (doi) throw new ToolError('invalid_input', 'count_only counts the matches of a query; a DOI names one paper.', 'Drop count_only to look the DOI up.');
      return presentCounts(await deps.engine.count({ ...params, page: 1 }, engineOptions), query!, deps.config.searchDepth);
    }

    const { response } = await deps.engine.search({ ...params, page: 1 }, engineOptions);
    return presentPage(response, spec, {
      detail: args.detail,
      includeFacets: args.include_facets,
      structuredBudget: deps.config.structuredBudgetChars
    });
  }
});
