import { describe, it, expect, beforeAll } from 'vitest';
import { NCBIConnector } from '../ncbi';
import { readXml, normalizerOf, expectBaseRecord } from './fixtures';

const normalize = normalizerOf(new NCBIConnector(), 'normalizeArticle');
let articles: any[];

beforeAll(async () => {
  articles = (await readXml('ncbi-efetch.xml')).PubmedArticleSet.PubmedArticle;
});

describe('NCBI normaliser', () => {
  it('maps every article in the fixture without throwing', () => {
    articles.map(a => normalize(a)).filter(Boolean).forEach(r => expectBaseRecord(r!, 'ncbi'));
  });

  it('resolves PMC records to a PMC pdf url', () => {
    const record = normalize(articles[0])!;
    expect(record.oaStatus).toBe('published');
    expect(record.bestPdfUrl).toMatch(/^https:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\/PMC\d+\/pdf\/$/);
  });

  it('carries the venue and a publication year', () => {
    const record = normalize(articles[0])!;
    expect(record.venue).toBeTruthy();
    expect(record.year).toBeGreaterThan(1900);
  });

  /**
   * KNOWN DEFECT — flips to passing when phase 8 fixes NCBI.
   *
   * The DOI is in the record: ArticleIdList carries `IdType="doi"` alongside
   * the pmid and pmc ids, and the extraction loop walks straight past it
   * looking only for `pmc`. Without a DOI a PubMed record cannot deduplicate
   * against any other provider, so the same paper is returned twice whenever
   * PubMed and anyone else both have it.
   */
  it.fails('extracts the DOI from ArticleIdList', () => {
    const ids = articles[0].PubmedData[0].ArticleIdList[0].ArticleId;
    const doiInSource = ids.find((i: any) => i.$?.IdType === 'doi')?._;
    expect(doiInSource).toMatch(/^10\./); // the DOI really is in the payload

    expect(normalize(articles[0])!.doi).toBe(doiInSource);
  });
});
