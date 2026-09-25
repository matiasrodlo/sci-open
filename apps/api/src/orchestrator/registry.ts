import type { Paper, ProviderCapabilities, ProviderId, Query } from '@open-access-explorer/shared';
import * as arxiv from '../providers/arxiv';
import * as biorxiv from '../providers/biorxiv';
import * as core from '../providers/core';
import * as datacite from '../providers/datacite';
import * as doaj from '../providers/doaj';
import * as europepmc from '../providers/europepmc';
import * as ncbi from '../providers/ncbi';
import * as openaire from '../providers/openaire';
import * as openalex from '../providers/openalex';
import * as plos from '../providers/plos';
import type { ProviderFacetArgs, ProviderFacetOutcome } from '../providers/count-facets';

export type { ProviderFacetArgs, ProviderFacetOutcome, FacetRequest } from '../providers/count-facets';

/**
 * Every provider in the new shape, and how to drive it.
 *
 * Phase 08 is migrating these one at a time, and each arrival is one row here.
 * The orchestrator was built against Europe PMC alone deliberately — a fan-out
 * of one provider is still a fan-out, and every part of the pipeline could be
 * proven before breadth was added.
 */

export type ProviderSearchArgs = {
  query: Query;
  /** How many records to read from this provider. */
  depth: number;
  offset: number;
  timeoutMs: number;
  openAccessOnly: boolean;
  signal?: AbortSignal;
  userAgent?: string;
  now?: () => Date;
};

export type ProviderLookupArgs = {
  /** The provider's own id for the record, as `SourceRef.nativeId` holds it. */
  nativeId: string;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
  now?: () => Date;
};

export type ProviderSearchOutcome = {
  papers: Paper[];
  totalHits?: number;
  skipped: Array<{ index: number; nativeId?: string; reason: string }>;
};

export type ProviderEntry = {
  id: ProviderId;
  capabilities: ProviderCapabilities;
  /** The native query string, for cache keying and for debugging what was asked. */
  translate(query: Query, options: { openAccessOnly: boolean }): string;
  search(args: ProviderSearchArgs): Promise<ProviderSearchOutcome>;
  /**
   * Bumped when this provider's normaliser changes shape, so cached payloads
   * from the previous version are not reused.
   */
  normalizerVersion: number;
  /**
   * Fetches one record by the provider's own id, where its API offers a way
   * to ask for one.
   *
   * Absent means "ask the search endpoint for it", which `lookupPaper` does —
   * and for the three providers without an entry here that is not a fallback
   * but the right request: bioRxiv, DataCite and PLOS mint DOIs as their
   * native ids, so the id *is* a DOI lookup.
   *
   * arXiv, PubMed and Europe PMC were in that group too, on the claim that
   * they index their ids as searchable text. They do not, or not in the fields
   * their `translate` scopes a term to, and the paper endpoint 404'd on every
   * record from all three until they got the entries below. A native id is not
   * a search term, and the only providers that can be asked for one through
   * `search` are the ones whose ids are DOIs — which `parseQuery` recognises
   * and routes to a DOI clause rather than a scoped keyword.
   */
  lookup?(args: ProviderLookupArgs): Promise<Paper | null>;
  /**
   * Counts the facets `capabilities.facets` lists, across everything this
   * provider matches rather than across what a search reads from it. See
   * `orchestrator/source-facets.ts`.
   */
  facets?(args: ProviderFacetArgs): Promise<ProviderFacetOutcome>;
  /**
   * True when `facets` is answered by the provider's own aggregation — a
   * request per facet at most — and so is asked at the same time as the
   * search.
   *
   * False, or absent, when it is answered one count at a time, which is a
   * request per bucket. Those wait for the provider's search to settle, for
   * three reasons: the search's `totalHits` is often a bucket already; a
   * search that read everything the provider matched makes every count
   * derivable from the records in hand; and two of these providers enforce a
   * rate that a second burst on top of the search's own would trip.
   */
  facetsAggregate?: boolean;
};

