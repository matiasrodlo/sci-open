import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { normalize, totalHits, ArxivQueryError } from '../normalize';

const read = (p: string) => parseStringPromise(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });

let RECORDED: any;
let EDGE: any;
let ERROR_DOC: any;

beforeAll(async () => {
  RECORDED = await read('../../../sources/__fixtures__/arxiv.xml');
  EDGE = await read('../__fixtures__/edge-cases.xml');
  ERROR_DOC = await read('../__fixtures__/error-document.xml');
});

describe('normalize — the recorded fixture', () => {
  it('reads every entry', () => {
    const { papers, skipped } = run(RECORDED);
    expect(papers).toHaveLength(RECORDED.feed.entry.length);
    expect(skipped).toEqual([]);
  });

  it('builds the id from the arXiv identifier', () => {
    const [first] = run(RECORDED).papers;
    expect(first.id).toBe('arxiv:2202.07171v1');
    expect(first.sources[0].nativeId).toBe('2202.07171v1');
  });

  it('takes the year from the submission date', () => {
    expect(run(RECORDED).papers[0].year).toBe(2022);
  });

  it('flattens the wrapping Atom keeps in the title and abstract', () => {
    const [first] = run(RECORDED).papers;
    expect(first.title).not.toMatch(/\s{2,}|\n/);
    expect(first.abstract).not.toMatch(/\s{2,}|\n/);
  });

  it('reads the categories as topics', () => {
    expect(run(RECORDED).papers[0].topics).toContain('q-bio.GN');
  });

  it('records the arXiv copy as a preprint, not as a route', () => {
    // Which version it is and how it is open are different axes. The route is
    // Unpaywall's vocabulary and arrives during enrichment.
    const [first] = run(RECORDED).papers;
    expect(first.stage).toBe('preprint');
    expect(first.oaStatus).toBe('unknown');
  });

  it('carries the pdf as retrievable but unverified', () => {
    expect(run(RECORDED).papers[0].fullText).toEqual({
      url: 'https://arxiv.org/pdf/2202.07171v1',
      kind: 'pdf',
      verified: false
    });
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(111);
  });

  it("ranks records by their position in arXiv's own list", () => {
    expect(run(RECORDED).papers.map(p => p.sources[0].rank)).toEqual([0, 1, 2]);
  });
});

describe('normalize — the fields the old connector dropped', () => {
  const published = () => run(EDGE).papers.find(p => p.id === 'arxiv:2101.00001v1')!;

  it('reads the DOI of the published version', () => {
    // Without it an arXiv record keys on title and year, and a preprint's
    // submission year rarely matches its publication year — so the same paper
    // survived as two results.
    expect(published().doi).toBe('10.1038/s41467-022-30843-1');
  });

  it('reads the journal reference as the venue', () => {
    expect(published().venue).toBe('Phys. Rev. Lett. 127, 208102, 2021');
  });

  it('leaves both absent when arXiv does not supply them', () => {
    const bare = run(EDGE).papers.find(p => p.id === 'arxiv:2101.00003v1')!;
    expect(bare.doi).toBeUndefined();
    expect(bare.venue).toBeUndefined();
  });
});

describe('normalize — record shapes', () => {
  it('upgrades an http pdf link, which a browser would block as mixed content', () => {
    const record = run(EDGE).papers.find(p => p.id === 'arxiv:2101.00002v1')!;
    expect(record.fullText?.url).toBe('https://arxiv.org/pdf/2101.00002v1');
  });

  it('leaves fullText absent rather than inventing one', () => {
    expect(run(EDGE).papers.find(p => p.id === 'arxiv:2101.00003v1')!.fullText).toBeUndefined();
  });

  it('collapses wrapped text', () => {
    const record = run(EDGE).papers.find(p => p.id === 'arxiv:2101.00004v1')!;
    expect(record.title).toBe('A title broken across several lines');
    expect(record.abstract).toBe('An abstract wrapped the same way.');
  });

  it('costs exactly one record when an entry cannot be read', () => {
    // The old connector mapped the feed in one expression, so an entry that
    // threw discarded the page and arXiv was recorded as returning nothing.
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.feed.entry.length - 1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ nativeId: '2101.00005v1', reason: 'entry has no title' });
  });
});

describe("normalize — arXiv's error document is not a paper", () => {
  it('throws rather than returning a record titled "Error"', () => {
    // A well-formed feed with one entry that has a title, an author and a
    // summary. Nothing about its shape stops a normaliser accepting it, and
    // the old connector would have returned it as a search result had the
    // status been 200 rather than 500.
    expect(() => run(ERROR_DOC)).toThrow(ArxivQueryError);
  });

  it("carries arXiv's stated reason", () => {
    expect(() => run(ERROR_DOC)).toThrow(/internal error/);
  });

  it('produces no papers at all, rather than one bad one', () => {
    const papers = (() => {
      try {
        return run(ERROR_DOC).papers;
      } catch {
        return null;
      }
    })();
    expect(papers).toBeNull();
  });
});
