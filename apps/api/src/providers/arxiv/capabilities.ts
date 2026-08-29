import type { ProviderCapabilities } from '@open-access-explorer/shared';

/**
 * What the arXiv Atom API can actually do.
 *
 * Every entry here was checked against a response rather than against the
 * documentation. That is not ceremony: arXiv answers a malformed date range
 * with an error document, and Europe PMC answers an unsupported year operator
 * with the unbounded corpus. A capability taken on trust is how a provider
 * ends up asserting a filter it never applied.
 */
export const capabilities: ProviderCapabilities = {
  keywordSearch: true,

  // arXiv has no DOI index. The old connector accepted a DOI lookup and
  // returned an empty result, which reads exactly like "no such paper";
  // declaring it false means the orchestrator skips arXiv and names the
  // missing capability instead of recording a silent nothing.
  doiLookup: false,

  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    // From `arxiv:journal_ref`, present once a preprint has appeared
    // somewhere. The old connector never read it, so arXiv was one of only two
    // providers contributing no venue at all.
    'venue',
    'topics',
    'language',
    'fullText',
    'landingPage'
  ],

  // Verified, not assumed: `submittedDate:[a TO b]` narrowed a 16-hit query to
  // 3, every one inside the bound. See the note in `translate` for the form
  // that does *not* work.
  yearFilter: true,

  // arXiv asks that a single request stay at or below 2000 results.
  maxPageSize: 2000,

  // `opensearch:totalResults`, on every feed.
  reportsTotal: true,

  // arXiv holds no citation data.
  suppliesCitations: false
};
