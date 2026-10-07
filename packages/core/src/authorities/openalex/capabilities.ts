import type { AuthorityCapabilities } from '@sci-open/shared';

/**
 * What OpenAlex can be asked about a DOI.
 *
 * The one provider that fills both roles, which is why the two interfaces are
 * separate rather than one interface with an optional method. As a search
 * provider it is fanned out to with a `search` term; as an authority it is
 * asked about a DOI already in hand.
 *
 * It carries the citation count for most of the corpus, and its `topics` are
 * the curated vocabulary the search side already prefers over `concepts`.
 */
export const capabilities: AuthorityCapabilities = {
  fields: [
    'title',
    'abstract',
    'authors',
    'year',
    'venue',
    'biblio',
    'publisher',
    'topics',
    'language',
    'citationCount',
    'oaStatus',
    'fullText',
    'landingPage',
    // Only ever true, so filling the gap is all it can do: a paper no source
    // flagged gains the flag; one already flagged keeps it.
    'retracted'
  ],

  /**
   * Nothing. OpenAlex reports `open_access.oa_status` in Unpaywall's
   * vocabulary — it is downstream of Unpaywall, not a second opinion — so when
   * both answer, the field should carry the value from the service that
   * assigns it. Unpaywall is consulted after this one for that reason.
   */
  authoritative: []
};
