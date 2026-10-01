import { describe, it, expect } from 'vitest';
import { parseExpression } from '@open-access-explorer/shared';
import { fieldSearchHref } from '../entity-search';

/** The query a link would put in the box. */
const queryOf = (href: string | undefined) =>
  new URLSearchParams(href!.slice(href!.indexOf('?'))).get('q');

describe('a name as a link to a search', () => {
  it('searches the author as one phrase, not as words', () => {
    expect(queryOf(fieldSearchHref('author', 'Jennifer A. Doudna'))).toBe('AU="Jennifer A. Doudna"');
  });

  it('searches the venue under SO', () => {
    expect(queryOf(fieldSearchHref('venue', 'Bioinformatics (Oxford, England)')))
      .toBe('SO="Bioinformatics (Oxford, England)"');
  });

  it('parses back to the one clause it was built from', () => {
    // Brackets and commas in a venue are the case a template would get wrong.
    const node = parseExpression(queryOf(fieldSearchHref('venue', 'Bioinformatics (Oxford, England)'))!);
    expect(node).toEqual({
      kind: 'clause',
      field: 'venue',
      value: { kind: 'phrase', text: 'Bioinformatics (Oxford, England)' }
    });
  });

  it('drops a quote rather than ending the phrase on it', () => {
    const query = queryOf(fieldSearchHref('author', 'O"Brien, Pat'));
    expect(query).toBe('AU="OBrien, Pat"');
    expect(() => parseExpression(query!)).not.toThrow();
  });

  it('links nowhere for a name with nothing in it', () => {
    expect(fieldSearchHref('author', '  ')).toBeUndefined();
    expect(fieldSearchHref('author', '""')).toBeUndefined();
  });
});
