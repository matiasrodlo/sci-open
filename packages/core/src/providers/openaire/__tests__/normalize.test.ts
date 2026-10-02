import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, normalizeRecord, totalHits } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../__fixtures__/openaire.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `openaire:${id}`)!;

describe('normalize — the identifier', () => {
  it('reads the product id, which is the one the legacy endpoint called dri:objIdentifier', () => {
    // Same id, same record, on both endpoints — so a paper link handed out
    // before the switch still resolves after it.
    expect(run(RECORDED).papers[0].id).toBe('openaire:doi_dedup___::469542ac104a1a2aa4c8c8a76e46bf9c');
  });

  it('never derives an identifier from the title', () => {
    expect(run(RECORDED).papers[0].sources[0].nativeId).not.toMatch(/potential|innovative|CRISP/i);
  });
});

describe('normalize — the DOI', () => {
  it('reads it from pids', () => {
    // A DOI is what lets an OpenAIRE record deduplicate against every other
    // provider. The old connector never found one.
    expect(run(RECORDED).papers[0].doi).toBe('10.1016/j.enzmictec.2025.110799');
  });

  it('picks the DOI out of a list that also holds a PMID', () => {
    expect(find('od______1234::aaaa').doi).toBe('10.1000/withpdf');
  });

  it('leaves the DOI absent when only a PMID is present', () => {
    expect(find('od______1234::bbbb').doi).toBeUndefined();
  });
});

describe('normalize — the open-access route, which OpenAIRE reports', () => {
  it('takes the colour when there is one', () => {
    expect(run(RECORDED).papers[0].oaStatus).toBe('hybrid');
    expect(find('od______1234::aaaa').oaStatus).toBe('gold');
  });

  it('falls back to green for a repository copy', () => {
    expect(find('od______1234::cccc').oaStatus).toBe('green');
  });

  it('records closed access as closed', () => {
    expect(find('od______1234::bbbb').oaStatus).toBe('closed');
  });
});

describe('normalize — fields the old connector filled with the wrong thing', () => {
  it('uses the journal as the venue, not the publishing house', () => {
    const [paper] = run(RECORDED).papers;
    expect(paper.venue).toBe('Enzyme and Microbial Technology');
    expect(paper.publisher).toBe('Elsevier BV');
  });

  it('reads the language code rather than its label', () => {
    // The old connector read the wrong slot, so every record fell back to 'en'.
    expect(run(RECORDED).papers[0].language).toBe('eng');
    expect(find('od______1234::cccc').language).toBe('fra');
  });

  it('reads the subject terms, which used to be an empty array', () => {
    expect(run(RECORDED).papers[0].topics.length).toBeGreaterThan(0);
    expect(run(RECORDED).papers[0].topics).toContain('Gene Editing');
  });

  it('does not repeat a subject term that differs only in case', () => {
    expect(find('od______1234::cccc').topics).toEqual(['crispr']);
  });
});

