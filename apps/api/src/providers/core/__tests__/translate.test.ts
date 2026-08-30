import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate } from '../translate';
import { capabilities } from '../capabilities';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate — the OR defect', () => {
  it('requires every term rather than any of them', () => {
    // Measured: `crispr gene editing` returns 2,126,594 where
    // `crispr AND gene AND editing` returns 13,323. More words, more results.
    expect(translate(query({ terms: ['crispr', 'gene', 'editing'] })))
      .toBe('(crispr AND gene AND editing)');
  });

  it('leaves a single term alone', () => {
    expect(translate(query({ terms: ['crispr'] }))).toBe('crispr');
  });
});

describe('translate — phrases, which CORE cannot express', () => {
  it('degrades a phrase to its words instead of quoting it', () => {
    // A bare quoted phrase makes CORE answer HTTP 500, and scoping it to a
    // field does not honour the quotes either: `title:"gene editing"` returns
    // 635,878. Requiring the words is the closest thing available.
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe('(crispr AND gene AND editing)');
  });

  it('never emits a quoted phrase', () => {
    const out = translate(query({ phrases: ['gene editing', 'base editor'] }));
    expect(out).not.toContain('"');
  });
});

describe('translate — year bounds', () => {
  it('puts the bounds in the query, not in a filters parameter', () => {
    // The old connector sent `filters=yearPublished:>=2022`, which CORE
    // ignores — the bounded and unbounded counts were identical at 60,460.
    expect(translate(query({ terms: ['crispr'], years: { from: 2022, to: 2023 } })))
      .toBe('crispr AND yearPublished>=2022 AND yearPublished<=2023');
  });

  it('fills an open end rather than omitting a bound', () => {
    expect(translate(query({ terms: ['x'], years: { from: 2022 } })))
      .toBe('x AND yearPublished>=2022 AND yearPublished<=9999');
    expect(translate(query({ terms: ['x'], years: { to: 2023 } })))
      .toBe('x AND yearPublished>=1000 AND yearPublished<=2023');
  });

  it('emits no year clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'] }))).toBe('x');
  });
});

describe('translate — DOI', () => {
  it('looks a DOI up by DOI', () => {
    expect(translate(query({ doi: '10.1038/srep09811' }))).toBe('doi:"10.1038/srep09811"');
  });
});

describe('capabilities — declared from measurement', () => {
  it('does not claim citations, which CORE reports as zero', () => {
    expect(capabilities.suppliesCitations).toBe(false);
  });

  it('caps the page at what was verified to return', () => {
    // 25 came back in 35.6s; 50 failed and 100 timed out at 90s.
    expect(capabilities.maxPageSize).toBe(25);
  });
});
