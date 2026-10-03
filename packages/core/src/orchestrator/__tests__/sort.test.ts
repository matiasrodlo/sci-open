import { describe, it, expect } from 'vitest';
import { sortPapers } from '../sort';
import { paper } from './helpers';

const ids = (papers: ReturnType<typeof sortPapers>) => papers.map(p => p.id);

describe('sortPapers — a value beats no value, in both directions', () => {
  it('puts undated papers last both ways', () => {
    const papers = [
      paper({ id: 'undated', year: undefined }),
      paper({ id: 'old', year: 2005 }),
      paper({ id: 'new', year: 2024 })
    ];

    expect(ids(sortPapers(papers, 'date'))).toEqual(['new', 'old', 'undated']);
    expect(ids(sortPapers(papers, 'date_asc'))).toEqual(['old', 'new', 'undated']);
  });

  it('puts uncounted papers last both ways', () => {
    const papers = [
      paper({ id: 'uncounted', citationCount: undefined }),
      paper({ id: 'few', citationCount: 3 }),
      paper({ id: 'many', citationCount: 300 })
    ];

    expect(ids(sortPapers(papers, 'citations'))).toEqual(['many', 'few', 'uncounted']);
    expect(ids(sortPapers(papers, 'citations_asc'))).toEqual(['few', 'many', 'uncounted']);
  });

  it('breaks ties on the ranked order rather than arbitrarily', () => {
    const papers = [
      paper({ id: 'second', year: 2020 }),
      paper({ id: 'first', year: 2020 })
    ];

    expect(ids(sortPapers(papers, 'date'))).toEqual(['second', 'first']);
  });

  it('orders papers that are all missing by rank, not by chance', () => {
    const papers = [paper({ id: 'a', year: undefined }), paper({ id: 'b', year: undefined })];
    expect(ids(sortPapers(papers, 'date'))).toEqual(['a', 'b']);
  });

  it('leaves relevance alone, which is the order rank produced', () => {
    const papers = [paper({ id: 'b', year: 2001 }), paper({ id: 'a', year: 2024 })];
    expect(ids(sortPapers(papers, 'relevance'))).toEqual(['b', 'a']);
  });
});

describe('sortPapers — applied again after enrichment', () => {
  /**
   * The authorities fill `year` and `citationCount` — every field a sort keys
   * on — and they run after the set has been sorted and sliced. A page
   * arranged on the values it had before they arrived, then displayed with the
   * values it has after, is not ordered in what it shows. `runSearch` sorts the
   * page a second time; this pins the reason.
   */
  it('re-sorting a page fixes an order that enrichment invalidated', () => {
    const page = [
      paper({ id: 'gained-a-count', citationCount: undefined }),
      paper({ id: 'had-one', citationCount: 4 })
    ];

    // Placed correctly for the values it had: no count sorts last.
    expect(ids(sortPapers(page, 'citations'))).toEqual(['had-one', 'gained-a-count']);

    // An authority supplies the missing count, and the old order is now wrong
    // in the values the page displays.
    page[0]!.citationCount = 90;

    expect(ids(sortPapers(page, 'citations'))).toEqual(['gained-a-count', 'had-one']);
  });
});
