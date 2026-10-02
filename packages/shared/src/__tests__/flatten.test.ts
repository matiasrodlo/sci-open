import { describe, it, expect } from 'vitest';
import type { Paper } from '../paper';
import type { QueryField, QueryNode, QueryValue } from '../query';
import { flatten } from '../query-grammar';
import { evaluateQuery } from '../query-match';

/**
 * `flatten`'s one promise: what it returns describes a superset of what the
 * tree matches. A provider reading only the flat form is asked for it, and the
 * records it does not return cannot be recovered downstream — so a flat form
 * narrower than the tree loses papers silently.
 *
 * It broke on an `or` with a branch body text cannot stand in for:
 * `TS=crispr OR AU=Doudna` flattened to `crispr`. These trees are random, the
 * papers are random, and the check is the promise itself — a paper the tree
 * matches must be matched by the flat form, read as body text.
 */

// Seeded, so a failure names a case that reproduces.
let seed = 20260930;
const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

const WORDS = ['alpha', 'beta', 'gamma', 'delta'] as const;

/**
 * No `topics` on the papers: a topic term reaches keywords as well as body
 * text, so a match through one would fail the check for a reason other than the
 * one under test.
 *
 * `all` is generated, and it is the case that broke the promise: it reaches
 * authors, venues and publishers too, so flattening `ALL=Doudna` into the body
 * text missed every paper Doudna wrote that does not say "Doudna". This test
 * failed as soon as `all` was added here, until `all` stopped being flattened.
 */
const FIELDS: readonly QueryField[] = ['topic', 'title', 'abstract', 'author', 'venue', 'publisher', 'year', 'all'];

function value(field: QueryField): QueryValue {
  if (field === 'year') {
    const from = 2019 + Math.floor(random() * 3);
    return { kind: 'years', range: { from, to: from + Math.floor(random() * 2) } };
  }
  return random() < 0.25
    ? { kind: 'phrase', text: `${pick(WORDS)} ${pick(WORDS)}` }
    : { kind: 'term', text: pick(WORDS) };
}

function tree(depth: number): QueryNode {
  const roll = random();
  if (depth === 0 || roll < 0.35) {
    const field = pick(FIELDS);
    return { kind: 'clause', field, value: value(field) };
  }
  if (roll < 0.45) return { kind: 'not', node: tree(depth - 1) };
  const nodes = Array.from({ length: 2 + Math.floor(random() * 2) }, () => tree(depth - 1));
  return { kind: roll < 0.72 ? 'and' : 'or', nodes };
}

const sentence = () => Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(WORDS)).join(' ');

function paper(): Paper {
  return {
    id: 'x:1',
    title: sentence(),
    ...(random() < 0.8 ? { abstract: sentence() } : {}),
    authors: [pick(WORDS)],
    topics: [],
    venue: pick(WORDS),
    publisher: pick(WORDS),
    year: 2019 + Math.floor(random() * 4),
    oaStatus: 'gold',
    stage: 'published',
    sources: [],
    fieldSources: {},
    retrievedAt: '2026-09-30T00:00:00.000Z'
  };
}

/** The flat form as a provider reads it: each value in the title or the abstract, joined as flattened. */
function asBodyText(flat: ReturnType<typeof flatten>): QueryNode {
  const values: QueryValue[] = [
    ...flat.terms.map(text => ({ kind: 'term' as const, text })),
    ...flat.phrases.map(text => ({ kind: 'phrase' as const, text }))
  ];
  const nodes = values.map((v): QueryNode => ({
    kind: 'or',
    nodes: [{ kind: 'clause', field: 'title', value: v }, { kind: 'clause', field: 'abstract', value: v }]
  }));
  return { kind: flat.join === 'AND' ? 'and' : 'or', nodes };
}

describe('flatten', () => {
  it('never describes less than the tree matches', () => {
    let checked = 0;
    let unflattenable = 0;

    for (let i = 0; i < 3000; i++) {
      const query = tree(3);
      const flat = flatten(query);

      // Nothing to search for: the provider is not asked, which narrows nothing.
      if (flat.terms.length === 0 && flat.phrases.length === 0) {
        unflattenable++;
        continue;
      }

      const body = asBodyText(flat);
      for (let j = 0; j < 8; j++) {
        const record = paper();
        if (evaluateQuery(record, query) !== true) continue;
        checked++;
        // A paper with no abstract cannot be judged on one: `unknown` is not a miss.
        expect({ query, record, flat: evaluateQuery(record, body) !== false }).toEqual({ query, record, flat: true });
      }
    }

    // Not vacuous: plenty of matches were checked, and some trees could not be flattened.
    expect(checked).toBeGreaterThan(1000);
    expect(unflattenable).toBeGreaterThan(100);
  });

  it('flattens an OR with an alternative body text cannot stand in for to nothing', () => {
    const or = (...nodes: QueryNode[]): QueryNode => ({ kind: 'or', nodes });
    const clause = (field: QueryField, text: string): QueryNode => ({ kind: 'clause', field, value: { kind: 'term', text } });

    // Was `crispr`, which dropped the author's other papers.
    expect(flatten(or(clause('topic', 'crispr'), clause('author', 'Doudna')))).toMatchObject({ terms: [], phrases: [] });
    expect(flatten(or(clause('topic', 'crispr'), { kind: 'not', node: clause('topic', 'cas9') }))).toMatchObject({ terms: [] });
    // Every alternative covered: still the OR of them.
    expect(flatten(or(clause('topic', 'crispr'), { kind: 'and', nodes: [clause('topic', 'cas9'), clause('author', 'Doudna')] })))
      .toEqual({ terms: ['crispr', 'cas9'], phrases: [], join: 'OR' });
  });

  it('does not flatten ALL=, which reaches authors and venues as well as the body text', () => {
    const clause = (field: QueryField, text: string): QueryNode => ({ kind: 'clause', field, value: { kind: 'term', text } });

    // Was `Doudna` in the body text: every paper she wrote without her name in it, missed.
    expect(flatten(clause('all', 'Doudna'))).toMatchObject({ terms: [], phrases: [] });
    // Required beside a topic term, it is left out of the flat form like an author would be.
    expect(flatten({ kind: 'and', nodes: [clause('all', 'Doudna'), clause('topic', 'crispr')] }))
      .toMatchObject({ terms: ['crispr'], join: 'AND' });
    // An alternative it cannot stand in for leaves the OR with nothing to flatten.
    expect(flatten({ kind: 'or', nodes: [clause('topic', 'crispr'), clause('all', 'Doudna')] }))
      .toMatchObject({ terms: [], phrases: [] });
  });
});
