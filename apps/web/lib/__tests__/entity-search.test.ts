import { describe, it, expect } from 'vitest';
import { matchesQuery, parseExpression, type Paper } from '@open-access-explorer/shared';
import { fieldSearchHref } from '../entity-search';

/**
 * The property a name's link has to have is that it finds the paper it was
 * clicked on — and the same person's papers from every other source. The first
 * version of these links only checked that the query parsed, and shipped a
 * venue link that found nothing and an author link that found a fraction.
 */

/** The query a link would put in the box. */
const queryOf = (href: string | undefined) =>
  new URLSearchParams(href!.slice(href!.indexOf('?'))).get('q')!;

const paper = (over: Partial<Paper>): Paper => ({
  id: 'x:1',
  title: 'A paper',
  authors: [],
  topics: [],
  oaStatus: 'gold',
  stage: 'published',
  sources: [],
  fieldSources: {},
  retrievedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

/** Whether the link built from `name` keeps a record with these authors. */
const authorLinkFinds = (name: string, authors: string[]) =>
  matchesQuery(paper({ authors }), parseExpression(queryOf(fieldSearchHref('author', name))));

const venueLinkFinds = (name: string, venue: string) =>
  matchesQuery(paper({ venue }), parseExpression(queryOf(fieldSearchHref('venue', name))));

/** One author as four sources write her: OpenAlex, PubMed, bioRxiv, Crossref. */
const SPELLINGS = ['Jennifer A. Doudna', 'Doudna Jennifer A', 'Doudna, Jennifer', 'Jennifer Doudna'];

describe('an author as a link to a search', () => {
  it('finds the author however the source spelled the name', () => {
    for (const clicked of SPELLINGS) {
      for (const recorded of SPELLINGS) {
        expect(authorLinkFinds(clicked, [recorded]), `${clicked} -> ${recorded}`).toBe(true);
      }
    }
  });

  it('quotes the name, leaving out initials beside a written-out forename', () => {
    expect(queryOf(fieldSearchHref('author', 'Jennifer A. Doudna'))).toBe('AU="Jennifer Doudna"');
    // No space after the comma, as one source writes it.
    expect(queryOf(fieldSearchHref('author', 'Crom-Ottens,Astrid F.'))).toBe('AU="Crom-Ottens Astrid"');
  });

  it('keeps the first initial where it is all the name has besides the surname', () => {
    expect(queryOf(fieldSearchHref('author', 'Forstmann, B.U.'))).toBe('AU="Forstmann B"');
    expect(queryOf(fieldSearchHref('author', 'J. Doudna'))).toBe('AU="Doudna J"');
    expect(authorLinkFinds('J. Doudna', ['Jennifer A. Doudna'])).toBe(true);
    expect(authorLinkFinds('J. Doudna', ['Samuel Doudna'])).toBe(false);
  });

  it('does not find a different person who shares a surname', () => {
    expect(authorLinkFinds('Jennifer A. Doudna', ['Doudna, Samuel'])).toBe(false);
  });

  it('does not find two co-authors who share the words of the name between them', () => {
    // As one clause per word it did: 7 of the first 20 results for Wei Wang.
    expect(authorLinkFinds('Wei Wang', ['Wei Zhang', 'Li Wang'])).toBe(false);
    expect(authorLinkFinds('Wei Wang', ['Wang Wei'])).toBe(true);
  });

  it('reads a name word that looks like grammar as a name', () => {
    // An operator, a refused operator, and the characters the grammar treats
    // as syntax, all as parts of names.
    expect(authorLinkFinds('Ana Or', ['Ana Or'])).toBe(true);
    expect(authorLinkFinds('Near Patel', ['Patel, Near'])).toBe(true);
    expect(authorLinkFinds('O"Brien (Pat)', ['Pat OBrien'])).toBe(true);
    // A `*` is dropped, not run as a wildcard: `Sm*` would match every Smith.
    expect(queryOf(fieldSearchHref('author', 'Sm*'))).toBe('AU="Sm"');
    expect(authorLinkFinds('Sm*', ['John Smith'])).toBe(false);
  });

  it('links nowhere for a name with nothing to search for', () => {
    expect(fieldSearchHref('author', '  ')).toBeUndefined();
    expect(fieldSearchHref('author', 'J. A.')).toBeUndefined();
  });
});

describe('a venue as a link to a search', () => {
  it('finds its own record when the name ends in brackets', () => {
    // How PubMed names the journal. The phrase matcher used to be unable to
    // match anything ending in `)`.
    expect(venueLinkFinds('Bioinformatics (Oxford, England)', 'Bioinformatics (Oxford, England)')).toBe(true);
    expect(venueLinkFinds('Science (New York, N.Y.)', 'Science (New York, N.Y.)')).toBe(true);
  });

  it('drops a year in brackets, which names an issue and not the journal', () => {
    expect(queryOf(fieldSearchHref('venue', 'PLOS Computational Biology (2020)'))).toBe('SO="PLOS Computational Biology"');
    expect(venueLinkFinds('PLOS Computational Biology (2020)', 'PLOS Computational Biology')).toBe(true);
    expect(venueLinkFinds('PLOS Computational Biology (2020)', 'PLOS Computational Biology (2022)')).toBe(true);
  });

  it('keeps a place in brackets, which is what tells two journals apart', () => {
    expect(queryOf(fieldSearchHref('venue', 'Bioinformatics (Oxford, England)')))
      .toBe('SO="Bioinformatics (Oxford, England)"');
  });

  it('drops a quote rather than ending the phrase on it', () => {
    const query = queryOf(fieldSearchHref('venue', 'The "Lancet"'));
    expect(query).toBe('SO="The Lancet"');
    expect(() => parseExpression(query)).not.toThrow();
  });

  it('links nowhere for a venue with nothing in it', () => {
    expect(fieldSearchHref('venue', '""')).toBeUndefined();
  });
});
