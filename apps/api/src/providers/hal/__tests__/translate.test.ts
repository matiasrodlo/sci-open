import { describe, it, expect } from 'vitest';
import type { Query } from '@open-access-explorer/shared';
import { parseExpression } from '@open-access-explorer/shared';
import { translate, translateId } from '../translate';

const query = (over: Partial<Query>): Query => ({ terms: [], phrases: [], join: 'AND', ...over });
const parsed = (text: string): Query => query({ expression: parseExpression(text) });

const TOPIC = (value: string) => `(title_t:${value} OR abstract_t:${value} OR keyword_t:${value})`;

describe('translate', () => {
  it('scopes every term to the title, abstract and keywords, and ANDs them', () => {
    // A Solr prefix binds one token, so each term carries its own.
    expect(translate(query({ terms: ['crispr', 'gene'] }))).toBe(`(${TOPIC('crispr')} AND ${TOPIC('gene')})`);
  });

  it('quotes a phrase', () => {
    expect(translate(query({ terms: ['crispr'], phrases: ['gene editing'] })))
      .toBe(`${TOPIC('crispr')} AND ${TOPIC('"gene editing"')}`);
  });

  it('keeps an OR join from swallowing the year clause', () => {
    expect(translate(query({ terms: ['a', 'b'], join: 'OR', years: { from: 2022, to: 2023 } })))
      .toBe(`(${TOPIC('a')} OR ${TOPIC('b')}) AND producedDateY_i:[2022 TO 2023]`);
  });

  it('leaves an open end of a year range open', () => {
    expect(translate(query({ terms: ['x'], years: { to: 2021 } }))).toBe(`${TOPIC('x')} AND producedDateY_i:[* TO 2021]`);
    expect(translate(query({ terms: ['x'], years: { from: 2024 } }))).toBe(`${TOPIC('x')} AND producedDateY_i:[2024 TO *]`);
  });

  it('emits no year clause when neither bound is set', () => {
    expect(translate(query({ terms: ['x'] }))).toBe(TOPIC('x'));
  });

  it('asks nothing when there is nothing to search for', () => {
    // A year range alone would ask for everything deposited in it.
    expect(translate(query({ years: { from: 2020 } }))).toBe('');
  });
});

describe('translate — a DOI', () => {
  it('looks it up on the DOI field, matched whole', () => {
    expect(translate(query({ doi: '10.1016/S0140-6736(20)30183-5' }))).toBe('doiId_s:"10.1016/S0140-6736(20)30183-5"');
  });

  it('asks for no stage alongside a DOI, which names one work', () => {
    expect(translate(query({ doi: '10.1/x', stages: ['preprint'] }))).toBe('doiId_s:"10.1/x"');
  });
});

describe('translateId', () => {
  it('asks for the record on its id field rather than as a search word', () => {
    expect(translateId('inserm-03121840')).toBe('halId_s:"inserm-03121840"');
  });
});

describe('translate — the stages asked for', () => {
  it('asks for HAL’s preprint type alone', () => {
    expect(translate(query({ terms: ['x'], stages: ['preprint'] }))).toBe(`${TOPIC('x')} AND docType_s:(UNDEFINED)`);
  });

  it('asks for the published types alone', () => {
    expect(translate(query({ terms: ['x'], stages: ['published'] })))
      .toBe(`${TOPIC('x')} AND docType_s:(ART OR COMM OR COUV OR OUV OR REPORT)`);
  });

  it('asks for no type when every type read is wanted', () => {
    expect(translate(query({ terms: ['x'], stages: ['preprint', 'published'] }))).toBe(TOPIC('x'));
  });

  it('asks nothing for a stage HAL holds none of', () => {
    expect(translate(query({ terms: ['x'], stages: ['accepted'] }))).toBe('');
  });
});

