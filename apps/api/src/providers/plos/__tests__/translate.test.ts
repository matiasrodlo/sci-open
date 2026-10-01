import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { parseExpression } from '@open-access-explorer/shared';
import { translate } from '../translate';
import { journalName } from '../index';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });

describe('translate', () => {
  it('makes the implicit AND explicit', () => {
    // `everything:` required every term whether the AND was spelled or not —
    // 5,940 hits either way — but only because `everything` is Solr's default
    // field here, so the words after the first landed in it regardless. Scoped,
    // the AND is doing real work.
    expect(translate(query({ terms: ['crispr', 'gene'] })))
      .toBe('((title:crispr OR abstract:crispr OR subject:crispr) AND (title:gene OR abstract:gene OR subject:gene))');
  });

  it('quotes a phrase', () => {
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe('(title:crispr OR abstract:crispr OR subject:crispr) AND (title:"gene editing" OR abstract:"gene editing" OR subject:"gene editing")');
  });

  it('keeps an OR join from swallowing the date clause', () => {
    expect(translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2022, to: 2023 } })))
      .toBe('((title:a OR abstract:a OR subject:a) OR (title:b OR abstract:b OR subject:b)) AND publication_date:[2022-01-01T00:00:00Z TO 2023-12-31T23:59:59Z]');
  });

  it('looks a DOI up by id, because PLOS has no doi field', () => {
    // Measured: `doi:"10.1371/journal.pgen.1002441"` matches 64,432 documents
    // — PLOS accepts the unknown field and returns the corpus rather than
    // erroring — where `id:"..."` matches exactly one. A PLOS id is its DOI.
    expect(translate(query({ doi: '10.1371/journal.pone.0253351' })))
      .toBe('id:"10.1371/journal.pone.0253351"');
  });

  it('invents neither end of an open date range', () => {
    // The old connector defaulted a missing lower bound to the year 2000 and a
    // missing upper bound to the current year, silently excluding anything
    // outside two bounds nobody asked for.
    expect(translate(query({ terms: ['x'], years: { to: 2021 } })))
      .toBe('(title:x OR abstract:x OR subject:x) AND publication_date:[2000-01-01T00:00:00Z TO 2021-12-31T23:59:59Z]');
    expect(translate(query({ terms: ['x'], years: { from: 2024 } })))
      .toBe('(title:x OR abstract:x OR subject:x) AND publication_date:[2024-01-01T00:00:00Z TO 9999-12-31T23:59:59Z]');
  });

  it('emits no date clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'] }))).toBe('(title:x OR abstract:x OR subject:x)');
  });
});

/**
 * PLOS publishes its own full text and indexes it, so `everything:` was
 * reading it — the same thing the OpenAlex `search` parameter does, and the
 * reason both moved. Measured on `crispr gene editing` against the
 * research-article filter: **5,563** through `everything`, **359** in the
 * title or abstract, **361** with `subject` beside them.
 */
describe('translate — the scope of the search', () => {
  it('searches the title, abstract and subject, not the full text', () => {
    const out = translate(query({ terms: ['crispr'] }));
    expect(out).toBe('(title:crispr OR abstract:crispr OR subject:crispr)');
    expect(out).not.toContain('everything');
  });

  it('gives every term its own prefix, because a Solr prefix binds one token', () => {
    // `title:gene editing` matches 7,301 — `gene` scoped, `editing` loose in
    // the default field — where `title:"gene editing"` matches 44. One prefix
    // wrapping the query would scope its first word and nothing else.
    expect(translate(query({ terms: ['gene', 'editing'] }))).toBe(
      '((title:gene OR abstract:gene OR subject:gene) AND ' +
        '(title:editing OR abstract:editing OR subject:editing))'
    );
  });

  it('leaves a DOI lookup on the id field, which is where a PLOS DOI lives', () => {
    expect(translate(query({ doi: '10.1371/journal.pone.0253351' })))
      .toBe('id:"10.1371/journal.pone.0253351"');
  });
});

/**
 * A term carries whatever a reader typed short of whitespace, parentheses and
 * quotes, and none of it was escaped. Measured against api.plos.org on
 * 2026-09-30: `[crispr]`, `crispr{}`, `a:b`, `-crispr`, `+crispr` and `!crispr`
 * all answered HTTP 400, which took PLOS out of the search; escaped, each finds
 * the text it spells.
 */
