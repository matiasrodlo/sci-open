import { createHash } from 'crypto';
import type { ProviderReport } from '@sci-open/shared';
import type { UpstreamUsage } from '@sci-open/core';

/**
 * A provenance block on every result, so a reviewer — or a reviewer agent —
 * can check that an answer came from this server, for this query, unmodified.
 * Under a `_meta` key in a namespace this project controls (decision D10).
 */
export const PROVENANCE_KEY = 'io.github.matiasrodlo/provenance';

/** Sorted keys, no whitespace, undefined dropped. Stable across runs and
 * machines for the JSON values tools produce (strings, finite numbers,
 * booleans, null, arrays, plain objects). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/**
 * What a call asked of the sources, beside the provenance in every result's
 * `_meta`, failed ones included: how many requests, to which sources, and what
 * OpenAlex priced them at. The evals sum it per case; a client may log it.
 */
export const USAGE_KEY = 'io.github.matiasrodlo/usage';

export function usageMeta(usage: UpstreamUsage): Record<string, unknown> {
  return {
    [USAGE_KEY]: {
      upstream_requests: usage.requests,
      openalex_cost_usd: usage.costUsd,
      by_source: Object.fromEntries(Object.entries(usage.sources).map(([source, u]) => [source, u.requests]))
    }
  };
}

export const sha256 = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export type ProvenanceInput = {
  sources?: readonly ProviderReport[];
  complete?: boolean;
  negativeResult?: boolean;
  license?: string;
};

export type ServerIdentity = { name: string; version: string; commit?: string };

export function buildProvenance(
  server: ServerIdentity,
  tool: string,
  args: unknown,
  structured: unknown,
  input: ProvenanceInput = {},
  now: () => Date = () => new Date()
): Record<string, unknown> {
  return {
    [PROVENANCE_KEY]: {
      version: 1,
      server,
      tool,
      retrieved_at: now().toISOString(),
      query_hash: sha256(canonicalJson(args)),
      result_hash: sha256(canonicalJson(structured)),
      ...(input.sources
        ? { sources: input.sources.map(s => ({ id: s.provider, status: s.status, retrieved: s.retrieved, latency_ms: s.latency, ...(s.query ? { query: s.query } : {}) })) }
        : {}),
      ...(input.complete !== undefined ? { complete: input.complete } : {}),
      ...(input.negativeResult ? { negative_result: true } : {}),
      ...(input.license ? { license: input.license } : {})
    }
  };
}
