import { describe, it, expect } from 'vitest';
import { parseExpression, type QueryField } from '@open-access-explorer/shared';
import { cannotSend, flatTerms, renderExpression, type Dialect } from '../render-query';

/**
 * The walk that turns a parsed query into one provider's syntax, and the one
 * rule it has to keep: **it may only ever widen**.
 *
 * A provider that cannot express part of a query reads more records than the
 * query asked for, and `matchesQuery` narrows the merged set afterwards. The
 * reverse is unrecoverable — the orchestrator can filter a record a provider
 * returned and cannot conjure one it did not — so the cases below are mostly
 * about what happens when a dialect *cannot* say something.
 */

/** A deliberately partial provider: no publisher index, no negation. */
const FIELDS: Partial<Record<QueryField, readonly string[]>> = {
  topic: ['TI', 'AB'],
  title: ['TI'],
  abstract: ['AB'],
  author: ['AU'],
  venue: ['SO']
};

const dialect = (over: Partial<Dialect> = {}): Dialect => ({
  fields: field => FIELDS[field] ?? [],
  scope: (field, value) => `${field}:${value}`,
  term: text => text.trim(),
  phrase: text => `"${text}"`,
  years: ({ from, to }) => `YEAR:[${from ?? '*'} TO ${to ?? '*'}]`,
  doi: value => `DOI:"${value}"`,
  unscoped: value => `ANY:${value}`,
  supportsNot: true,
  ...over
});

const render = (input: string, over: Partial<Dialect> = {}) =>
  renderExpression(parseExpression(input), dialect(over));

describe('rendering a query into a provider dialect', () => {
  it('scopes a clause to the provider\'s own field name', () => {
    expect(render('AU=Doudna')).toBe('AU:Doudna');
  });

  it('ORs a concept that spans several native fields', () => {
    expect(render('crispr')).toBe('(TI:crispr OR AB:crispr)');
  });

  it('quotes a phrase the way the provider does', () => {
    expect(render('TI="gene editing"')).toBe('TI:"gene editing"');
  });

  it('keeps AND, OR and NOT, bracketed so precedence survives', () => {
    expect(render('TI=a AND AU=b')).toBe('(TI:a AND AU:b)');
    expect(render('TI=a OR AU=b')).toBe('(TI:a OR AU:b)');
    expect(render('TI=a NOT AU=b')).toBe('(TI:a AND NOT (AU:b))');
  });

  it('renders a year bound and a DOI in the provider\'s syntax', () => {
    expect(render('PY=2020-2024')).toBe('YEAR:[2020 TO 2024]');
    expect(render('DO=10.1/x')).toBe('DOI:"10.1/x"');
  });
});

describe('what a provider cannot express', () => {
  it('widens a concept it has no field for, rather than dropping the clause', () => {
    // No publisher index here, so the term goes to the whole index. Wider than
    // `PU=` asks for, which the local evaluator then narrows.
    expect(render('PU=Elsevier')).toBe('ANY:Elsevier');
  });

  it('drops a NOT it cannot express, which widens', () => {
    // `TI=a NOT AU=b` becomes `TI=a`: more records, not fewer.
    expect(render('TI=a NOT AU=b', { supportsNot: false })).toBe('TI:a');
  });

  it('drops only the unrenderable child of an AND', () => {
    expect(render('TI=a AND PY=2020', { years: () => undefined })).toBe('TI:a');
  });

  /**
   * The asymmetry worth stating, and the reason `or` is all-or-nothing.
   *
   * Dropping a branch of an `AND` removes a requirement, so the provider
   * returns a superset. Dropping a branch of an `OR` removes an *alternative* —
   * the records that matched only that branch are never fetched, and nothing
   * downstream can recover them. So the whole `OR` is dropped instead, and the
   * requirement it represented is left entirely to the evaluator.
   */
  it('drops a whole OR when any branch is unrenderable', () => {
    expect(render('TI=a OR PY=2020', { years: () => undefined })).toBeUndefined();
  });

  it('drops the OR but keeps the AND around it', () => {
    expect(render('AU=b AND (TI=a OR PY=2020)', { years: () => undefined })).toBe('AU:b');
  });

  it('returns nothing when none of the query can be expressed', () => {
    // The caller falls back to the flat `terms`/`phrases` — the query this
    // provider would have received before the grammar existed.
    expect(render('PY=2020', { years: () => undefined })).toBeUndefined();
  });
});

describe('flatTerms', () => {
  const flat = (terms: string[], join: 'AND' | 'OR' = 'AND') => ({ terms, phrases: [], join });
  const noWildcards = (term: string) => (/[*?]/.test(term) ? '' : term);

  it('sends nothing when a term cannot be sent, since the flat form cannot say it was safe to leave out', () => {
    expect(flatTerms(flat(['crispr', 'gen*', 'cas9']), noWildcards)).toBeUndefined();
    expect(flatTerms(flat(['crispr', 'cas9']), noWildcards)).toEqual(['crispr', 'cas9']);
  });

  it('sends nothing of an OR with a term left out, since that narrows it', () => {
    expect(flatTerms(flat(['crispr', 'gen*'], 'OR'), noWildcards)).toBeUndefined();
    expect(flatTerms(flat(['crispr', 'cas9'], 'OR'), noWildcards)).toEqual(['crispr', 'cas9']);
  });

  it('sends terms in the form the provider needs', () => {
    expect(flatTerms(flat([' gen?me ']), term => term.replace(/\?/g, '*'))).toEqual(['gen*me']);
  });
});

/**
 * Leaving a term out widens the query, and that is safe only where
 * `matchesQuery` applies the term to what comes back. It convicts a record
 * lacking a title, abstract, author, venue or publisher clause; it never
 * convicts one lacking a topic or `all` term. Measured on 2026-09-30:
 * `TS=crispr AND TS=*generation`, with the wildcard left out, came back 30%
 * papers containing it.
 */
describe('a term the provider cannot send', () => {
  const noWildcards = dialect({ term: text => (/[*?]/.test(text) ? '' : text.trim()) });
  const blocked = (input: string) => cannotSend(parseExpression(input), noWildcards);

  it('is left out of a clause the evaluator can apply afterwards', () => {
    expect(blocked('TS=crispr AND TI=gen*')).toBe(false);
    expect(renderExpression(parseExpression('TS=crispr AND TI=gen*'), noWildcards)).toBe('(TI:crispr OR AB:crispr)');
  });

  it('blocks the provider when it is a topic or all term the query requires', () => {
    expect(blocked('TS=crispr AND TS=gen*')).toBe(true);
    expect(blocked('crispr gen*')).toBe(true);
    expect(blocked('ALL=gen* AND TI=crispr')).toBe(true);
    expect(blocked('TS=crispr OR TS=gen*')).toBe(true);
  });

  it('does not block it under a NOT, where leaving the term out widens and presence still convicts', () => {
    expect(blocked('TS=crispr NOT TS=gen*')).toBe(false);
    // Negated twice, it is required again.
    expect(blocked('TS=crispr NOT (TS=a NOT TS=gen*)')).toBe(true);
  });

  it('drops a whole negated group rather than part of it, which would narrow', () => {
    // `NOT (a)` would exclude every `a` record, including those without the
    // wildcard that the query keeps.
    expect(renderExpression(parseExpression('TS=x NOT (TI=a AND TI=gen*)'), noWildcards)).toBe('(TI:x OR AB:x)');
    expect(renderExpression(parseExpression('TS=x NOT (TI=a AND TI=b)'), noWildcards))
      .toBe('((TI:x OR AB:x) AND NOT ((TI:a AND TI:b)))');
  });
});
