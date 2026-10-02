import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate, toParams } from '../translate';
import { parseQuery } from '../../../orchestrator/parse-query';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('toParams', () => {
  it('joins the words, which the search parameter reads as all required', () => {
    expect(toParams(query({ terms: ['crispr', 'gene'], phrases: ['gene editing'] })).search)
      .toBe('crispr gene gene editing');
  });

  it('sends a DOI through the pid parameter, not the free text', () => {
    // As free text a DOI is words, and matches every record that mentions its
    // prefix. `pid` is an exact match on the identifier.
    expect(toParams(query({ doi: '10.1/x' })).pid).toBe('10.1/x');
  });

  it('asks for publications only', () => {
    // `researchProducts` also holds datasets, software and "other"; the legacy
    // `/publications` endpoint did not.
    expect(toParams(query({ terms: ['x'] })).type).toBe('publication');
    expect(toParams(query({ doi: '10.1/x' })).type).toBe('publication');
  });

  it('takes the year bounds as request parameters rather than query terms', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2022, to: 2023 } }));
    expect(params.fromPublicationDate).toBe('2022-01-01');
    expect(params.toPublicationDate).toBe('2023-12-31');
  });

  it('omits a bound that was not asked for', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2024 } }));
    expect(params.fromPublicationDate).toBe('2024-01-01');
    expect(params.toPublicationDate).toBeUndefined();
  });

  it('asks for open access only when told to', () => {
    expect(toParams(query({ terms: ['x'] }), { openAccessOnly: true }).bestOpenAccessRightLabel).toBe('OPEN');
    expect(toParams(query({ terms: ['x'] })).bestOpenAccessRightLabel).toBeUndefined();
  });
});

describe('translate — the cache key', () => {
  it('carries the year bounds, so a bounded search cannot be served from an unbounded one', () => {
    // The orchestrator keys the provider cache on this string. Leaving the
    // bounds out would make two different searches collide.
    const unbounded = translate(query({ terms: ['crispr'] }));
    const bounded = translate(query({ terms: ['crispr'], years: { from: 2022, to: 2023 } }));
    expect(bounded).not.toBe(unbounded);
    expect(bounded).toContain('fromPublicationDate=2022-01-01');
  });

  it('distinguishes an open-access search from an unrestricted one', () => {
    expect(translate(query({ terms: ['crispr'] }), { openAccessOnly: true }))
      .not.toBe(translate(query({ terms: ['crispr'] })));
  });

  it('serialises the same search identically every time', () => {
    const q = query({ terms: ['crispr'], years: { from: 2022 } });
    expect(translate(q, { openAccessOnly: true })).toBe(translate(q, { openAccessOnly: true }));
    expect(translate(q, { openAccessOnly: true }))
      .toBe('bestOpenAccessRightLabel=OPEN&fromPublicationDate=2022-01-01&search=crispr');
  });
});

describe('toParams — a DOI is not free text', () => {
  it('uses the pid parameter rather than search', () => {
    const params = toParams(query({ doi: '10.1101/2025.10.27.684732' }));
    expect(params.pid).toBe('10.1101/2025.10.27.684732');
    expect(params.search).toBeUndefined();
  });

  it('keeps a DOI lookup distinct from the same string searched as words', () => {
    expect(translate(query({ doi: '10.1101/x' }))).not.toBe(translate(query({ terms: ['10.1101/x'] })));
  });

  it('still applies the access and date bounds to a DOI lookup', () => {
    const params = toParams(query({ doi: '10.1101/x', years: { from: 2022 } }), { openAccessOnly: true });
    expect(params.bestOpenAccessRightLabel).toBe('OPEN');
    expect(params.fromPublicationDate).toBe('2022-01-01');
  });
});

describe('toParams — the publication type', () => {
  it('asks for refereed instances when only published papers are wanted', () => {
    expect(toParams(query({ terms: ['ai'], stages: ['published', 'accepted'] })).isPeerReviewed).toBe('true');
  });

  it('asks nothing extra when unknown papers are wanted too', () => {
    expect(toParams(query({ terms: ['ai'], stages: ['published', 'unknown'] }))).not.toHaveProperty('isPeerReviewed');
  });

  it('leaves a DOI lookup unnarrowed', () => {
    expect(toParams(query({ doi: '10.1/x', stages: ['published'] }))).not.toHaveProperty('isPeerReviewed');
  });
});

