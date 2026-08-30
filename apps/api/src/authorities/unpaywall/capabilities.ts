import type { AuthorityCapabilities } from '@open-access-explorer/shared';

/**
 * What Unpaywall can be asked about a DOI.
 *
 * It is here for two fields and everything else is incidental. `oa_status` is
 * the graded open-access route — `gold`, `green`, `hybrid`, `bronze`,
 * `closed` — and it is the vocabulary `Paper.oaStatus` is *defined* in, which
 * is why it is the one field in the whole enrichment step allowed to overwrite
 * a value already present. And `oa_locations` is the list of places the file
 * actually is, which is what the download-success work below turns on.
 *
 * Three fields the old client declared and Unpaywall does not return:
 * `abstract_inverted_index` was in `UnpaywallResponse` and reconstructed by
 * `convertUnpaywallToOARecord`, and it is absent from all three recorded
 * responses — v2 does not ship abstracts. There are no topics and no citation
 * count either. So `abstract`, `topics` and `citationCount` are not claimed.
 */
export const capabilities: AuthorityCapabilities = {
  fields: ['title', 'authors', 'year', 'venue', 'publisher', 'oaStatus', 'fullText', 'landingPage'],

  /**
   * The route, and the copy.
   *
   * `oaStatus` because a search provider that reports one is reporting
   * something derived from Unpaywall anyway, and most report nothing.
   *
   * `fullText` because replacing the advertised copy with a better one is the
   * entire point of consulting Unpaywall — see `pickFullText`, where the
   * replacement is conditional on the candidate actually being better.
   */
  authoritative: ['oaStatus', 'fullText']
};