export const PROVIDERS: ProviderEntry[] = [
  {
    id: 'arxiv',
    capabilities: arxiv.capabilities,
    facets: args => arxiv.facets(args),
    translate: (query, options) => arxiv.translate(query, options),
    normalizerVersion: 1,
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await arxiv.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    },
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return arxiv.lookup(nativeId, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    }
  },
  {
    id: 'ncbi',
    capabilities: ncbi.capabilities,
    facets: args => ncbi.facets(args, process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}),
    translate: (query, options) => ncbi.translate(query, options),
    normalizerVersion: 1,
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await ncbi.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    },
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return ncbi.lookup(nativeId, {
        timeoutMs,
        ...(process.env.NCBI_API_KEY ? { apiKey: process.env.NCBI_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    }
  },
  {
    id: 'doaj',
    capabilities: doaj.capabilities,
    facets: args => doaj.facets(args, process.env.DOAJ_API_KEY ? { apiKey: process.env.DOAJ_API_KEY } : {}),
    translate: (query, options) => doaj.translate(query, options),
    normalizerVersion: 2,
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return doaj.lookup(nativeId, {
        timeoutMs,
        ...(process.env.DOAJ_API_KEY ? { apiKey: process.env.DOAJ_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    },
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await doaj.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(process.env.DOAJ_API_KEY ? { apiKey: process.env.DOAJ_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'plos',
    capabilities: plos.capabilities,
    facets: args => plos.facets(args),
    facetsAggregate: true,
    translate: (query, options) => plos.translate(query, options),
    normalizerVersion: 1,
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await plos.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'openaire',
    capabilities: openaire.capabilities,
    facets: args => openaire.facets(args),
    translate: (query, options) => openaire.translate(query, options),
    normalizerVersion: 3,
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return openaire.lookup(nativeId, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    },
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await openaire.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'datacite',
    capabilities: datacite.capabilities,
    translate: (query, options) => datacite.translate(query, options),
    normalizerVersion: 2,
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await datacite.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(process.env.DATACITE_API_KEY ? { apiKey: process.env.DATACITE_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'biorxiv',
    capabilities: biorxiv.capabilities,
    translate: (query, options) => biorxiv.translate(query, options),
    normalizerVersion: 1,
    async search({ query, offset, timeoutMs, signal, userAgent, now }) {
      const result = await biorxiv.search(query, {
        offset,
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return { papers: result.papers, skipped: result.skipped };
    }
  },
  {
    id: 'openalex',
    capabilities: openalex.capabilities,
    facets: args => openalex.facets(args, process.env.OPENALEX_API_KEY ? { apiKey: process.env.OPENALEX_API_KEY } : {}),
    facetsAggregate: true,
    translate: (query, options) => openalex.translate(query, options),
    normalizerVersion: 2,
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return openalex.lookup(nativeId, {
        timeoutMs,
        ...(process.env.OPENALEX_API_KEY ? { apiKey: process.env.OPENALEX_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    },
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await openalex.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(process.env.OPENALEX_API_KEY ? { apiKey: process.env.OPENALEX_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'core',
    capabilities: core.capabilities,
    translate: (query, options) => core.translate(query, options),
    normalizerVersion: 2,
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return core.lookup(nativeId, {
        timeoutMs,
        ...(process.env.CORE_API_KEY ? { apiKey: process.env.CORE_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    },
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await core.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(process.env.CORE_API_KEY ? { apiKey: process.env.CORE_API_KEY } : {}),
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    }
  },
  {
    id: 'europepmc',
    capabilities: europepmc.capabilities,
    facets: args => europepmc.facets(args),
    translate: (query, options) => europepmc.translate(query, options),
    normalizerVersion: 2,
    async search({ query, depth, offset, timeoutMs, openAccessOnly, signal, userAgent, now }) {
      const result = await europepmc.search(query, {
        pageSize: depth,
        offset,
        timeoutMs,
        openAccessOnly,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    },
    async lookup({ nativeId, timeoutMs, signal, userAgent, now }) {
      return europepmc.lookup(nativeId, {
        timeoutMs,
        ...(signal ? { signal } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(now ? { now } : {})
      });
    }
  }
];