/**
 * OpenAIRE's search has no wildcards. Measured on 2026-09-30: `generat*` found
 * 3,793 where `generation` found 6,825,154, and `*generation` exactly what
 * `generation` did — the `*` ignored.
 */
describe('toParams — wildcards', () => {
  it('sends nothing when a wildcard is required, rather than the rest of the query', () => {
    expect(toParams(query({ terms: ['crispr', 'generat*'] })).search).toBe('');
    expect(translate(query({ terms: ['crispr', 'generat*'] }))).toBe('');
  });

  it('sends nothing when the wildcard is an alternative, or all there was', () => {
    expect(translate(query({ terms: ['crispr', 'gen*'], join: 'OR' }), { openAccessOnly: true })).toBe('');
    expect(translate(query({ terms: ['gen*'] }), { openAccessOnly: true })).toBe('');
  });
});

/**
 * OpenAIRE reads a space as AND and honours `OR` and parentheses. Measured on
 * 2026-09-30 and 2026-10-01: `cancer OR zebrafish` 4,978,865, the union of
 * 4,893,595 and 92,429 less the 7,159 with both; `(crispr AND (mouse OR rat))`
 * 12,012, the union again.
 */
describe('toParams — alternatives and nested queries', () => {
  const search = (input: string) => toParams(parseQuery(input), { openAccessOnly: true }).search;

  it('asks for alternatives as alternatives, not for their overlap', () => {
    // Was `cancer zebrafish`: the 7,159 with both.
    expect(toParams(query({ terms: ['cancer', 'zebrafish'], join: 'OR' })).search).toBe('cancer OR zebrafish');
    expect(toParams(query({ terms: ['zebrafish'], phrases: ['gene editing'], join: 'OR' })).search)
      .toBe('zebrafish OR (gene editing)');
  });

  it('keeps a query the flat form states whole exactly as it was', () => {
    expect(search('crispr cas9')).toBe('crispr cas9');
    expect(search('AU=Doudna AND TS=crispr')).toBe('crispr');
  });

  it('asks for a nested OR rather than leaving it out', () => {
    // Was `crispr`, and 11 of the 465 papers that brought back mentioned
    // either animal.
    expect(search('TS=crispr AND (TS=mouse OR TS=rat)')).toBe('(crispr AND (mouse OR rat))');
    expect(search('(TS=a AND TS=b) OR TS=c')).toBe('((a AND b) OR c)');
  });

  it('leaves out an author it cannot scope, rather than searching the name as words', () => {
    expect(search('AU=Doudna AND (TS=mouse OR TS=rat)')).toBe('(mouse OR rat)');
  });

  it('sends nothing for a nested OR with a branch it cannot send beside a topic term', () => {
    expect(translate(parseQuery('TS=crispr AND (TS=mouse OR AU=Smith)'), { openAccessOnly: true })).toBe('');
  });

  it('drops the brackets and quotes from a phrase, which would unbalance the search', () => {
    expect(toParams(query({ terms: ['a'], phrases: ['gene (editing'], join: 'OR' })).search).toBe('a OR (gene editing)');
  });
});

/**
 * `ALL=` reaches authors, venues and publishers as well as the body text, and
 * OpenAIRE's search is the body text only, so it cannot state one. Nor can it
 * leave one out: a miss on `all` is `unknown` to `matchesQuery`, so everything
 * the wider request brought back would be kept. OpenAIRE is not asked.
 */
describe('toParams — ALL=', () => {
  it('sends nothing for a query that requires an ALL= term', () => {
    for (const input of ['ALL=Doudna', 'ALL=Doudna AND TS=crispr', 'TS=crispr OR ALL=Doudna', 'TS=crispr AND (TS=mouse OR ALL=rat)']) {
      expect({ input, sent: translate(parseQuery(input), { openAccessOnly: true }) }).toEqual({ input, sent: '' });
    }
  });

  it('still sends a query whose ALL= term is only excluded', () => {
    // A record is convicted for having what a NOT excludes, so leaving one out is safe.
    expect(toParams(parseQuery('TS=crispr NOT ALL=cas9')).search).toBe('crispr');
  });
});
