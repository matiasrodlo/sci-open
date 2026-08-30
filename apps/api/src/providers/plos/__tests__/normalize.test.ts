import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, totalHits } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../__fixtures__/plos.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `plos:${id}`)!;

describe('normalize — topics', () => {
  it('takes the leaf of each subject path', () => {
    // `subject` holds strings like
    // `/Biology and life sciences/Genetics/Genomics/Repeated sequences/CRISPRs`.
    // The leaf is what the paper is about; keeping the whole path would make
    // every level its own facet bucket.
    expect(find('10.1371/journal.pgen.1002441').topics).toEqual(['Genomics', 'CRISPRs']);
  });

  it('leaves topics empty rather than filling them with the article type', () => {
    // The old connector put `article_type` in `topics`, so every PLOS record
    // carried the single topic "Research Article" — a document type, identical
    // across the whole corpus, and a useless facet bucket.
    const record = find('10.1371/journal.pone.0000002');
    expect(record.topics).toEqual([]);
  });

  it('does not repeat a term that appears in two paths', () => {
    expect(find('10.1371/journal.pgen.1002441').topics.filter(t => t === 'Genomics')).toHaveLength(1);
  });
});

describe('normalize — the recorded fixture', () => {
  it('reads every doc', () => {
    const { papers, skipped } = run(RECORDED);
    expect(papers).toHaveLength(RECORDED.response.docs.length);
    expect(skipped).toEqual([]);
  });

  it('unwraps the single-element DOI array', () => {
    expect(run(RECORDED).papers[0].doi).toBe('10.1371/journal.pone.0253351');
  });

  it('takes the year from the publication date', () => {
    expect(run(RECORDED).papers.every(p => typeof p.year === 'number')).toBe(true);
  });

  it('records the route as gold and the publisher as PLOS', () => {
    const { papers } = run(RECORDED);
    expect(papers.every(p => p.oaStatus === 'gold')).toBe(true);
    expect(papers.every(p => p.publisher === 'Public Library of Science')).toBe(true);
  });

  it('builds the PDF off the DOI', () => {
    // The journal slug in the path is not load-bearing: `/plosone/` resolves a
    // PLOS Genetics or PLOS Biology DOI to the right file, checked on both.
    expect(run(RECORDED).papers[0].fullText).toEqual({
      url: 'https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0253351&type=printable',
      kind: 'pdf',
      verified: false
    });
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(5551);
  });
});

describe('normalize — record shapes', () => {
  it('leaves the pdf and landing page absent with no DOI', () => {
    const record = find('10.1371/journal.pone.0000003');
    expect(record.fullText).toBeUndefined();
    expect(record.landingPage).toBeUndefined();
  });

  it('falls back to the plain author list', () => {
    expect(find('10.1371/journal.pone.0000003').authors).toEqual(['Alan Turing']);
  });

  it('costs exactly one record when a doc cannot be read', () => {
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.response.docs.length - 1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toBe('record has no title');
  });
});
