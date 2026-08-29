import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { normalize } from '../normalize';

const read = (p: string) => parseStringPromise(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));

const AT = '2026-08-29T00:00:00.000Z';
const run = (articles: unknown[]) => normalize(articles, { retrievedAt: AT });

let recorded: any[];
let edge: any[];

beforeAll(async () => {
  recorded = (await read('../../../sources/__fixtures__/ncbi-efetch.xml')).PubmedArticleSet.PubmedArticle;
  edge = (await read('../__fixtures__/edge-cases.xml')).PubmedArticleSet.PubmedArticle;
});

describe('normalize — the DOI the old connector walked past', () => {
  it('reads it from the ArticleIdList', () => {
    // The old loop searched the same list for the PMC id and broke on finding
    // it, stepping straight over the DOI beside it. Measured consequence: 83
    // of 84 surviving duplicates were a PubMed record with no DOI next to the
    // same paper from Europe PMC with one.
    expect(run(recorded).papers[0].doi).toBe('10.3389/fmicb.2026.1938063');
  });

  it('reads it on every record in the recorded fixture', () => {
    expect(run(recorded).papers.every(p => Boolean(p.doi))).toBe(true);
  });

  it('falls back to the ELocationID when the id list has none', () => {
    const record = run(edge).papers.find(p => p.id === 'ncbi:11111111')!;
    expect(record.doi).toBe('10.9999/elocation.only');
  });

  it('picks the DOI, not the pii, out of several ELocationIDs', () => {
    expect(run(edge).papers.find(p => p.id === 'ncbi:11111111')!.doi).not.toBe('S1234');
  });
});

describe('normalize — topics, which used to be empty on every record', () => {
  it('reads MeSH descriptors where PubMed has indexed the article', () => {
    const record = run(edge).papers.find(p => p.id === 'ncbi:29602366')!;
    expect(record.topics).toEqual(['Animals', 'Ants', 'Genome, Insect']);
  });

  it('takes the qualifier off, keeping the descriptor', () => {
    // `<MeshHeading><DescriptorName>Ants</DescriptorName><QualifierName>genetics</QualifierName>`
    // is one topic, not two.
    const record = run(edge).papers.find(p => p.id === 'ncbi:29602366')!;
    expect(record.topics).not.toContain('genetics');
  });

  it('falls back to author keywords, which is all a recent article has', () => {
    // None of the three recorded articles carry MeSH — PubMed assigns it only
    // once an article is indexed — and all three carry a KeywordList. MeSH
    // alone would have left topics empty on exactly the records the old
    // connector already failed.
    const [first] = run(recorded).papers;
    expect(first.topics).toContain('CRISPR/Cas9 gene editing');
  });

  it('populates topics on every recorded record', () => {
    expect(run(recorded).papers.every(p => p.topics.length > 0)).toBe(true);
  });
});

describe('normalize — dates', () => {
  it('takes the year from the publication date', () => {
    expect(run(recorded).papers[0].year).toBe(2026);
  });

  it('recovers a year from a MedlineDate with no Year element', () => {
    // `<PubDate><MedlineDate>1998-1999</MedlineDate></PubDate>` — older records
    // carry a date range as a string and no Year at all.
    expect(run(edge).papers.find(p => p.id === 'ncbi:22222222')!.year).toBe(1998);
  });

  it('records retrieval time, not the current time, as retrievedAt', () => {
    // The old connector stamped `createdAt: new Date().toISOString()` on every
    // record, so the field meant "when we asked" and the publication date was
    // nowhere in the output.
    expect(run(recorded).papers.every(p => p.retrievedAt === AT)).toBe(true);
  });
});

describe('normalize — record shapes', () => {
  it('links the PMC pdf and calls the record published', () => {
    const [first] = run(recorded).papers;
    expect(first.fullText).toEqual({
      url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13509134/pdf/',
      kind: 'pdf',
      verified: false
    });
    expect(first.stage).toBe('published');
  });

  it('leaves stage unknown and fullText absent with no PMC copy', () => {
    const record = run(edge).papers.find(p => p.id === 'ncbi:11111111')!;
    expect(record.stage).toBe('unknown');
    expect(record.fullText).toBeUndefined();
  });

  it('keeps a collective author as written', () => {
    expect(run(edge).papers.find(p => p.id === 'ncbi:11111111')!.authors)
      .toEqual(['A Working Group']);
  });

  it('joins a labelled abstract into one text', () => {
    expect(run(edge).papers.find(p => p.id === 'ncbi:22222222')!.abstract)
      .toBe('First part. Second part.');
  });

  it('reads the language rather than assuming English', () => {
    expect(run(edge).papers.find(p => p.id === 'ncbi:22222222')!.language).toBe('fre');
  });

  it('never lets an unwrapped object reach a field', () => {
    // The old normaliser called String() on whatever it found and then guarded
    // against the literal '[object Object]' arriving as a search result title.
    const all = [...run(recorded).papers, ...run(edge).papers];
    for (const paper of all) {
      expect(paper.title).not.toContain('[object Object]');
      expect(paper.venue ?? '').not.toContain('[object Object]');
    }
  });

  it('costs exactly one record when an article cannot be read', () => {
    const { papers, skipped } = run(edge);
    expect(papers).toHaveLength(edge.length - 1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ nativeId: '33333333', reason: 'record has no title' });
  });
});
