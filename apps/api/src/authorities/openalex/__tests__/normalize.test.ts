import { describe, it, expect } from 'vitest';
import { normalize, capabilities } from '../index';
import byDoi from '../__fixtures__/by-doi.json';

/**
 * Recorded from `filter=doi:10.1038/srep09811`, which is the correction this
 * phase owes OpenAlex: the old client's `getWorkByDOI` built `search=doi:…`,
 * a full-text search for the literal string.
 */
describe('openalex authority normalize', () => {
  const facts = normalize(byDoi as any)!;

  it('matches exactly one work', () => {
    expect((byDoi as any).meta.count).toBe(1);
    expect((byDoi as any).results).toHaveLength(1);
  });

  it('costs a tenth of what the search form costs', () => {
    // OpenAlex prices the two differently and reports it. A `search` is
    // $0.001; this is what a filter lookup costs.
    expect((byDoi as any).meta.cost_usd).toBe(0.0001);
  });

  it('carries the fields the search side was fixed to read', () => {
    expect(facts.title).toContain('CRISPR/Cas9');
    expect(facts.venue).toBe('Scientific Reports');
    // `host_organization_name`, not `host_venue.publisher` — which is not a
    // valid select field — and not `source.publisher`, which does not exist.
    expect(facts.publisher).toBe('Nature Portfolio');
    expect(facts.year).toBe(2015);
    expect(facts.citationCount).toBeGreaterThan(0);
    expect(facts.topics?.length).toBeGreaterThan(0);
    expect(facts.landingPage).toBe('https://doi.org/10.1038/srep09811');
  });

  it('reports the route in the vocabulary it borrows from Unpaywall', () => {
    expect(facts.oaStatus).toBe('gold');
  });

  it('defers to Unpaywall for that route rather than competing with it', () => {
    // OpenAlex is downstream of Unpaywall for oa_status, so when both answer
    // the value should come from the service that assigns it.
    expect(capabilities.authoritative).toEqual([]);
  });

  it('returns null when the filter matched nothing', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize({ results: [] } as any)).toBeNull();
  });
});
