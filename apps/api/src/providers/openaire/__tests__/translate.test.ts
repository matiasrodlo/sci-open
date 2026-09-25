import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate, toParams } from '../translate';

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
