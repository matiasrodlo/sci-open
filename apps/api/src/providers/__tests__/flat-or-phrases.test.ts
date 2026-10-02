import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate as arxiv } from '../arxiv/translate';
import { translate as doaj } from '../doaj/translate';
import { translate as europepmc } from '../europepmc/translate';
import { translate as ncbi } from '../ncbi/translate';
import { translate as plos } from '../plos/translate';

/**
 * The flat form, as each provider with a fielded dialect falls back to it, for
 * `crispr OR "gene editing"`: the phrase is one of the alternatives.
 *
 * It was sent as a required clause whatever the join — so every one of these
 * asked for `crispr AND "gene editing"`, and the records only `crispr` matched
 * were never read. See `joinFlat`.
 */
describe('a phrase in a flat OR', () => {
  const query: Query = { terms: ['crispr'], phrases: ['gene editing'], join: 'OR' };

  it('is ORed with the terms, not ANDed after them, at every provider', () => {
    const sent = { arxiv: arxiv(query), doaj: doaj(query), europepmc: europepmc(query), ncbi: ncbi(query), plos: plos(query) };
    for (const [provider, native] of Object.entries(sent)) {
      expect({ provider, native }).toEqual({ provider, native: expect.stringMatching(/^\(.*crispr.* OR .*"gene editing".*\)$/) });
      expect({ provider, native }).toEqual({ provider, native: expect.not.stringContaining(' AND ') });
    }
  });

  it('is still required under AND', () => {
    expect(europepmc({ ...query, join: 'AND' })).toContain(') AND (');
  });
});
