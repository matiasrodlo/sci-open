import { describe, it, expect } from 'vitest';
import type { Paper } from '@sci-open/shared';
import { paper, ref } from '@sci-open/core/testing';
import { searchPapers } from '../src/tools/search-papers';
import { getPaper } from '../src/tools/get-paper';
import { readPaper } from '../src/tools/read-paper';
import { verifyReferences } from '../src/tools/verify-references';
import { getCitations } from '../src/tools/get-citations';
import { exportCitations } from '../src/tools/export-citations';
import { listedTitle } from '../src/shape/paper';
import { fakeEngine } from './fake-engine';

/**
 * A paper a source records as retracted is flagged wherever it appears: first
 * in its shaped record, as an issue on a reference that matches it, and in a
 * warning line that leads every text the server writes about it — the
 * server's own statement, outside the fence around third-party text.
 */

const RETRACTED: Paper = paper({
  id: 'openalex:W2117847125',
  doi: '10.1016/s0140-6736(97)11096-0',
  title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children',
  authors: ['A J Wakefield', 'S H Murch'],
  year: 1998,
  venue: 'The Lancet',
  retracted: true,
  sources: [ref('openalex', { nativeId: 'W2117847125' })]
});
const STANDING: Paper = paper({
  id: 'openalex:W1',
  doi: '10.1234/standing',
  title: 'Ileal hyperplasia revisited in a later cohort',
  authors: ['Ada Lovelace'],
  year: 2005,
  sources: [ref('openalex', { nativeId: 'W1' })]
});

const WARNING = /^\*\*Warning: .* recorded as retracted\.\*\* A retracted paper is not evidence; do not cite it as support\.$/;
const firstLine = (text: string) => text.split('\n')[0]!;

describe('retracted papers', () => {
  it('lead their shaped record with the flag', async () => {
    const fake = fakeEngine([RETRACTED]);
    const { structured, text } = await getPaper.run(getPaper.input.parse({ doi: RETRACTED.doi }), fake.deps);
    expect(Object.keys(structured.paper)[0]).toBe('retracted');
    expect(structured.paper.retracted).toBe(true);
    expect(firstLine(text)).toMatch(WARNING);
    expect(firstLine(text)).toContain('This paper is recorded as retracted');
  });

  it('are named before the results of a search, and marked in its table', async () => {
    const fake = fakeEngine([STANDING, RETRACTED]);
    const { structured, text } = await searchPapers.run(searchPapers.input.parse({ query: 'TI=(ileal hyperplasia)' }), fake.deps);
    const at = structured.results!.findIndex(p => p.retracted) + 1;
    expect(firstLine(text)).toBe(`**Warning: Result #${at} is recorded as retracted.** A retracted paper is not evidence; do not cite it as support.`);
    expect(text).toMatch(new RegExp(`^\\| ${at} \\| RETRACTED — Ileal-lymphoid`, 'm'));
    expect(structured.results!.filter(p => p.retracted)).toHaveLength(1);
  });

  it('keep their verdict as references, with the issue first and a count', async () => {
    const fake = fakeEngine([RETRACTED, STANDING]);
    const { structured, text } = await verifyReferences.run({
      references: [
        'Wakefield AJ, Murch SH. Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. Lancet. 1998. doi:10.1016/S0140-6736(97)11096-0',
        'Lovelace A. Ileal hyperplasia revisited in a later cohort. 2005. doi:10.1234/standing'
      ]
    }, fake.deps);

    expect(structured.results[0]).toMatchObject({ verdict: 'verified', matched: { retracted: true } });
    expect(structured.results[0]!.issues[0]).toBe('retracted');
    expect(structured.results[1]!.issues).not.toContain('retracted');
    expect(structured.summary).toMatchObject({ verified: 2, retracted: 1 });
    expect(firstLine(text)).toBe('**Warning: Reference #1 is recorded as retracted.** A retracted paper is not evidence; do not cite it as support.');
    expect(text).toContain('· retracted 1');
    expect(text).toMatch(/^1\. \*\*verified\*\* — RETRACTED — Ileal-lymphoid/m);
  });

  it('are flagged before any view of their text', async () => {
    const doc = {
      paperId: RETRACTED.id, tier: 'europepmc-jats' as const, url: 'https://europepmc.org/x',
      sections: [{ id: 's1', title: 'Methods', text: 'Twelve children were referred.' }],
      totalChars: 30, retrievedAt: '2026-10-02T00:00:00.000Z'
    };
    const fake = fakeEngine([RETRACTED], { documents: { [RETRACTED.id]: doc } });
    for (const args of [{ paper: RETRACTED.id }, { paper: RETRACTED.id, view: 'section', section: 's1' }, { paper: RETRACTED.id, view: 'search', query: 'children' }]) {
      const { structured, text } = await readPaper.run(readPaper.input.parse(args), fake.deps);
      expect(structured.retracted).toBe(true);
      expect(firstLine(text)).toMatch(WARNING);
    }
  });

  it('are marked among a paper’s citers', async () => {
    const fake = fakeEngine([STANDING, RETRACTED], {
      citations: { 'cited_by|10.1234/standing': [
        { dois: ['10.1016/s0140-6736(97)11096-0'], journalSelfCitation: false, authorSelfCitation: false },
        { dois: ['10.5555/other'], journalSelfCitation: false, authorSelfCitation: false }
      ] }
    });
    const { text } = await getCitations.run(getCitations.input.parse({ paper: '10.1234/standing', direction: 'cited_by' }), fake.deps);
    expect(firstLine(text)).toBe('**Warning: Link #1 is recorded as retracted.** A retracted paper is not evidence; do not cite it as support.');
    expect(text).toMatch(/^1\. RETRACTED — Ileal-lymphoid/m);
  });

  it('are exported all the same, and named first', async () => {
    const fake = fakeEngine([RETRACTED, STANDING]);
    const { structured, text } = await exportCitations.run(exportCitations.input.parse({ papers: ['10.1234/standing', RETRACTED.doi!] }), fake.deps);
    expect(structured).toMatchObject({ entries: 2, retracted: [RETRACTED.doi] });
    expect(firstLine(text)).toBe(`**Warning: ${RETRACTED.doi} is recorded as retracted.** A retracted paper is not evidence; do not cite it as support.`);
  });

  it('are not marked twice when the title already says so', () => {
    expect(listedTitle({ retracted: true, title: 'RETRACTED: Ileal-lymphoid-nodular hyperplasia' })).toBe('RETRACTED: Ileal-lymphoid-nodular hyperplasia');
    expect(listedTitle({ retracted: true, title: 'Ileal-lymphoid-nodular hyperplasia' })).toBe('RETRACTED — Ileal-lymphoid-nodular hyperplasia');
    // A title about retractions is not one.
    expect(listedTitle({ title: 'Retracted publications in medicine' })).toBe('Retracted publications in medicine');
  });

  it('leave a record without the flag unchanged', async () => {
    const fake = fakeEngine([STANDING]);
    const { structured, text } = await getPaper.run(getPaper.input.parse({ doi: STANDING.doi }), fake.deps);
    expect(structured.paper).not.toHaveProperty('retracted');
    expect(text).not.toContain('retracted');
  });
});
