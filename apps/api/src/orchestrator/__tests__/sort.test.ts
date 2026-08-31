import { describe, it, expect } from 'vitest';
import { sortPapers } from '../sort';
import { paper } from './helpers';

const ids = (papers: ReturnType<typeof sortPapers>) => papers.map(p => p.id);

describe('sortPapers — a value beats no value, in both directions', () => {
  /**
   * The numeric comparators always put a missing value last: `-Infinity`
   * descending, `+Infinity` ascending. The text comparator used to map a
   * missing value to `''`, which collates before every non-empty string, so
   * ascending text sorts opened with every paper that had nothing to show in
   * the column just sorted on. Measured on "crispr", "Author (A-Z)" returned a
   * first page 16 rows of 20 blank; "Author (Z-A)" was clean, because there
   * the empty strings fell off the end.
   */

  const withVenue = [
    paper({ id: 'none-1', venue: undefined }),
    paper({ id: 'zebra', venue: 'Zebra Journal' }),
    paper({ id: 'none-2', venue: undefined }),
    paper({ id: 'apex', venue: 'Apex Review' })
  ];

  it('puts venue-less papers last ascending, not first', () => {
    expect(ids(sortPapers(withVenue, 'venue'))).toEqual(['apex', 'zebra', 'none-1', 'none-2']);
  });

  it('puts venue-less papers last descending too', () => {
    expect(ids(sortPapers(withVenue, 'venue_desc'))).toEqual(['zebra', 'apex', 'none-1', 'none-2']);
  });

  it('treats an empty author list as missing rather than as an empty name', () => {
    const papers = [
      paper({ id: 'anon', authors: [] }),
      paper({ id: 'young', authors: ['Young, A'] }),
      paper({ id: 'adams', authors: ['Adams, B'] })
    ];

    expect(ids(sortPapers(papers, 'author'))).toEqual(['adams', 'young', 'anon']);
    expect(ids(sortPapers(papers, 'author_desc'))).toEqual(['young', 'adams', 'anon']);
  });

  it('keeps missing titles last both ways', () => {
    const papers = [
      paper({ id: 'blank', title: '' }),
      paper({ id: 'beta', title: 'Beta' }),
      paper({ id: 'alpha', title: 'Alpha' })
    ];

    expect(ids(sortPapers(papers, 'title'))).toEqual(['alpha', 'beta', 'blank']);
    expect(ids(sortPapers(papers, 'title_desc'))).toEqual(['beta', 'alpha', 'blank']);
  });

  it('still puts undated papers last both ways, as it always did', () => {
    const papers = [
      paper({ id: 'undated', year: undefined }),
      paper({ id: 'old', year: 2005 }),
      paper({ id: 'new', year: 2024 })
    ];

    expect(ids(sortPapers(papers, 'date'))).toEqual(['new', 'old', 'undated']);
    expect(ids(sortPapers(papers, 'date_asc'))).toEqual(['old', 'new', 'undated']);
  });

  it('breaks ties on the ranked order rather than arbitrarily', () => {
    const papers = [
      paper({ id: 'second', venue: 'Same' }),
      paper({ id: 'first', venue: 'Same' })
    ];

    expect(ids(sortPapers(papers, 'venue'))).toEqual(['second', 'first']);
  });

  it('orders papers that are all missing by rank, not by chance', () => {
    const papers = [paper({ id: 'a', venue: undefined }), paper({ id: 'b', venue: undefined })];
    expect(ids(sortPapers(papers, 'venue'))).toEqual(['a', 'b']);
  });

  it('leaves relevance alone, which is the order rank produced', () => {
    const papers = [paper({ id: 'b', venue: 'Z' }), paper({ id: 'a', venue: 'A' })];
    expect(ids(sortPapers(papers, 'relevance'))).toEqual(['b', 'a']);
  });
});

describe('sortPapers — applied again after enrichment', () => {
  /**
   * The authorities fill `title`, `authors`, `year`, `venue`, `publisher` and
   * `citationCount` — every field a sort keys on — and they run after the set
   * has been sorted and sliced. A page arranged on the values it had before
   * they arrived, then displayed with the values it has after, is not ordered
   * in what it shows. `runOrchestrator` sorts the page a second time; this
   * pins the reason.
   */
  it('re-sorting a page fixes an order that enrichment invalidated', () => {
    const page = [
      paper({ id: 'gained-an-author', authors: [] }),
      paper({ id: 'had-one', authors: ['Zeta, Z'] })
    ];

    // Placed correctly for the values it had: no author sorts last.
    expect(ids(sortPapers(page, 'author'))).toEqual(['had-one', 'gained-an-author']);

    // An authority supplies the missing author, and the old order is now wrong
    // in the values the page displays.
    page[0]!.authors = ['Alpha, A'];

    expect(ids(sortPapers(page, 'author'))).toEqual(['gained-an-author', 'had-one']);
  });
});
