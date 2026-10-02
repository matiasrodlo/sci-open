import { describe, it, expect } from 'vitest';
import { parseExpression, type QueryField } from '@open-access-explorer/shared';
import { cannotSend, dropsForGood, flatStatesWhole, flatTerms, nameAsWords, renderExpression, type Dialect } from '../render-query';

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

  it('blocks the provider when an OR it cannot send whole holds a topic term', () => {
    // The OR is left out entirely, and with it the topic branch `matchesQuery`
    // never convicts on. Measured on 2026-10-01: `crispr AND (mouse OR rat)`
    // asked as `crispr` came back 2% and 9% papers mentioning either animal.
    expect(blocked('TS=crispr AND (TS=mouse OR TI=gen*)')).toBe(true);
    // An OR of fields it does apply can still be left out.
    expect(blocked('TS=crispr AND (TI=mouse OR TI=gen*)')).toBe(false);
  });

  it('drops a whole negated group rather than part of it, which would narrow', () => {
    // `NOT (a)` would exclude every `a` record, including those without the
    // wildcard that the query keeps.
    expect(renderExpression(parseExpression('TS=x NOT (TI=a AND TI=gen*)'), noWildcards)).toBe('(TI:x OR AB:x)');
    expect(renderExpression(parseExpression('TS=x NOT (TI=a AND TI=b)'), noWildcards))
      .toBe('((TI:x OR AB:x) AND NOT ((TI:a AND TI:b)))');
  });
});

/**
 * An index that keeps authors as names, where each word of a name on its own
 * finds nothing. The words are sent as a name too — beside the literal
 * clauses, never instead of them, which is what keeps it a widening.
 */
describe('sending the words of a name as a name', () => {
  const named = { authorName: (words: readonly string[]) => `NAME:"${words.join(' ')}"` };

  it('ORs the name with the words, so whatever they matched they still match', () => {
    expect(render('AU=Jennifer AND AU=Doudna', named))
      .toBe('((AU:Jennifer AND AU:Doudna) OR NAME:"Jennifer Doudna")');
  });

  it('keeps the rest of the query required beside it', () => {
    expect(render('TS=crispr AND AU=Jennifer AND AU=Doudna', named))
      .toBe('(((AU:Jennifer AND AU:Doudna) OR NAME:"Jennifer Doudna") AND (TI:crispr OR AB:crispr))');
  });

  it('treats an author phrase as a name, without its commas', () => {
    expect(render('AU="Doudna, Jennifer"', named)).toBe('(AU:"Doudna, Jennifer" OR NAME:"Doudna Jennifer")');
  });

  it('does not repeat a name that is already the literal clause', () => {
    const same = { phrase: (text: string) => `"${text}"`, authorName: (words: readonly string[]) => `AU:"${words.join(' ')}"` };
    expect(render('AU="Jennifer Doudna"', same)).toBe('AU:"Jennifer Doudna"');
  });

  it('never widens under a NOT, where it would narrow the query', () => {
    expect(render('TS=x NOT (AU=Jennifer AND AU=Doudna)', named)).not.toContain('NAME:');
    expect(render('TS=x NOT AU="Jennifer Doudna"', named)).not.toContain('NAME:');
  });

  it('leaves a single word, and a wildcard, as clauses of their own', () => {
    expect(render('AU=Doudna', named)).toBe('AU:Doudna');
    expect(render('AU=Jennifer AND AU=Doud*', named)).toBe('(AU:Jennifer AND AU:Doud*)');
  });

  it('can say a name as its words, without the initials, for an index that has no names', () => {
    const words = { authorName: (w: readonly string[]) => nameAsWords(w, dialect()) };
    expect(render('AU="Doudna, Jennifer A."', words)).toBe('(AU:"Doudna, Jennifer A." OR (AU:Doudna AND AU:Jennifer))');
    expect(nameAsWords(['J.', 'A.'], dialect())).toBeUndefined();
  });

  it('sends the words alone where the dialect cannot say the name, or has no way to', () => {
    expect(render('AU=Jennifer AND AU=Doudna', { authorName: () => undefined })).toBe('(AU:Jennifer AND AU:Doudna)');
    expect(render('AU=Jennifer AND AU=Doudna')).toBe('(AU:Jennifer AND AU:Doudna)');
  });
});

describe('dropsForGood', () => {
  const forGood = (input: string) => dropsForGood(parseExpression(input));

  it('is true of a part holding a topic or ALL= term, whose absence is never convicted', () => {
    expect(forGood('TS=mouse')).toBe(true);
    expect(forGood('ALL=mouse')).toBe(true);
    expect(forGood('TI=mouse OR TS=rat')).toBe(true);
  });

  it('is false of a part on fields the evaluator applies, and of a negated topic term', () => {
    expect(forGood('TI=mouse OR AU=Smith')).toBe(false);
    expect(forGood('NOT TS=mouse')).toBe(false);
  });

  it('is true again under a double negation', () => {
    expect(forGood('NOT (TI=a NOT TS=b)')).toBe(true);
  });
});

describe('flatStatesWhole', () => {
  const whole = (input: string) => flatStatesWhole(parseExpression(input));

  it('is true of a clause, an AND of clauses and NOTs, and an OR of clauses', () => {
    expect(whole('crispr')).toBe(true);
    expect(whole('crispr cas9')).toBe(true);
    expect(whole('crispr NOT cas9')).toBe(true);
    expect(whole('crispr OR cas9')).toBe(true);
  });

  it('is false of anything nested, whose inner structure the flat form loses', () => {
    expect(whole('crispr AND (mouse OR rat)')).toBe(false);
    expect(whole('(a AND b) OR c')).toBe(false);
  });
});

describe('a provider with no wider index to ask', () => {
  it('leaves a clause out when `unscoped` declines it', () => {
    const narrow = dialect({ unscoped: () => undefined });
    // `PU=` has no field here, and searching the name as words would be narrower.
    expect(renderExpression(parseExpression('TS=crispr AND PU=Elsevier'), narrow)).toBe('(TI:crispr OR AB:crispr)');
  });
});
