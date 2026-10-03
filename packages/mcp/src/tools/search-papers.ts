import * as z from 'zod';
import { parseQuery } from '@sci-open/core';
import { defineTool } from '../framework/define-tool';
import { presentPage } from './present-page';
import { presentCounts, searchOutputSchema } from './present-counts';
import { searchProgress } from '../shape/progress';
import { ToolError } from '../errors';
import { hasVisibleText } from '../safety/sanitize';
import { PUBLICATION_TYPES, SORTS, SOURCES, type SearchSpec } from '../handles';

const DOI_URL = /^https?:\/\/(dx\.)?doi\.org\//i;

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
    sort: z.enum(SORTS).default('relevance'),
    page_size: z.number().int().min(1).max(25).default(10),
    detail: z.enum(['concise', 'full']).default('concise').describe('concise: compact records. full: every field with per-field sources.'),
    include_facets: z.boolean().default(false).describe('Add the top values per facet (year, venue, publisher, topics, source, access).'),
    count_only: z.boolean().default(false).describe('Return only each source\'s own count of matches, reading no results: one request per source, no handle. Use it to compare query variants; then search without it.')
  }),
  output: searchOutputSchema,
  async run(args, deps) {
    const query = args.query?.trim();
    const doi = args.doi?.trim().replace(DOI_URL, '');
    if (Boolean(query) === Boolean(doi)) {
      throw new ToolError('invalid_input', 'Pass exactly one of query or doi.', 'Use query to search and doi to look up one paper.');
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
      pageSize: args.page_size
    };

    // `sources` narrows the fan-out itself, so it saves upstream requests as
    // well as results. It stays in the spec too, because the handle records it.
    const engineOptions = {
      admit: deps.admit,
      onProgress: searchProgress(deps),
      ...(spec.filters.source ? { sources: spec.filters.source } : {})
    };

    if (args.count_only) {
      if (doi) throw new ToolError('invalid_input', 'count_only counts the matches of a query; a DOI names one paper.', 'Drop count_only to look the DOI up.');
      return presentCounts(await deps.engine.count({ ...spec, page: 1 }, engineOptions), query!);
    }

    const { response } = await deps.engine.search({ ...spec, page: 1 }, engineOptions);
    return presentPage(response, spec, {
      detail: args.detail,
      includeFacets: args.include_facets,
      structuredBudget: deps.config.structuredBudgetChars
    });
  }
});
