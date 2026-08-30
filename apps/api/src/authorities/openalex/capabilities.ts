import type { AuthorityCapabilities } from '@open-access-explorer/shared';

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
    'publisher',
    'topics',
    'language',
    'citationCount',
    'oaStatus',
    'fullText',
    'landingPage'
  ],

  /**
   * Nothing. OpenAlex reports `open_access.oa_status` in Unpaywall's
   * vocabulary — it is downstream of Unpaywall, not a second opinion — so when
   * both answer, the field should carry the value from the service that
   * assigns it. Unpaywall is consulted after this one for that reason.
   */
  authoritative: []
};
