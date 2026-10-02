import type { AuthorityCapabilities } from '@open-access-explorer/shared';

/**
 * What Crossref can be asked about a DOI it registered.
 *
 * The registration agency's own record, so it is the best single source of
 * bibliographic metadata — and it is deliberately not asked about open access.
 *
 * The old path inferred `oaStatus` from the presence of any `license` entry,
 * via `extractLicense`, which returns the string `'Custom License'` for
 * anything that is not one of six recognised Creative Commons URLs. Anything
 * truthy became `oaStatus: 'published'`. Measured 2026-08-30 on
 * `10.1002/adma.201907006`: Crossref carries one license,
 * `http://onlinelibrary.wiley.com/termsAndConditions#vor` — Wiley's
 * all-rights-reserved terms of use — so the old path marked it open, while
 * Unpaywall answers `is_oa: false, oa_status: "closed"`.
 *
 * The confusion is between a *licence* and a *route*. Three of the four works
 * sampled carry a `content-version: tdm` licence, which grants text-mining
 * rights to a machine and says nothing at all about whether a reader can get
 * the file. `oaStatus` is therefore absent from `fields` here and comes from
 * Unpaywall, which is the vocabulary it is expressed in.
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
    'fullText',
    'landingPage'
  ],

  // Crossref is the registrar, but a value several search providers already
  // agreed on is not improved by overwriting it, and the merge that produced it
  // recorded who supplied it. Gap-filling only.
  authoritative: []
};
