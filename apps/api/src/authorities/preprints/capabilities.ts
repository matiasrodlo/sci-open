import type { AuthorityCapabilities } from '@open-access-explorer/shared';

/**
 * What the preprint servers themselves can be asked about a DOI: where the
 * PDF is, and nothing else.
 *
 * Here because the two databases that say where a copy is — OpenAlex and
 * Unpaywall — agree with each other and are both silent for much of what the
 * preprint servers hold. On "malaria vaccine", 2024 preprints, 31 papers were
 * dropped for want of a copy; for 28 of them both databases listed the DOI as
 * the only open-access location, while the servers were serving the PDF at an
 * address the DOI determines.
 */
export const capabilities: AuthorityCapabilities = {
  fields: ['fullText'],

  /**
   * Authoritative so the rescue asks it (see `canRescue`), which is the whole
   * reason it exists. It never overwrites anything in practice: the registry
   * only asks it about a paper with no copy, after Unpaywall has had its turn.
   * And unlike the gap-fillers the rescue refuses, what it offers has been
   * fetched — see `lookup`.
   */
  authoritative: ['fullText']
};
