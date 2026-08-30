import type { AuthorityCapabilities } from '@open-access-explorer/shared';

/**
 * One field, and it is the reason phase 09 lists OpenCitations at all.
 *
 * It is consulted last and only for papers still missing a count after
 * Crossref and OpenAlex have answered — see `registry.ts`. A citation count is
 * the one thing it has, so asking it about a paper that already has one buys
 * nothing and costs a request.
 */
export const capabilities: AuthorityCapabilities = {
  fields: ['citationCount'],
  authoritative: []
};
