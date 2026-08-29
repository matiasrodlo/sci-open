import type { Paper, ProviderCapabilities, ProviderId, Query } from '@open-access-explorer/shared';
import * as europepmc from '../providers/europepmc';

/**
 * Every provider in the new shape, and how to drive it.
 *
 * One entry today. The orchestrator is built against Europe PMC alone
 * deliberately — a fan-out of one provider is still a fan-out, and every part
 * of the pipeline can be proven before breadth is added. Phase 08 migrates the
 * rest, and each arrival is one row here.
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
};

export const PROVIDERS: ProviderEntry[] = [
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

export function providerById(id: ProviderId): ProviderEntry | undefined {
  return PROVIDERS.find(p => p.id === id);
}
