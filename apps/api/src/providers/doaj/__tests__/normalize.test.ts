import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));

const RECORDED = read('../../../__fixtures__/doaj.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `doaj:${id}`)!;

describe('normalize — a fulltext link is not a PDF', () => {
  it('types every recorded record as html, not pdf', () => {
    // The old connector matched `link.type === 'fulltext'` and wrote the
    // result to `bestPdfUrl`. Not one link in the recorded page is a PDF — one
    // is explicitly text/html — so every DOAJ record advertised a journal
    // landing page as its PDF.
    const { papers } = run(RECORDED);
    expect(papers.every(p => p.fullText?.kind === 'html')).toBe(true);
  });

  it('prefers a real PDF when there is one', () => {
    expect(find('pdf0000000000000000000000000001').fullText).toEqual({
      url: 'https://example.org/article.pdf',
      kind: 'pdf',
      verified: false
    });
  });

  it('still offers an untyped fulltext link, as html', () => {
    // `type: 'fulltext'` says a full text exists, not what format it is in.
    expect(find('html000000000000000000000000002').fullText).toEqual({
      url: 'https://example.org/reader',
      kind: 'html',
      verified: false
    });
  });

  it('leaves fullText absent when there are no links', () => {
    expect(find('nolink00000000000000000000000003').fullText).toBeUndefined();
  });

  it('never claims to have verified a file', () => {
    expect(run(RECORDED).papers.every(p => p.fullText?.verified === false)).toBe(true);
  });
});

describe('normalize — fields the old connector got wrong', () => {
  it('reads the language DOAJ does supply', () => {
    // The old connector hardcoded 'en' with a comment saying DOAJ does not
    // provide language "in this format". It is at journal.language.
    expect(run(RECORDED).papers[0].language).toBe('en');
    expect(find('html000000000000000000000000002').language).toBe('fr');
  });

  it('leaves venue absent rather than inventing one', () => {
    // The old connector fell back to the literal string 'DOAJ Journal'.
    const record = find('novenue0000000000000000000000004');
    expect(record.venue).toBeUndefined();
  });

  it('records the route as gold, which DOAJ actually establishes', () => {
    // DOAJ indexes only journals that are themselves fully open access, so
    // this is one of the few places the route is known rather than guessed.
    expect(run(RECORDED).papers.every(p => p.oaStatus === 'gold')).toBe(true);
    expect(run(RECORDED).papers.every(p => p.stage === 'published')).toBe(true);
  });
});

describe('normalize — record shapes', () => {
  it('reads the DOI out of the identifier list', () => {
    expect(run(RECORDED).papers[0].doi).toBe('10.3390/v14092045');
  });

  it('ignores a non-DOI identifier', () => {
    expect(find('novenue0000000000000000000000004').doi).toBeUndefined();
  });

  it('prefers the DOI as the landing page, keeping the link as fullText', () => {
    // Both resolve to the same publisher page; the DOI is the stable one, and
    // the link is not lost — it is filed under the format it actually is.
    const record = find('html000000000000000000000000002');
    expect(record.landingPage).toBe('https://doi.org/10.1000/html');
    expect(record.fullText?.url).toBe('https://example.org/reader');
  });

  it('falls back to the fulltext link, then to DOAJ itself', () => {
    expect(find('novenue0000000000000000000000004').landingPage)
      .toBe('https://doaj.org/article/novenue0000000000000000000000004');
  });

  it('combines keywords with LCC subject terms, without repeating one', () => {
    const record = find('subject0000000000000000000000005');
    expect(record.topics).toEqual(['crispr', 'Microbiology', 'Biology']);
  });

  it('costs exactly one record when an article cannot be read', () => {
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.results.length - 1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('record has no title');
  });

  it('ranks records by their position in DOAJ\'s own list', () => {
    expect(run(RECORDED).papers.map(p => p.sources[0].rank)).toEqual([0, 1, 2]);
  });
});

describe('normalize — markup', () => {
  it('decodes the ampersand the publisher escaped', () => {
    // bibjson is the publisher's own deposit, passed through as it arrives —
    // which is why the recorded page's affiliations read `Eye &amp; ENT
    // Hospital`. Titles and abstracts come from the same strings.
    expect(find('markup000000000000000000000001').title)
      .toBe('Hearing loss in the Eya4 mouse & its rescue');
  });

  it('reads a multi-paragraph abstract as running prose', () => {
    expect(find('markup000000000000000000000001').abstract)
      .toBe('Thresholds fell > 20 dB. Recovery was partial.');
  });
});
