import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, totalHits, STAGES } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../__fixtures__/hal.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-10-01T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `hal:${id}`)!;

describe('normalize — the recorded fixture', () => {
  it('reads every doc', () => {
    const { papers, skipped } = run(RECORDED);
    expect(papers).toHaveLength(RECORDED.response.docs.length);
    expect(skipped).toEqual([]);
  });

  it('maps a recorded record field by field', () => {
    const [paper] = run(RECORDED).papers;
    expect(paper).toMatchObject({
      id: 'hal:hal-04020890',
      doi: '10.4172/1948-593x.1000109',
      title: 'The CRISPR-Cas9 System: A New Dawn in Gene Editing',
      venue: 'Journal of Bioanalysis & Biomedicine',
      language: 'en',
      oaStatus: 'green',
      stage: 'published',
      fullText: { url: 'https://hal.science/hal-04020890/document', kind: 'pdf', verified: false },
      // `uri_s` names the version the index describes.
      landingPage: 'https://hal.science/hal-04020890v1'
    });
    expect(paper!.year).toBe(RECORDED.response.docs[0].producedDateY_i);
    expect(paper!.authors).toEqual(RECORDED.response.docs[0].authFullName_s);
  });

  it('records where in HAL’s ranking each record sat', () => {
    const { papers } = normalize(RECORDED, { retrievedAt: AT, rankOffset: 40, latency: 12 });
    expect(papers.map(p => p.sources[0]!.rank)).toEqual([40, 41, 42]);
    expect(papers[0]!.sources[0]).toEqual({ provider: 'hal', nativeId: 'hal-04020890', rank: 40, retrievedAt: AT, latency: 12 });
  });

  it('reads HAL’s own count', () => {
    expect(totalHits(RECORDED)).toBe(RECORDED.response.numFound);
    expect(totalHits({})).toBeUndefined();
  });
});

describe('normalize — a deposit in two languages', () => {
  it('takes the first title, which is in the language of the document', () => {
    // The form OpenAIRE and CORE carry for the same deposit, and a record
    // without a DOI is merged on its title.
    expect(find('hal-00000001').title).toBe('Climat');
  });

  it('takes the abstract in the same language as the title', () => {
    expect(find('hal-00000001').abstract).toMatch(/^Le climat/);
  });

  it('keeps keywords in both languages, each once', () => {
    expect(find('hal-00000001').topics).toEqual(['climat', 'Climate', 'gouvernance']);
  });

  it('takes the language code HAL reports', () => {
    expect(find('hal-00000001').language).toBe('fr');
  });
});

describe('normalize — venue and publisher', () => {
  it('names an article by its journal and the journal’s publisher', () => {
    expect(find('hal-00000001')).toMatchObject({ venue: 'Revue française de climatologie', publisher: 'EDP Sciences' });
  });

  it('names a conference paper by its conference', () => {
    const paper = find('inria-00000002');
    expect(paper.venue).toBe('EGU General Assembly 2023');
    expect(paper.doi).toBeUndefined();
  });

  it('names a chapter by its book, and by the book’s first publisher', () => {
    expect(find('halshs-00000003')).toMatchObject({ venue: 'Dictionnaire vécu de la gouvernance', publisher: "Les Ozalids d'Humensis" });
  });
});

describe('normalize — version', () => {
  it('reads UNDEFINED, HAL’s preprint and working-paper type, as a preprint', () => {
    expect(find('hal-00000004').stage).toBe('preprint');
  });

  it('reads every other type it is given as published', () => {
    expect(['hal-00000001', 'inria-00000002', 'halshs-00000003', 'hal-00000009'].map(id => find(id).stage))
      .toEqual(['published', 'published', 'published', 'published']);
  });

  it('skips a thesis, which is not a type this provider reads', () => {
    const { papers, skipped } = run(EDGE);
    expect(papers.some(p => p.id === 'hal:tel-00000006')).toBe(false);
    expect(skipped).toContainEqual({ index: 5, nativeId: 'tel-00000006', reason: 'document type THESE is not read' });
  });

  it('names no thesis type among those it reads', () => {
    for (const thesis of ['THESE', 'HDR', 'MEM', 'ETABTHESE', 'MEMLIC']) expect(STAGES[thesis]).toBeUndefined();
  });
});

describe('normalize — the copy', () => {
  it('offers HAL’s main file as a PDF', () => {
    expect(find('inria-00000002').fullText).toEqual({
      url: 'https://inria.hal.science/inria-00000002/document',
      kind: 'pdf',
      verified: false
    });
  });

  it('offers no copy of a file under embargo, which answers 403', () => {
    const paper = find('inserm-00000005');
    expect(paper.fullText).toBeUndefined();
    expect(paper.landingPage).toBe('https://inserm.hal.science/inserm-00000005');
  });

  it('calls every deposit green', () => {
    expect(run(EDGE).papers.every(p => p.oaStatus === 'green')).toBe(true);
  });
});

describe('normalize — what is missing', () => {
  it('takes the markup out of a title', () => {
    expect(find('hal-00000004').title).toBe('A working paper on in vitro editing');
  });

  it('skips a record whose title is blank, and one with no id', () => {
    const { skipped } = run(EDGE);
    expect(skipped).toContainEqual({ index: 6, nativeId: 'hal-00000007', reason: 'record has no title' });
    expect(skipped).toContainEqual({ index: 7, reason: 'record has no halId' });
  });

  it('leaves out what a record does not carry rather than inventing it', () => {
    const paper = find('hal-00000009');
    for (const field of ['year', 'language', 'landingPage', 'venue', 'publisher', 'abstract', 'doi']) {
      expect(paper, field).not.toHaveProperty(field);
    }
    expect(paper.topics).toEqual([]);
    expect(paper.authors).toEqual([]);
  });

  it('reads every record it can and skips only the three it cannot', () => {
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(6);
    expect(skipped.map(s => s.index)).toEqual([5, 6, 7]);
  });
});