describe('translate — Solr syntax in a term', () => {
  it('escapes what HAL’s parser refused', () => {
    // `[crispr]`, `crispr{}`, `a:b` and `-crispr` all answered with an error
    // body; escaped, `\[crispr\]` and `\-crispr` found the 804 `crispr` did.
    expect(translate(query({ terms: ['[crispr]'] }))).toBe(TOPIC('\\[crispr\\]'));
    expect(translate(query({ terms: ['a:b'] }))).toBe(TOPIC('a\\:b'));
    expect(translate(query({ terms: ['-crispr'] }))).toBe(TOPIC('\\-crispr'));
  });

  it('escapes what the parser would read as a fuzzy search', () => {
    // `crispr~` found 11,762 against `crispr`'s 804.
    expect(translate(query({ terms: ['crispr~'] }))).toBe(TOPIC('crispr\\~'));
  });

  it('escapes a backslash inside a phrase, where it is still an escape', () => {
    expect(translate(query({ phrases: ['a\\b'] }))).toBe(TOPIC('"a\\\\b"'));
  });

  it('asks nothing of a flat query carrying a term with nothing to search for', () => {
    expect(translate(query({ terms: ['crispr', '-'] }))).toBe('');
  });
});

describe('translate — wildcards', () => {
  it('passes a wildcard through, since HAL’s index is not stemmed', () => {
    // `generat*`, `Generat*` and `GENERAT*` each found 33,295; `gen?me` 8,893
    // against `genome`'s 8,892.
    expect(translate(query({ terms: ['generat*'] }))).toBe(TOPIC('generat*'));
    expect(translate(query({ terms: ['gen?me'] }))).toBe(TOPIC('gen?me'));
  });

  it('passes one through with accents and a leading wildcard', () => {
    expect(translate(query({ terms: ['écolog*'] }))).toBe(TOPIC('écolog*'));
    expect(translate(query({ terms: ['*ology'] }))).toBe(TOPIC('*ology'));
  });

  it('asks nothing of a flat query with a wildcard on a term HAL splits', () => {
    // `covid-19*` found 13,750 against `covid-19`'s 15,039: fewer, from a
    // pattern that can only ever mean more.
    expect(translate(query({ terms: ['covid-19*'] }))).toBe('');
  });

  it('asks nothing of a lone wildcard', () => {
    expect(translate(query({ terms: ['*'] }))).toBe('');
  });

  it('takes the wildcards out of a phrase, where HAL matches nothing', () => {
    // `title_t:"gene edit*"` found 0.
    expect(translate(query({ phrases: ['gene edit*'] }))).toBe(TOPIC('"gene edit"'));
  });
});

describe('translate — a parsed query', () => {
  it('scopes a fielded clause to its own field', () => {
    expect(translate(parsed('TI=crispr'))).toBe('title_t:crispr');
    expect(translate(parsed('AB=crispr'))).toBe('abstract_t:crispr');
  });

  it('asks the journal, conference and book for a venue', () => {
    expect(translate(parsed('SO=nature'))).toBe('(journalTitle_t:nature OR conferenceTitle_t:nature OR bookTitle_t:nature)');
  });

  it('asks the journal’s and the book’s publisher for a publisher', () => {
    expect(translate(parsed('PU=elsevier'))).toBe('(journalPublisher_t:elsevier OR publisher_t:elsevier)');
  });

  it('negates with NOT', () => {
    expect(translate(parsed('TI=crispr NOT TI=plant'))).toBe('(title_t:crispr AND NOT (title_t:plant))');
  });

  it('asks for an author phrase as the words of the name too', () => {
    // HAL keeps a name as its words, forename first: `"Cédric Villani"` found
    // 12, the words 13, `"Villani Cédric"` none.
    expect(translate(parsed('AU="Villani, Cédric"')))
      .toBe('(authFullName_t:"Villani, Cédric" OR (authFullName_t:Villani AND authFullName_t:Cédric))');
  });

  it('searches every named field for ALL=', () => {
    const native = translate(parsed('ALL=crispr'));
    for (const field of ['title_t', 'abstract_t', 'keyword_t', 'authFullName_t', 'journalTitle_t', 'publisher_t']) {
      expect(native).toContain(`${field}:crispr`);
    }
  });
});
