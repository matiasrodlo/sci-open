import type { AuthorityCapabilities, AuthorityFacts, AuthorityId, Paper } from '@open-access-explorer/shared';
import * as crossref from './crossref';
import * as openalex from './openalex';
import * as unpaywall from './unpaywall';
import * as opencitations from './opencitations';
import * as preprints from './preprints';

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
  /**
   * How long one lookup may take, when it is not what the caller allows every
   * lookup. For an authority whose answer is slower by nature than an API's —
   * the preprint servers', which is a file at the end of redirects. The
   * caller's budget still bounds it.
   */
  timeoutMs?: number;
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
        ...(process.env.OPENALEX_API_KEY ? { apiKey: process.env.OPENALEX_API_KEY } : {}),
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
  },
  {
    id: 'preprints',
    capabilities: preprints.capabilities,
    // Only for a paper with no copy whose DOI is on a server with a known
    // address. Each question is a request to that server, so a paper that
    // already has a copy — every paper on a page the gate let through — is
    // never asked about.
    wants: paper => !paper.fullText && preprints.locate(paper.doi) !== undefined,
    // Beside Unpaywall rather than after it, and with longer than an API call.
    // The answer is a file at the end of redirects: measured 2026-09-25,
    // Research Square in about 0.75s, bioRxiv 1.2–2s, OSF 2–5s. In a second
    // pass with the rescue's 2.5s a lookup, it had half the rescue's budget
    // and the bioRxiv and OSF papers timed out every time. The price of the
    // first pass is asking about a paper Unpaywall would also have found a
    // copy of — and `enrich` keeps the verified one either way.
    pass: 0,
    timeoutMs: 4500,
    lookup: ({ doi, timeoutMs, signal, userAgent }) =>
      preprints.lookup(doi, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {})
      })
  }
];

export function authorityById(id: AuthorityId): AuthorityEntry | undefined {
  return AUTHORITIES.find(a => a.id === id);
}