describe('translate — Solr syntax in a term', () => {
  const scopedTo = (value: string) => `(title:${value} OR abstract:${value} OR subject:${value})`;

  it('escapes what the parser refused', () => {
    const cases: Array<[string, string]> = [
      ['[crispr]', '\\[crispr\\]'],
      ['crispr{}', 'crispr\\{\\}'],
      ['a:b', 'a\\:b'],
      ['-crispr', '\\-crispr'],
      ['+crispr', '\\+crispr'],
      ['!crispr', '\\!crispr']
    ];
    for (const [term, sent] of cases) {
      expect(translate(query({ terms: [term] }))).toBe(scopedTo(sent));
    }
  });

  it('escapes what the parser read as an operator instead of text', () => {
    // A lone backslash escaped the next letter and found nothing; `~` asked
    // for a fuzzy match and `^` for a boost.
    expect(translate(query({ terms: ['a\\b'] }))).toBe(scopedTo('a\\\\b'));
    expect(translate(query({ terms: ['crispr~'] }))).toBe(scopedTo('crispr\\~'));
    expect(translate(query({ terms: ['crispr^2'] }))).toBe(scopedTo('crispr\\^2'));
    expect(translate(query({ terms: ['covid-19'] }))).toBe(scopedTo('covid\\-19'));
  });

  it('asks nothing of a flat query carrying a wildcard, which its stemmed index answers wrongly', () => {
    // Measured on 2026-09-30: `title:generat*` found 1 where `title:generation`
    // found 5,436, and `title:gen?me` nothing.
    expect(translate(query({ terms: ['crispr', 'generat*'] }))).toBe('');
    expect(translate(query({ terms: ['gen?me'] }))).toBe('');
    expect(translate(query({ terms: ['crispr', 'gen*'], join: 'OR' }))).toBe('');
  });

it('leaves out a title wildcard, which the evaluator applies, and asks nothing for a topic one', () => {
    // A title clause `matchesQuery` can check on the records that come back;
    // a topic clause it never convicts on, so leaving one out widens for good.
    expect(translate(query({ expression: parseExpression('TS=crispr AND TI=generat*') }))).toBe(scopedTo('crispr'));
    expect(translate(query({ expression: parseExpression('TS=crispr AND TS=generat*') }))).toBe('');
  });

  it('escapes a backslash inside a phrase, where it is still an escape', () => {
    expect(translate(query({ phrases: ['gene\\editing'] }))).toBe(scopedTo('"gene\\\\editing"'));
  });

  it('asks nothing of a flat query carrying a term with nothing to search for', () => {
    // Escaped, `-` asks for nothing and finds nothing.
    expect(translate(query({ terms: ['crispr', '-'] }))).toBe('');
    expect(translate(query({ terms: ['crispr', '-'], join: 'OR' }))).toBe('');
    expect(translate(query({ terms: ['-'], years: { from: 2020 } }))).toBe('');
  });

  it('escapes a fielded clause as it does a bare term', () => {
    const expression = parseExpression('TI=[crispr] AND AU=Doudna');
    expect(translate(query({ expression }))).toBe('(title:\\[crispr\\] AND author:Doudna)');
  });
});

describe('journalName', () => {
  it('rebuilds the display form Solr’s lower-cased facet loses', () => {
    expect(journalName('plos one')).toBe('PLOS ONE');
    expect(journalName('plos genetics')).toBe('PLOS Genetics');
    expect(journalName('plos neglected tropical diseases')).toBe('PLOS Neglected Tropical Diseases');
    expect(journalName('plos computational biology')).toBe('PLOS Computational Biology');
  });
});

/**
 * PLOS keeps an author's name word by word, and a quoted name matched only the
 * records that wrote it that way round — none, for the phrase a Web of Science
 * author search carries.
 */
describe('translate: an author phrase', () => {
  const q = (input: string) => translate(query({ expression: parseExpression(input) }));

  it('asks for the words of the name beside the phrase', () => {
    // Measured: 0 for the phrase, 93 for the words.
    expect(q('AU="Doudna, Jennifer"')).toBe('(author:"Doudna, Jennifer" OR (author:Doudna AND author:Jennifer))');
    // An initial is left out of the words.
    expect(q('AU="Doudna J"')).toBe('(author:"Doudna J" OR author:Doudna)');
  });

  it('leaves a name already written as its words as it was', () => {
    expect(q('AU=Jennifer AND AU=Doudna')).toBe('(author:Jennifer AND author:Doudna)');
  });
});
