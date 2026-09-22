import { describe, it, expect } from 'vitest';
import type { ProviderCapabilities } from '@open-access-explorer/shared';
import { plan } from '../plan';
import { parseQuery } from '../parse-query';
import type { ProviderEntry } from '../registry';

/**
 * Who gets asked, and — the part that matters here — what a reader is told
 * about whoever does not.
 *
 * A provider skipped without a reason ends up described by whatever the far end
 * invents. That already happened once: `plan` produced "no keywordSearch
 * capability", the panel rendered every skip as "no keyword index for it", and
 * that was false for two of the three providers it named. So every skip carries
 * the provider's own words.
 */

const caps = (over: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  keywordSearch: true,
  fieldedSearch: true,
  doiLookup: true,
  fields: ['title'],
  yearFilter: true,
  maxPageSize: 100,
  reportsTotal: true,
  suppliesCitations: false,
  ...over
});

const entry = (id: string, capabilities: ProviderCapabilities): ProviderEntry => ({
  id: id as ProviderEntry['id'],
  capabilities,
  translate: () => 'native',
  normalizerVersion: 1,
  search: async () => ({ papers: [], totalHits: 0, skipped: [] })
});

const ids = (entries: readonly { id: string }[]) => entries.map(e => e.id).sort();

describe('plan', () => {
  it('asks everything that can keyword search', () => {
    const providers = [entry('europepmc', caps()), entry('openalex', caps({ fieldedSearch: false }))];
    expect(ids(plan(parseQuery('crispr'), providers).planned)).toEqual(['europepmc', 'openalex']);
  });

  it('skips a provider in its own words', () => {
    const providers = [
      entry('biorxiv', caps({ keywordSearch: false, skipReason: { keywordSearch: 'scans a date window, with no keyword index' } }))
    ];
    expect(plan(parseQuery('crispr'), providers).skipped).toEqual([
      { provider: 'biorxiv', reason: 'scans a date window, with no keyword index' }
    ]);
  });
});

/**
 * The case the `fieldedSearch` capability exists for.
 *
 * `flatten` only puts a clause into the flat `terms` when searching it as body
 * text would be wider than the clause, so `AU=Doudna` contributes nothing to
 * them — requiring "Doudna" in a title is a narrower and different question. A
 * provider that cannot express the field either has an empty query.
 *
 * It was asked anyway before this, answered `retrieved: 0`, and the coverage
 * panel printed `0 · 0` beside its name — which a reader takes as "no papers by
 * that author here", a claim nobody made and nothing checked.
 */
describe('a query no keyword-only provider can answer', () => {
  const keywordOnly = caps({
    fieldedSearch: false,
    skipReason: { fieldedSearch: 'takes keywords only, with no way to name a field' }
  });

  const providers = [entry('europepmc', caps()), entry('openaire', keywordOnly)];

  it('skips the provider that has nothing left to search for', () => {
    const { planned, skipped } = plan(parseQuery('AU=Doudna'), providers);

    expect(ids(planned)).toEqual(['europepmc']);
    expect(skipped).toEqual([
      { provider: 'openaire', reason: 'takes keywords only, with no way to name a field' }
    ]);
  });

  it('still asks it when the query leaves it something', () => {
    // `crispr` is a topic word, so the flat form is not empty; the author
    // clause is applied to what comes back by `matchesQuery`.
    const { planned, skipped } = plan(parseQuery('AU=Doudna AND TS=crispr'), providers);

    expect(ids(planned)).toEqual(['europepmc', 'openaire']);
    expect(skipped).toEqual([]);
  });

  it('does not skip a provider that can express the field', () => {
    expect(ids(plan(parseQuery('AU=Doudna'), [entry('europepmc', caps())]).planned)).toEqual(['europepmc']);
  });

  it('leaves a plain keyword search alone', () => {
    expect(ids(plan(parseQuery('crispr'), providers).planned)).toEqual(['europepmc', 'openaire']);
  });

  it('leaves a DOI lookup alone, which never reads the flat form', () => {
    expect(ids(plan(parseQuery('10.1038/nature12373'), providers).planned))
      .toEqual(['europepmc', 'openaire']);
  });
});
