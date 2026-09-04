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
   * and for the six providers without an entry here that is not a fallback but
   * the right request: three of them mint DOIs as their native ids, so the id
   * *is* a DOI lookup, and the other three index theirs as searchable text.
   */
  lookup?(args: ProviderLookupArgs): Promise<Paper | null>;
};

export const PROVIDERS: ProviderEntry[] = [
  {
    id: 'arxiv',
    capabilities: arxiv.capabilities,
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
    }
  },
  {
    id: 'ncbi',
    capabilities: ncbi.capabilities,
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
    }
  },
  {
    id: 'doaj',
    capabilities: doaj.capabilities,
    translate: (query, options) => doaj.translate(query, options),
    normalizerVersion: 1,
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
    translate: (query, options) => openaire.translate(query, options),
    normalizerVersion: 1,
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
    normalizerVersion: 1,
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
    translate: (query, options) => openalex.translate(query, options),
    normalizerVersion: 1,
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
    normalizerVersion: 1,
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
    translate: (query, options) => europepmc.translate(query, options),
    normalizerVersion: 1,
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
    }
  }
];
