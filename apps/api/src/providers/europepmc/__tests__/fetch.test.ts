import { describe, it, expect } from 'vitest';
import { assertSearchResponse, EuropePmcUnavailableError } from '../fetch';

/**
 * A 200 is not on its own an answer.
 *
 * Observed live on 2026-08-29: Europe PMC served `{"version":"6.9"}` and
 * nothing else, at HTTP 200, for every query tried including `cancer`. Without
 * this check the provider reads that as an empty corpus and reports
 * `retrieved: 0` with `status: 'ok'` — a degraded provider presented as a
 * search that matched nothing, which is the failure `ProviderReport` carries a
 * status to prevent.
 */
describe('assertSearchResponse', () => {
  it('rejects the body Europe PMC actually served while degraded', () => {
    expect(() => assertSearchResponse({ version: '6.9' } as any)).toThrow(
      EuropePmcUnavailableError
    );
  });

  it('names what it did get, so the report says something useful', () => {
    expect(() => assertSearchResponse({ version: '6.9' } as any)).toThrow(/only version/);
  });

  it('rejects an empty body', () => {
    expect(() => assertSearchResponse({})).toThrow(/empty body/);
  });

  it('accepts a genuine empty result set', () => {
    // A query that matched nothing is a real answer and must not be confused
    // with an outage: Europe PMC still reports the count.
    expect(() => assertSearchResponse({ hitCount: 0, resultList: { result: [] } })).not.toThrow();
  });

  it('accepts a count of zero even with no result list', () => {
    expect(() => assertSearchResponse({ hitCount: 0 })).not.toThrow();
  });

  it('accepts a result list even with no count', () => {
    // Either field is enough. The check separates an answer from a non-answer;
    // it is not policing the schema.
    expect(() => assertSearchResponse({ resultList: { result: [] } })).not.toThrow();
  });

  it('accepts a normal page', () => {
    expect(() =>
      assertSearchResponse({ hitCount: 12, resultList: { result: [{}] } })
    ).not.toThrow();
  });
});
