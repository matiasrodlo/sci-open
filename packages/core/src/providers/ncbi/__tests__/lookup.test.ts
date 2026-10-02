import { describe, it, expect, vi, beforeEach } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../../lib/http-client-factory', () => ({ getPooledClient: () => ({ get, post }) }));

import { translate } from '../translate';
import { fetchRecord } from '../fetch';
import { lookup } from '../index';

const options = { timeoutMs: 1000 };

/** Trimmed from the live efetch response for PMID 37494408 on 2026-09-04. */
const ARTICLE =
  '<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>37494408</PMID>' +
  '<Article><ArticleTitle>Caregivers&apos; perception and acceptance of malaria vaccine for Children.</ArticleTitle>' +
  '<Journal><Title>PloS one</Title><JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue></Journal>' +
  '</Article></MedlineCitation>' +
  '<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1371/journal.pone.0288686</ArticleId>' +
  '</ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>';

/** What efetch answers for a PMID it does not have: the set, with nothing in it. */
const EMPTY = '<PubmedArticleSet></PubmedArticleSet>';

const ok = (xml: string) => ({ status: 200, data: xml });

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

/**
 * The bug this covers: a PMID was routed through `translate`, which scopes a
 * bare term to the fields a *keyword* belongs in — `(37494408[tiab] OR
 * 37494408[mh])`, searching abstracts and MeSH headings for a number that is
 * in neither. Every PubMed paper URL answered 404.
 */
describe('fetchRecord', () => {
  it('goes straight to efetch, because the id is the key it takes', async () => {
    post.mockResolvedValue(ok(ARTICLE));

    await fetchRecord('37494408', options);

    expect(get).not.toHaveBeenCalled();
    expect(post.mock.calls[0]![0]).toBe('/efetch.fcgi');
    expect(post.mock.calls[0]![1]).toContain('id=37494408');
  });

  it('is not what routing the id through translate produces', () => {
    const asKeyword = translate({ terms: ['37494408'], phrases: [], join: 'AND' });

    expect(asKeyword).toContain('[tiab]');
  });

  it('reads an empty set as an id nobody has, not as an outage', async () => {
    // The search path throws here instead, and rightly: there the ids came
    // from esearch a moment earlier, so an empty set means the provider
    // failed. A lookup is asking about an id the caller supplied.
    post.mockResolvedValue(ok(EMPTY));

    expect(await fetchRecord('0', options)).toEqual({ articles: [] });
  });
});

describe('lookup', () => {
  it('normalises the article into a Paper', async () => {
    post.mockResolvedValue(ok(ARTICLE));

    const paper = await lookup('37494408', options);

    expect(paper?.id).toBe('ncbi:37494408');
    expect(paper?.doi).toBe('10.1371/journal.pone.0288686');
  });

  it('answers null for an id nobody has', async () => {
    post.mockResolvedValue(ok(EMPTY));

    expect(await lookup('0', options)).toBeNull();
  });
});
