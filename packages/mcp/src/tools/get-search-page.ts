import * as z from 'zod';
import { defineTool } from '../framework/define-tool';
import { decodeSearchHandle } from '../handles';
import { pageSchema, presentPage } from './present-page';
import { searchProgress } from '../shape/progress';
import { ToolError } from '../errors';

/**
 * The handle fixes the page size, so page N names the same results on every
 * call and `next` can never point into a page of a different size. To change
 * the size, run search_papers again; while the set is held that costs the
 * sources nothing.
 */
export const getSearchPage = defineTool({
  name: 'get_search_page',
  title: 'Get search page',
  toolset: 'core',
  description:
    'Another page of a search, by the handle search_papers returned; pages are the size that search asked for. ' +
    'Pages of a recent complete search are served from memory and cost the sources nothing; otherwise the search runs again, and the result says so.',
  input: z.object({
    handle: z.string().max(4000),
    page: z.number().int().min(1).max(100),
    detail: z.enum(['concise', 'full']).default('concise')
  }),
  output: pageSchema,
  async run(args, deps) {
    const spec = decodeSearchHandle(args.handle);
    const { response, fromCache } = await deps.engine.search(
      { ...spec, page: args.page },
      // Progress matters here only when the set is no longer held and runs again.
      { admit: deps.admit, onProgress: searchProgress(deps), ...(spec.filters.source ? { sources: spec.filters.source } : {}) }
    );
    if (response.papers.length === 0 && args.page > 1) {
      throw new ToolError('not_found', `Page ${args.page} is past the end (${response.total} results).`, 'Use a smaller page number.');
    }
    return presentPage(response, spec, {
      detail: args.detail,
      includeFacets: false,
      structuredBudget: deps.config.structuredBudgetChars,
      rerun: !fromCache
    });
  }
});
