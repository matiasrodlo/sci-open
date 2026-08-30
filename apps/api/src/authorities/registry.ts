import type { AuthorityCapabilities, AuthorityFacts, AuthorityId, Paper } from '@open-access-explorer/shared';
import * as crossref from './crossref';
import * as openalex from './openalex';
import * as unpaywall from './unpaywall';
import * as opencitations from './opencitations';

/**
 * Every authority, and how to drive it.
 *
 * The sibling of `orchestrator/registry.ts`, and the same rule applies: an
 * arrival is one row here and nothing else changes.
 */

export type AuthorityLookupArgs = {
  doi: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type AuthorityEntry = {
  id: AuthorityId;
  capabilities: AuthorityCapabilities;
  lookup(args: AuthorityLookupArgs): Promise<AuthorityFacts | null>;
  /**
   * Which pass this authority runs in. Everything in pass 0 goes out together;
   * pass 1 runs afterwards and sees what pass 0 filled in.
   */
  pass: 0 | 1;
  /**
   * Whether this paper is worth a request. Checked immediately before the
   * request, so a pass-1 authority sees the enriched paper.
   */
  wants?(paper: Paper): boolean;
};

/**
 * Order is load-bearing for gap-filling: the first authority to supply a
 * missing field is the one recorded in `fieldSources`, and later ones leave it
 * alone. Crossref goes first because it is the registrar's own record, then
 * OpenAlex, then Unpaywall — which is last of the three because the two fields
 * it overwrites should overwrite whatever the other two wrote, not race them.
 */
export const AUTHORITIES: AuthorityEntry[] = [
  {
    id: 'crossref',
    capabilities: crossref.capabilities,
    pass: 0,
    lookup: ({ doi, timeoutMs, signal, userAgent }) =>
      crossref.lookup(doi, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {})
      })
  },
  {
    id: 'openalex',
    capabilities: openalex.capabilities,
    pass: 0,
    lookup: ({ doi, timeoutMs, signal, userAgent }) =>
      openalex.lookup(doi, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {})
      })
  },
  {
    id: 'unpaywall',
    capabilities: unpaywall.capabilities,
    pass: 0,
    lookup: ({ doi, timeoutMs, signal, userAgent }) =>
      unpaywall.lookup(doi, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {})
      })
  },
  {
    id: 'opencitations',
    capabilities: opencitations.capabilities,
    // Second pass, and only for papers still missing a count once Crossref and
    // OpenAlex have answered. It has exactly one field to offer, so asking it
    // about a paper that already has one is a request that cannot change
    // anything. On a measured page that is most of them.
    pass: 1,
    wants: paper => paper.citationCount === undefined,
    lookup: ({ doi, timeoutMs, signal, userAgent }) =>
      opencitations.lookup(doi, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {})
      })
  }
];

export function authorityById(id: AuthorityId): AuthorityEntry | undefined {
  return AUTHORITIES.find(a => a.id === id);
}