describe('normalize — record shapes', () => {
  it('prefers a real PDF over a landing page', () => {
    expect(find('od______1234::aaaa').fullText).toEqual({
      url: 'https://example.org/paper.pdf',
      kind: 'pdf',
      verified: false
    });
  });

  it('offers a non-PDF resource as html rather than calling it a PDF', () => {
    expect(find('od______1234::hhhh').fullText).toEqual({
      url: 'https://repository.example.org/items/1234',
      kind: 'html',
      verified: false
    });
  });

  it('reads the stage from the first instance', () => {
    expect(find('od______1234::aaaa').stage).toBe('published');
    expect(find('od______1234::hhhh').stage).toBe('unknown');
  });

  /**
   * The commonest shape OpenAIRE returns is a record whose URLs are its own DOI
   * and its PubMed entry — 791 of 1,530 non-PDF `fullText` values across three
   * live searches were `doi.org` — and `pickFullText` used to hand back
   * whichever came first as the copy. It is why `total` could call a paper
   * retrievable on the strength of its own address.
   */
  it('does not offer the paper\'s own address as a copy of it', () => {
    expect(run(RECORDED).papers[0].fullText).toBeUndefined();
    expect(find('od______1234::gggg').fullText).toBeUndefined();
  });

  it('still records that address as the landing page', () => {
    // The URL is not lost, it is filed correctly — which is the whole of the
    // change. A reader still gets a link; it is no longer counted as a copy.
    expect(run(RECORDED).papers[0].landingPage).toBe('https://doi.org/10.1016/j.enzmictec.2025.110799');
    expect(find('od______1234::gggg').landingPage).toBe('https://doi.org/10.1000/locator');
  });

  it('falls back to the OpenAIRE explore page when there is no URL and no DOI', () => {
    expect(find('od______1234::bbbb').landingPage)
      .toBe('https://explore.openaire.eu/search/publication?articleId=od______1234::bbbb');
  });

  it('strips markup and entities from the title and abstract', () => {
    const record = find('od______1234::dddd');
    expect(record.title).toBe('A title with markup & entities');
    expect(record.abstract).toBe('An abstract with tags.');
  });

  it('costs exactly one record when a result cannot be read', () => {
    // The old normaliser threw on a malformed record and nothing caught it, so
    // one bad record discarded the entire page.
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.results.length - 1);
    expect(skipped).toEqual([
      { index: 4, nativeId: 'od______1234::eeee', reason: 'record has no title' }
    ]);
  });

  it('skips an entry that is not a record at all, and only that entry', () => {
    const { papers, skipped } = run({ header: { numFound: 2 }, results: [null, EDGE.results[0]] });
    expect(papers.map(p => p.id)).toEqual(['openaire:od______1234::aaaa']);
    expect(skipped).toEqual([{ index: 0, reason: 'record is not an object' }]);
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(17644);
  });

  it('reports no count when the header carries none', () => {
    expect(totalHits({ header: {} })).toBeUndefined();
    expect(totalHits({})).toBeUndefined();
  });

  it('reads an empty page as no papers', () => {
    // What the Graph API answers for a query that matches nothing.
    expect(run({ header: { numFound: 0 }, results: [] })).toEqual({ papers: [], skipped: [] });
    expect(totalHits({ header: { numFound: 0 } })).toBe(0);
  });
});

describe('normalize — stray entries in a list', () => {
  const strays = () => find('od_____10208::ffff');

  it('skips a numeric description and takes the real abstract', () => {
    // First met on a live legacy page: a bare 75, presumably a page count,
    // ahead of the abstract. Reading the first entry made the old connector
    // throw — which cost every record on the page — and report "75".
    expect(strays().abstract).toBe("Alzheimer's disease is the most common neurodegenerative disorder to date.");
  });

  it('skips a description that arrives as a number rather than a string', () => {
    const { papers } = normalizeRecord(
      { id: 'x', mainTitle: 'T', descriptions: [75, 'The abstract.'] },
      { retrievedAt: AT }
    );
    expect(papers[0].abstract).toBe('The abstract.');
  });

  it('never reports an abstract that is only digits', () => {
    expect(run(EDGE).papers.every(p => !/^\d+$/.test(p.abstract ?? 'x'))).toBe(true);
  });

  it('takes the main title, not the subtitle', () => {
    expect(strays().title).toBe('The main title');
  });
});

describe('normalize — entity decoding', () => {
  const strays = () => find('od_____10208::ffff');

  it("decodes &apos;, which the decode list left out", () => {
    // OpenAIRE emits it, and abstracts reached the reader as
    // "Alzheimer&apos;s disease".
    expect(strays().abstract).not.toContain('&apos;');
    expect(strays().abstract).toContain("Alzheimer's");
  });

  it('decodes &amp; last, so an escaped entity is not decoded twice', () => {
    const outcome = normalizeRecord(
      {
        id: 'x',
        mainTitle: 'T',
        descriptions: ['a &amp;quot;quoted&amp;quot; word'],
        bestAccessRight: { label: 'OPEN' }
      },
      { retrievedAt: AT }
    );
    expect(outcome.papers[0].abstract).toBe('a &quot;quoted&quot; word');
  });
});
