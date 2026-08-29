import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalize, totalHits } from '../normalize';

const read = (p: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, p), 'utf8'));
const RECORDED = read('../../../sources/__fixtures__/openaire.json');
const EDGE = read('../__fixtures__/edge-cases.json');

const AT = '2026-08-29T00:00:00.000Z';
const run = (payload: unknown) => normalize(payload as any, { retrievedAt: AT });
const find = (id: string) => run(EDGE).papers.find(p => p.id === `openaire:${id}`)!;

describe('normalize — the identifier the old connector never found', () => {
  it('reads dri:objIdentifier, which is one key and not a nested object', () => {
    // The old connector read `header.dri.objIdentifier`. The key is
    // `dri:objIdentifier` — prefix included in the name — so it found nothing
    // and fell back to a 50-character slug of the title as the record's id.
    expect(run(RECORDED).papers[0].id).toBe('openaire:doi_dedup___::469542ac104a1a2aa4c8c8a76e46bf9c');
  });

  it('never derives an identifier from the title', () => {
    expect(run(RECORDED).papers[0].sources[0].nativeId).not.toMatch(/potential|innovative|CRISP/i);
  });
});

describe('normalize — the DOI', () => {
  it('reads @classid and $, the shape the JSON API actually sends', () => {
    // The old connector read the xml2js spelling, `$.classid` and `_`, so no
    // OpenAIRE record carried a DOI and none could deduplicate against any
    // other provider. The same fix was already applied to `bestaccessright`
    // and missed here.
    expect(run(RECORDED).papers[0].doi).toBe('10.1016/j.enzmictec.2025.110799');
  });

  it('picks the DOI out of a list that also holds a PMID', () => {
    expect(find('od______1234::aaaa').doi).toBe('10.1000/withpdf');
  });

  it('leaves the DOI absent when only a PMID is present', () => {
    // The PMID arrives as a number rather than a string, which is its own trap.
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

  it('reads the language code from @classid', () => {
    // The old connector read `$`, which is not where the code lives, so every
    // record fell back to 'en'.
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
    expect(run(RECORDED).papers[0].fullText?.kind).toBe('html');
  });

  it('strips markup and entities from the title and abstract', () => {
    const record = find('od______1234::dddd');
    expect(record.title).toBe('A title with markup & entities');
    expect(record.abstract).toBe('An abstract with tags.');
  });

  it('costs exactly one record when a result cannot be read', () => {
    // The old normaliser threw on a missing `oaf:result` and nothing caught
    // it, so one malformed record discarded the entire page.
    const { papers, skipped } = run(EDGE);
    expect(papers).toHaveLength(EDGE.response.results.result.length - 1);
    expect(skipped).toEqual([
      { index: 4, nativeId: 'od______1234::eeee', reason: 'record has no oaf:result' }
    ]);
  });

  it('reports the corpus-wide count', () => {
    expect(totalHits(RECORDED)).toBe(17473);
  });
});
