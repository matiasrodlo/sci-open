import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, totalHits, reconstructAbstract } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../__fixtures__/recorded.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-30T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `openalex:${id}`)!;

describe('normalize — the publisher the old path could never have read', () => {
  it('reads host_organization_name', () => {
    // The old path read `host_venue.publisher`, and `host_venue` is not a
    // valid select field at all — OpenAlex answers `select=host_venue` with
    // HTTP 400. `source.publisher` is the obvious substitute and was null on
    // every record measured; `host_organization_name` was populated on all of
    // them.
    expect(run(RECORDED).papers[0].publisher).toBe('Nature Portfolio');
    expect(run(RECORDED).papers.every(p => Boolean(p.publisher))).toBe(true);
  });

  it('has no publisher field to fall back to', () => {
    // Not null — absent. `primary_location.source` carries no `publisher` key
    // at all, so the runbook's suggested substitute for the removed
    // `host_venue.publisher` does not exist either.
    const source = RECORDED.results[0].primary_location.source;
    expect('publisher' in source).toBe(false);
    expect(source.host_organization_name).toBe('Nature Portfolio');
  });
});

describe('normalize — the access route, reported rather than assumed', () => {
  it('takes oa_status, which is Unpaywall\'s vocabulary', () => {
    // The old path wrote `oaStatus: 'published'` on every record — a *stage*
    // wearing the route's name, which is the conflation `Paper` splits in two.
    expect(run(RECORDED).papers.map(p => p.oaStatus)).toEqual(['green', 'bronze', 'bronze']);
  });

  it('records the version separately from the route', () => {
    expect(run(RECORDED).papers.every(p => p.stage === 'published')).toBe(true);
    expect(find('W2').stage).toBe('preprint');
  });

  it('leaves the route unknown for a status this model has no name for', () => {
    expect(find('W4').oaStatus).toBe('unknown');
    expect(find('W4').stage).toBe('unknown');
  });
});

describe('normalize — abstracts', () => {
  it('emits a repeated word at every position it occupies', () => {
    // `{"the": [0,2,4], "cat": [1], "sat": [3], "mat": [5]}`
    expect(find('W1').abstract).toBe('the cat the sat the mat');
  });

  it('leaves the abstract absent when OpenAlex sends null', () => {
    // One of the three recorded records has `abstract_inverted_index: null`.
    expect(RECORDED.results[0].abstract_inverted_index).toBeNull();
    expect(run(RECORDED).papers[0].abstract).toBeUndefined();
    expect(find('W2').abstract).toBeUndefined();
  });

  it('reconstructs the recorded abstracts', () => {
    expect(run(RECORDED).papers[1].abstract).toContain('METHODS');
  });

  it('answers undefined for anything that is not an index', () => {
    expect(reconstructAbstract(null)).toBeUndefined();
    expect(reconstructAbstract({})).toBeUndefined();
    expect(reconstructAbstract('nope' as any)).toBeUndefined();
  });
});

describe('normalize — identifiers and links', () => {
  it('strips the URL prefix off the id and the DOI', () => {
    const [first] = run(RECORDED).papers;
    expect(first.id).toBe('openalex:W3015140168');
    expect(first.sources[0].nativeId).toBe('W3015140168');
    expect(first.doi).toBe('10.1038/s41565-020-0669-6');
  });

  it('sends the reader to the DOI, not to the OpenAlex record', () => {
    // The old path used `work.id` as the landing page even when a DOI existed.
    expect(run(RECORDED).papers[0].landingPage).toBe('https://doi.org/10.1038/s41565-020-0669-6');
  });

  it('falls back to the OpenAlex record when there is no DOI', () => {
    expect(find('W3').landingPage).toBe('https://openalex.org/W3');
  });
});

describe('normalize — full text', () => {
  it('prefers a real PDF location', () => {
    expect(run(RECORDED).papers[1].fullText).toEqual({
      url: 'https://www.nejm.org/doi/pdf/10.1056/NEJMoa2107454?articleTools=true',
      kind: 'pdf',
      verified: false
    });
  });

  it('does not call a non-PDF oa_url a PDF', () => {
    // The recorded record's `oa_url` points at a PMC article page, and the old
    // path wrote every `oa_url` into `bestPdfUrl` regardless.
    expect(run(RECORDED).papers[0].fullText?.kind).toBe('html');
    expect(find('W2').fullText?.kind).toBe('html');
  });

  it('leaves fullText absent when there is no open copy', () => {
    expect(find('W3').fullText).toBeUndefined();
  });
});

describe('normalize — the rest', () => {
  it('reports citations, which OpenAlex has on every record', () => {
    expect(run(RECORDED).papers.map(p => p.citationCount)).toEqual([2292, 1718, 1929]);
  });

  it('uses topics and not keywords', () => {
    // `topics` supersedes the `concepts` the old path used — 3 precise topics
    // against 11 broad concepts. The edge record carries the same word as both
    // a topic and a keyword, so a provider folding keywords in would return
    // two.
    expect(find('W1').topics).toEqual(['Genomics']);
  });

  it('falls back to display_name for a title', () => {
    expect(find('W4').title).toBe('A record titled only by display_name');
  });

  it('costs exactly one record when a work cannot be read', () => {
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.results.length - 1);
    expect(skipped).toEqual([{ index: 4, nativeId: 'W5', reason: 'record has no title' }]);
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(185434);
  });
});

describe('normalize — markup', () => {
  it('takes the JATS OpenAlex carries through from Crossref out of the title', () => {
    expect(find('W6').title).toBe('Editing of Arabidopsis genes');
  });

  it('cleans the abstract after the inverted index is rejoined', () => {
    // The index is built from the publisher's abstract, so a token can be a
    // tag; the string only exists once the positions are put back in order.
    expect(find('W6').abstract).toBe('Yields were > 40%.');
  });
});
