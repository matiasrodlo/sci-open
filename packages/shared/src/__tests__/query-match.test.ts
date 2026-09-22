import { describe, it, expect } from 'vitest';
import type { Paper } from '../paper';
import { parseExpression } from '../query-grammar';
import { evaluateQuery, matchesQuery } from '../query-match';

/**
 * The half of fielded search that is not the grammar.
 *
 * Most providers cannot run the query that was typed — OpenAIRE has no query
 * language, arXiv's negation is a different shape, and no two index the same
 * text under "title" — so the fan-out is deliberately widened and the query is
 * enforced here, over the merged records.
 *
 * Which makes the interesting cases the ones where this must *not* act. It runs
 * after the providers have already applied what they could, so every record it
 * drops is a record something upstream thought was a match, and a false
 * conviction is unrecoverable.
 */

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: 'europepmc:1',
  title: 'CRISPR-Cas9 genome editing in human cells',
  authors: ['Doudna, Jennifer', 'Charpentier, Emmanuelle'],
  topics: [],
  year: 2022,
  venue: 'Nature',
  publisher: 'Springer Nature',
  abstract: 'We describe a method for programmable genome editing.',
  oaStatus: 'gold',
  stage: 'published',
  sources: [],
  fieldSources: {},
  retrievedAt: '2026-08-29T00:00:00.000Z',
  ...over
});

const check = (input: string, over: Partial<Paper> = {}) =>
  evaluateQuery(paper(over), parseExpression(input));

describe('matching a record against a fielded query', () => {
  it('matches a term in the field it is scoped to', () => {
    expect(check('TI=crispr')).toBe(true);
    expect(check('AU=Doudna')).toBe(true);
    expect(check('SO=Nature')).toBe(true);
    expect(check('PU=Springer')).toBe(true);
  });

  it('does not match a term that is in a different field', () => {
    // "Doudna" is an author, not a word in the title.
    expect(check('TI=Doudna')).toBe(false);
    // …and the reverse.
    expect(check('AU=genome')).toBe(false);
  });

  it('requires a phrase to be adjacent and in order', () => {
    expect(check('TI="genome editing"')).toBe(true);
    expect(check('TI="editing genome"')).toBe(false);
  });

  it('matches a phrase across any run of whitespace', () => {
    expect(check('TI="genome editing"', { title: 'Genome   editing' })).toBe(true);
  });

  it('holds a term to word boundaries', () => {
    // The old flat path had no notion of a word, so `gene` matched "genome".
    expect(check('TI=gene')).toBe(false);
    expect(check('TI=genome')).toBe(true);
  });

  it('honours the wildcards', () => {
    expect(check('TI=gen*')).toBe(true);
    expect(check('TI=gen?me')).toBe(true);
  });

  it('keeps a wildcard inside one word', () => {
    // `?` is one more letter and then the end of the word, so it matches
    // "gene" and not "genome"; `*` is the rest of one word, so it does not
    // reach across the space into "gene editing".
    expect(check('TI=gen?', { title: 'gene editing' })).toBe(true);
    expect(check('TI=gen?', { title: 'genome editing' })).toBe(false);
    expect(check('TI=gene*ing', { title: 'gene editing' })).toBe(false);
  });

  it('treats a term with regex characters as text', () => {
    // A search for `C++` is a search for C++, not a pattern nobody typed.
    expect(check('TI=C++', { title: 'Writing C++ well' })).toBe(true);
    expect(check('TI=C++', { title: 'Writing CCC well' })).toBe(false);
  });

  it('compares a year against its range', () => {
    expect(check('PY=2020-2024')).toBe(true);
    expect(check('PY=2023-2024')).toBe(false);
    expect(check('PY=2022')).toBe(true);
  });

  it('compares a DOI whole, not as a prefix', () => {
    const doi = { doi: '10.1038/nature12373' };
    expect(check('DO=10.1038/nature12373', doi)).toBe(true);
    expect(check('DO=10.1038/nature123', doi)).toBe(false);
  });

  it('reads a DOI written as a URL', () => {
    expect(check('DO=https://doi.org/10.1038/nature12373', { doi: '10.1038/nature12373' })).toBe(true);
  });
});

describe('the operators', () => {
  it('requires both sides of an AND', () => {
    expect(check('TI=crispr AND AU=Doudna')).toBe(true);
    expect(check('TI=crispr AND AU=Zhang')).toBe(false);
  });

  it('accepts either side of an OR', () => {
    expect(check('AU=Zhang OR AU=Doudna')).toBe(true);
    expect(check('AU=Zhang OR AU=Church')).toBe(false);
  });

  it('excludes what follows a NOT', () => {
    expect(check('TI=crispr NOT AU=Doudna')).toBe(false);
    expect(check('TI=crispr NOT AU=Zhang')).toBe(true);
  });

  it('groups by parentheses', () => {
    expect(check('AU=Zhang AND (TI=crispr OR TI=cas9)')).toBe(false);
    expect(check('AU=Doudna AND (TI=crispr OR TI=cas9)')).toBe(true);
  });
});

/**
 * The bias that makes this step safe to run at all: it can only remove records,
 * so it removes only the ones it can actually convict.
 */
describe('what it refuses to decide', () => {
  it('cannot judge a field this service did not receive', () => {
    expect(check('AB=anything', { abstract: undefined })).toBe('unknown');
    expect(check('SO=Nature', { venue: undefined })).toBe('unknown');
    expect(check('PY=2020', { year: undefined })).toBe('unknown');
  });

  it('keeps a record it cannot judge', () => {
    expect(matchesQuery(paper({ abstract: undefined }), parseExpression('AB=anything'))).toBe(true);
  });

  /**
   * The one that protects every ordinary keyword search. A provider matches on
   * indexes this service holds no copy of — MeSH headings, keywords-plus, full
   * text, and stemming over all of them — so a topic word absent from the title
   * and abstract we stored is an absence of evidence, not evidence of absence.
   */
  it('does not convict on a topic word it cannot see', () => {
    const noMention = { title: 'Programmable nucleases in therapy', abstract: 'A review.' };
    expect(check('TS=crispr', noMention)).toBe('unknown');
    expect(matchesQuery(paper(noMention), parseExpression('TS=crispr'))).toBe(true);
  });

  it('still convicts on a title word it can see is absent', () => {
    // `title` is complete here in a way `topic` is not, so a miss is an answer.
    expect(check('TI=crispr', { title: 'Programmable nucleases in therapy' })).toBe(false);
  });

  it('propagates unknown through AND', () => {
    expect(check('TI=crispr AND AB=missing', { abstract: undefined })).toBe('unknown');
    // …but a definite failure still settles it.
    expect(check('TI=zebrafish AND AB=missing', { abstract: undefined })).toBe(false);
  });

  it('propagates unknown through OR', () => {
    expect(check('TI=zebrafish OR AB=missing', { abstract: undefined })).toBe('unknown');
    // …and a definite success still settles it.
    expect(check('TI=crispr OR AB=missing', { abstract: undefined })).toBe(true);
  });

  it('keeps unknown unknown under NOT, rather than flipping it to a match', () => {
    expect(check('NOT AB=missing', { abstract: undefined })).toBe('unknown');
  });
});
