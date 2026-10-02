import { describe, it, expect } from 'vitest';
import { parseStringPromise } from 'xml2js';
import { normalize as openalex } from '../providers/openalex/normalize';
import { normalize as europepmc } from '../providers/europepmc/normalize';
import { normalize as ncbi } from '../providers/ncbi/normalize';
import { normalize as openalexFacts } from '../authorities/openalex/normalize';
import { mergePapers } from '../orchestrator/merge';
import { applyFacts } from '../orchestrator/enrich';
import { authorityById } from '../authorities';
import { AT, paper, ref } from '../orchestrator/__tests__/helpers';

/**
 * A retracted paper is the one thing a reference check most needs to say. The
 * flag comes from three sources and must survive a merge whichever record is
 * the base, and an enrichment from OpenAlex. The shapes below are the fields
 * as recorded 2026-10-02 for the Wakefield paper, 10.1016/S0140-6736(97)11096-0,
 * PMID 9500320: OpenAlex `is_retracted: true`, and the MeSH publication type
 * "Retracted Publication" in Europe PMC and PubMed.
 */

const WORK = {
  id: 'https://openalex.org/W2117847125',
  doi: 'https://doi.org/10.1016/s0140-6736(97)11096-0',
  title: 'RETRACTED: Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children',
  publication_year: 1998
};

describe('reading the flag', () => {
  it('takes OpenAlex’s is_retracted, and records nothing for false', () => {
    const { papers } = openalex({ results: [{ ...WORK, is_retracted: true }, { ...WORK, id: 'https://openalex.org/W2', is_retracted: false }] }, { retrievedAt: AT });
    expect(papers[0]!.retracted).toBe(true);
    expect(papers[1]).not.toHaveProperty('retracted');
  });

  it('takes Europe PMC’s “Retracted Publication”, not the notice’s “Retraction of Publication”', () => {
    const record = (pubType: string[]) => ({ id: '9500320', source: 'MED', pmid: '9500320', title: 'A study', pubTypeList: { pubType } });
    const { papers } = europepmc({ resultList: { result: [
      record(['Retracted Publication', "Research Support, Non-U.S. Gov't", 'Journal Article']),
      { ...record(['Retraction of Publication', 'Comment']), id: '1', pmid: '1' }
    ] } } as any, { retrievedAt: AT });
    expect(papers[0]!.retracted).toBe(true);
    expect(papers[1]).not.toHaveProperty('retracted');
  });

  it('takes PubMed’s publication type from the efetch XML', async () => {
    const xml = (type: string, pmid: string) => `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article>
      <ArticleTitle>A study</ArticleTitle>
      <PublicationTypeList><PublicationType UI="D016428">Journal Article</PublicationType><PublicationType UI="D016441">${type}</PublicationType></PublicationTypeList>
    </Article></MedlineCitation></PubmedArticle>`;
    const parsed = await parseStringPromise(`<PubmedArticleSet>${xml('Retracted Publication', '9500320')}${xml('Review', '2')}</PubmedArticleSet>`);
    const { papers } = ncbi(parsed.PubmedArticleSet.PubmedArticle, { retrievedAt: AT });
    expect(papers[0]!.retracted).toBe(true);
    expect(papers[1]).not.toHaveProperty('retracted');
  });
});

describe('keeping the flag', () => {
  it('survives a merge whichever source is the base', () => {
    const doi = '10.1016/s0140-6736(97)11096-0';
    const flagged = paper({ id: 'openalex:W2117847125', doi, retracted: true, sources: [ref('openalex', { nativeId: 'W2117847125' })] });
    // Europe PMC outranks OpenAlex as the base, and did not flag it.
    const unflagged = paper({ id: 'europepmc:9500320', doi, sources: [ref('europepmc', { nativeId: '9500320' })] });

    for (const order of [[flagged, unflagged], [unflagged, flagged]]) {
      const [merged] = mergePapers(order);
      expect(merged!.retracted).toBe(true);
    }
  });

  it('is filled in by OpenAlex as an authority', () => {
    const facts = openalexFacts({ results: [{ ...WORK, is_retracted: true }] });
    expect(facts).toMatchObject({ retracted: true });

    const target = paper({ id: 'crossref:x', doi: '10.1016/s0140-6736(97)11096-0' });
    applyFacts(target, facts!, authorityById('openalex')!);
    expect(target.retracted).toBe(true);
    expect(target.fieldSources.retracted).toBe('openalex');
  });
});
