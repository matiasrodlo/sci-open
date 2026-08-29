import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../../lib/http-client-factory', () => ({
  getPooledClient: () => ({ get, post })
}));

import { fetchPage, NcbiUnavailableError } from '../fetch';

const OPTIONS = { pageSize: 25, offset: 0, timeoutMs: 1000 };

const esearch = (over: Record<string, unknown> = {}) => ({
  status: 200,
  data: { esearchresult: { count: '13508', idlist: ['1', '2'], ...over } }
});

const efetch = (xml: string) => ({ status: 200, data: xml });

const ONE_ARTICLE =
  '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID>' +
  '<Article><ArticleTitle>A title</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe('fetchPage — the ordering PubMed is asked for', () => {
  it('asks for relevance, which is not esearch\'s default', () => {
    // Left unset, esearch orders by PMID descending: the same query returned
    // 42662940, 42662918, 42662409 by default against 38786024, 27699445,
    // 27059283 by relevance, on an identical count. `SourceRef.rank` feeds
    // reciprocal rank fusion, so a date ordering here is not a worse relevance
    // ordering — it is not a relevance ordering at all.
    get.mockResolvedValue(esearch());
    post.mockResolvedValue(efetch(ONE_ARTICLE));

    return fetchPage('crispr', OPTIONS).then(() => {
      expect(get.mock.calls[0][1].params.sort).toBe('relevance');
    });
  });

  it('sends the id list as a POST body', async () => {
    // A few hundred PMIDs overflow the URI length limit and NCBI answers an
    // oversized GET with 414, which the pooled client does not treat as an
    // error — so the failure surfaced only as zero results.
    get.mockResolvedValue(esearch());
    post.mockResolvedValue(efetch(ONE_ARTICLE));

    await fetchPage('crispr', OPTIONS);
    expect(post.mock.calls[0][0]).toBe('/efetch.fcgi');
    expect(post.mock.calls[0][1]).toContain('id=1%2C2');
  });
});

describe('fetchPage — a 200 is not on its own an answer', () => {
  it('throws when esearch returns a body with no esearchresult', async () => {
    // The pooled client resolves 4xx, so a refusal arrives looking like a
    // success with the wrong body in it.
    get.mockResolvedValue({ status: 400, data: { error: 'bad request' } });
    await expect(fetchPage('crispr', OPTIONS)).rejects.toBeInstanceOf(NcbiUnavailableError);
  });

  it('throws when efetch returns something that is not XML', async () => {
    get.mockResolvedValue(esearch());
    post.mockResolvedValue({ status: 200, data: { unexpected: true } });
    await expect(fetchPage('crispr', OPTIONS)).rejects.toThrow(/not XML/);
  });

  it('throws when efetch returns no article set for ids it was given', async () => {
    get.mockResolvedValue(esearch());
    post.mockResolvedValue(efetch('<eFetchResult><ERROR>bad</ERROR></eFetchResult>'));
    await expect(fetchPage('crispr', OPTIONS)).rejects.toThrow(/no PubmedArticleSet/);
  });
});

describe('fetchPage — real answers', () => {
  it('reports the corpus-wide count', async () => {
    get.mockResolvedValue(esearch());
    post.mockResolvedValue(efetch(ONE_ARTICLE));

    const payload = await fetchPage('crispr', OPTIONS);
    expect(payload.totalHits).toBe(13508);
    expect(payload.articles).toHaveLength(1);
  });

  it('does not call efetch when nothing matched', async () => {
    // A search that matched nothing is a real answer, and there is nothing to
    // fetch for it.
    get.mockResolvedValue(esearch({ count: '0', idlist: [] }));

    const payload = await fetchPage('nothing', OPTIONS);
    expect(payload).toEqual({ articles: [], totalHits: 0 });
    expect(post).not.toHaveBeenCalled();
  });

  it('treats a placeholder api key as no key at all', async () => {
    get.mockResolvedValue(esearch());
    post.mockResolvedValue(efetch(ONE_ARTICLE));

    await fetchPage('crispr', { ...OPTIONS, apiKey: 'your_ncbi_api_key_here' });
    expect(get.mock.calls[0][1].params.api_key).toBeUndefined();
  });
});
