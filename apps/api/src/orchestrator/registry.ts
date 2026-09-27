import type { Paper, ProviderCapabilities, ProviderId, Query } from '@open-access-explorer/shared';
import { apiKeyFor, type KeyedProvider } from '../lib/api-key';
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
 * Every provider, and how to drive it: one row each in `PROVIDERS`, built by
 * `defineProvider` from the provider's own module.
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

/**
 * What a provider module exports, as the registry drives it.
 *
 * Every provider's `search`, `lookup` and `facets` already take the same core
 * options — the provider's own option types are supersets of these — so one
 * adapter drives all ten. There used to be ten, written out by hand: thirty
 * lines each of copying `signal`, `userAgent` and `now` across and reading an
 * API key from `process.env`, identical but for which key, and a place for
 * one of them to forward something the others did not.
 */
export type ProviderModule = {
  capabilities: ProviderCapabilities;
  translate(query: Query, options: { openAccessOnly: boolean }): string;
  search(query: Query, options: ProviderCallOptions & {
    pageSize: number;
    offset: number;
    openAccessOnly: boolean;
  }): Promise<{ papers: Paper[]; totalHits?: number; skipped: ProviderSearchOutcome['skipped'] }>;
  lookup?(nativeId: string, options: ProviderCallOptions): Promise<Paper | null>;
  facets?(args: ProviderFacetArgs, options: { apiKey?: string }): Promise<ProviderFacetOutcome>;
};

/** What every call to a provider carries. */
export type ProviderCallOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
  now?: () => Date;
  apiKey?: string;
};

export type ProviderSpec = {
  /** See `ProviderEntry.normalizerVersion`; pinned in `normalizer-version.test.ts`. */
  normalizerVersion: number;
  /** The key this provider is sent, when one is configured. See `useConfig`. */
  key?: KeyedProvider;
  /** See `ProviderEntry.facetsAggregate`. */
  facetsAggregate?: boolean;
};

/** A provider module as the orchestrator drives it. */
export function defineProvider(id: ProviderId, module: ProviderModule, spec: ProviderSpec): ProviderEntry {
  // Read per call, so a key configured after this module loaded — which is
  // every key, since `useConfig` runs at startup — still reaches the provider.
  const key = (): { apiKey?: string } => (spec.key ? apiKeyFor(spec.key) : {});
  const carried = ({ signal, userAgent, now }: Pick<ProviderCallOptions, 'signal' | 'userAgent' | 'now'>) => ({
    ...(signal ? { signal } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(now ? { now } : {})
  });

  const { lookup, facets } = module;

  return {
    id,
    capabilities: module.capabilities,
    normalizerVersion: spec.normalizerVersion,
    ...(spec.facetsAggregate ? { facetsAggregate: true } : {}),
    translate: (query, options) => module.translate(query, options),
    async search({ query, depth, offset, timeoutMs, openAccessOnly, ...rest }) {
      const result = await module.search(query, {
        pageSize: depth, offset, timeoutMs, openAccessOnly, ...key(), ...carried(rest)
      });
      return {
        papers: result.papers,
        ...(result.totalHits !== undefined ? { totalHits: result.totalHits } : {}),
        skipped: result.skipped
      };
    },
    ...(lookup
      ? { lookup: ({ nativeId, timeoutMs, ...rest }: ProviderLookupArgs) => lookup(nativeId, { timeoutMs, ...key(), ...carried(rest) }) }
      : {}),
    ...(facets ? { facets: (args: ProviderFacetArgs) => facets(args, key()) } : {})
  };
}

/**
 * The providers, in the order the fan-out asks them. bioRxiv and medRxiv are
 * one API and one row; see `PROVIDER_ALIASES` in `lookup.ts`.
 */
export const PROVIDERS: ProviderEntry[] = [
  defineProvider('arxiv', arxiv, { normalizerVersion: 1 }),
  defineProvider('ncbi', ncbi, { normalizerVersion: 1, key: 'ncbi' }),
  defineProvider('doaj', doaj, { normalizerVersion: 2, key: 'doaj' }),
  defineProvider('plos', plos, { normalizerVersion: 1, facetsAggregate: true }),
  defineProvider('openaire', openaire, { normalizerVersion: 4 }),
  defineProvider('datacite', datacite, { normalizerVersion: 2, key: 'datacite' }),
  defineProvider('biorxiv', biorxiv, { normalizerVersion: 1 }),
  defineProvider('openalex', openalex, { normalizerVersion: 3, key: 'openalex', facetsAggregate: true }),
  defineProvider('core', core, { normalizerVersion: 2, key: 'core' }),
  defineProvider('europepmc', europepmc, { normalizerVersion: 2 })
];
