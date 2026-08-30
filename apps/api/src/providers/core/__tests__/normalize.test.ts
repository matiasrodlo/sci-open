import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, totalHits, pickFullText } from '../normalize';

const RECORDED = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../__fixtures__/recorded.json'), 'utf8')
);

const AT = '2026-08-30T00:00:00.000Z';
const run = () => normalize(RECORDED, { retrievedAt: AT });

describe('normalize — the reader page is not a PDF', () => {
  it('offers a real PDF on every recorded record', () => {
    // The old connector's first priority was `core.ac.uk/reader/{id}`, assigned
    // to `bestPdfUrl` for every record that had an id — which is all of them —
    // so the two real PDF sources it then checked were unreachable code and
    // every CORE record advertised an HTML reader page as its PDF.
    const { papers } = run();
    expect(papers.every(p => p.fullText?.kind === 'pdf')).toBe(true);
  });

  it("prefers CORE's own hosted file", () => {
    expect(run().papers[0].fullText?.url).toBe('https://core.ac.uk/download/30664172.pdf');
  });

  it("falls back to the repository's own file", () => {
    // The third record has an empty `downloadUrl` and a chemRxiv PDF in
    // `sourceFulltextUrls`.
    expect(RECORDED.results[2].downloadUrl).toBe('');
    expect(run().papers[2].fullText?.url).toContain('chemrxiv.org');
    expect(run().papers[2].fullText?.kind).toBe('pdf');
  });

  it('calls a reader page html when there is no file at all', () => {
    const outcome = pickFullText({ links: [{ type: 'reader', url: 'https://core.ac.uk/reader/1' }] });
    expect(outcome).toEqual({ url: 'https://core.ac.uk/reader/1', kind: 'html', verified: false });
  });

  it('leaves fullText absent when nothing is retrievable', () => {
    expect(pickFullText({ links: [{ type: 'display', url: 'https://core.ac.uk/works/1' }] }))
      .toBeUndefined();
  });

  it('sends the reader page to landingPage, where it belongs', () => {
    expect(run().papers[0].landingPage).toBe('https://core.ac.uk/reader/30664172');
  });
});

describe('normalize — fields', () => {
  it('reads the venue from journals, the only place it exists', () => {
    // The old connector read `publishedVenue.name` and `journal.name`. CORE has
    // neither field, so its venue was undefined on every record. It is often
    // genuinely absent here too — a repository aggregator frequently does not
    // know the journal.
    expect('publishedVenue' in RECORDED.results[0]).toBe(false);
    expect('journal' in RECORDED.results[0]).toBe(false);
    expect(run().papers.every(p => p.venue === undefined)).toBe(true);
  });

  it('reads the publisher, which the old connector never set', () => {
    expect(run().papers[0].publisher).toBe('Springer Science and Business Media LLC');
  });

  it('reads the language code out of its object', () => {
    expect(run().papers[0].language).toBe('en');
    // The third record's language is null.
    expect(run().papers[2].language).toBeUndefined();
  });

  it('records a repository deposit as the green route', () => {
    expect(run().papers.every(p => p.oaStatus === 'green')).toBe(true);
  });

  it('populates no topics, because CORE has no subject field', () => {
    // `fieldOfStudy` is one string per record and not a subject: across the
    // three recorded records it holds `info:eu-repo/semantics/article`,
    // `Journal article` and `Chemistry` — a URI, a document type and a topic.
    expect(RECORDED.results.map((r: any) => r.fieldOfStudy)).toEqual([
      'info:eu-repo/semantics/article',
      'Journal article',
      'Chemistry'
    ]);
    expect(run().papers.every(p => p.topics.length === 0)).toBe(true);
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(2126594);
  });

  it('costs exactly one record when a record cannot be read', () => {
    const outcome = normalize(
      { results: [{ id: 1 }, RECORDED.results[0]] } as any,
      { retrievedAt: AT }
    );
    expect(outcome.papers).toHaveLength(1);
    expect(outcome.skipped).toEqual([{ index: 0, nativeId: '1', reason: 'record has no title' }]);
  });
});
