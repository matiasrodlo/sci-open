import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { translate, toParams } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('toParams', () => {
  it('joins the words, since OpenAIRE has no query language to say more with', () => {
    expect(toParams(query({ terms: ['crispr', 'gene'], phrases: ['gene editing'] })).keywords)
      .toBe('crispr gene gene editing');
  });

  it('sends a DOI through the DOI parameter, not the keywords', () => {
    // There *is* a DOI field, and it matters: as free text the slash is an
    // operator to OpenAIRE's parser and the request answers HTTP 409.
    expect(toParams(query({ doi: '10.1/x' })).doi).toBe('10.1/x');
  });

  it('takes the year bounds as request parameters rather than query terms', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2022, to: 2023 } }));
    expect(params.fromDateAccepted).toBe('2022-01-01');
    expect(params.toDateAccepted).toBe('2023-12-31');
  });

  it('omits a bound that was not asked for', () => {
    const params = toParams(query({ terms: ['x'], years: { from: 2024 } }));
    expect(params.fromDateAccepted).toBe('2024-01-01');
    expect(params.toDateAccepted).toBeUndefined();
  });

  it('asks for open access only when told to', () => {
    expect(toParams(query({ terms: ['x'] }), { openAccessOnly: true }).OA).toBe('true');
    expect(toParams(query({ terms: ['x'] })).OA).toBeUndefined();
  });
});

describe('translate — the cache key', () => {
  it('carries the year bounds, so a bounded search cannot be served from an unbounded one', () => {
    // The orchestrator keys the provider cache on this string. Leaving the
    // bounds out would make two different searches collide.
    const unbounded = translate(query({ terms: ['crispr'] }));
    const bounded = translate(query({ terms: ['crispr'], years: { from: 2022, to: 2023 } }));
    expect(bounded).not.toBe(unbounded);
    expect(bounded).toContain('fromDateAccepted=2022-01-01');
  });

  it('distinguishes an open-access search from an unrestricted one', () => {
    expect(translate(query({ terms: ['crispr'] }), { openAccessOnly: true }))
      .not.toBe(translate(query({ terms: ['crispr'] })));
  });

  it('serialises the same search identically every time', () => {
    const q = query({ terms: ['crispr'], years: { from: 2022 } });
    expect(translate(q, { openAccessOnly: true })).toBe(translate(q, { openAccessOnly: true }));
    expect(translate(q, { openAccessOnly: true })).toBe('OA=true&fromDateAccepted=2022-01-01&keywords=crispr');
  });
});

describe('toParams — a DOI is not free text', () => {
  it('uses the doi parameter rather than keywords', () => {
    // Sent as `keywords`, the slash is an operator to OpenAIRE's query parser:
    // HTTP 409, "Syntax errors. expected boolean, got '/'". Every OpenAIRE DOI
    // lookup answered that way.
    const params = toParams(query({ doi: '10.1101/2025.10.27.684732' }));
    expect(params.doi).toBe('10.1101/2025.10.27.684732');
    expect(params.keywords).toBeUndefined();
  });

  it('keeps a DOI lookup distinct from the same string searched as words', () => {
    expect(translate(query({ doi: '10.1101/x' }))).not.toBe(translate(query({ terms: ['10.1101/x'] })));
  });

  it('still applies the access and date bounds to a DOI lookup', () => {
    const params = toParams(query({ doi: '10.1101/x', years: { from: 2022 } }), { openAccessOnly: true });
    expect(params.OA).toBe('true');
    expect(params.fromDateAccepted).toBe('2022-01-01');
  });
});
