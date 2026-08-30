import type { AxiosInstance } from 'axios';
import { parseStringPromise } from 'xml2js';
import { getPooledClient } from '../../lib/http-client-factory';
import { getServiceConfig } from '../../lib/http-pool-config';
import { usableApiKey } from '../../lib/api-key';

/**
 * The only I/O in this provider, and it is two calls: esearch returns the
 * PMIDs and the corpus-wide count, efetch returns the records for them.
 *
 * It does not catch and owns no timeout of its own. The old connector wrapped
 * everything in a try/catch returning `{ records: [] }`, so a 414, a parse
 * failure and an empty corpus were the same observable outcome.
 */

const DEFAULT_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * NCBI answered, but not with the thing that was asked for.
 *
 * The same check the OpenAlex 429 and the degraded Europe PMC both needed: a
 * 200 is not on its own evidence that the response carried an answer.
 */
export class NcbiUnavailableError extends Error {
  constructor(detail: string) {
    super(`NCBI returned no usable response: ${detail}`);
    this.name = 'NcbiUnavailableError';
  }
}

export type FetchOptions = {
  baseUrl?: string;
  apiKey?: string;
  pageSize: number;
  offset: number;
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

export type NcbiPayload = {
  /** PubMed's own count of everything matching. */
  totalHits?: number;
  /** The parsed efetch document. Absent when the search matched nothing. */
  articles: unknown[];
};

export async function fetchPage(nativeQuery: string, options: FetchOptions): Promise<NcbiPayload> {
  const {
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    pageSize,
    offset,
    timeoutMs,
    signal,
    userAgent
  } = options;

  const client: AxiosInstance = getPooledClient(baseUrl, getServiceConfig('ncbi'));
  const key = usableApiKey(apiKey);
  const headers = userAgent ? { 'User-Agent': userAgent } : undefined;

  const search = await client.get('/esearch.fcgi', {
    params: {
      db: 'pubmed',
      term: nativeQuery,
      retmax: pageSize,
      retstart: Math.max(offset, 0),
      retmode: 'json',
      usehistory: 'y',
      // esearch's default order is by PMID descending — newest first, not most
      // relevant. Measured: the same query returns 42662940, 42662918,
      // 42662409 by default and 38786024, 27699445, 27059283 by relevance, on
      // an identical count of 13,508. The old connector never set this, so
      // PubMed contributed its most *recent* matches while every other
      // provider contributed its most relevant, and `SourceRef.rank` — which
      // feeds reciprocal rank fusion — carried a date ordering into a
      // relevance fusion.
      sort: 'relevance',
      ...(key ? { api_key: key } : {})
    },
    timeout: timeoutMs,
    ...(signal ? { signal } : {}),
    ...(headers ? { headers } : {})
  });

  const result = search.data?.esearchresult;
  if (!result) {
    // The pooled client resolves 4xx, so a refusal arrives here looking like a
    // success with the wrong body in it.
    throw new NcbiUnavailableError(`esearch body carried no esearchresult (HTTP ${search.status})`);
  }

  const reported = Number(result.count);
  const totalHits = Number.isFinite(reported) ? reported : undefined;
  const pmids: string[] = result.idlist ?? [];

  // A search that matched nothing is a real answer, and there is nothing to
  // fetch for it.
  if (pmids.length === 0) {
    return { articles: [], ...(totalHits !== undefined ? { totalHits } : {}) };
  }

  // The id list goes in a POST body: a few hundred PMIDs overflow the URI
  // length limit and NCBI answers an oversized GET with 414, which the pooled
  // client does not treat as an error — so the failure used to surface only as
  // zero results.
  const body = new URLSearchParams({
    db: 'pubmed',
    id: pmids.join(','),
    retmode: 'xml',
    rettype: 'abstract',
    ...(key ? { api_key: key } : {})
  });

  const fetched = await client.post('/efetch.fcgi', body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(headers ?? {}) },
    timeout: timeoutMs,
    ...(signal ? { signal } : {})
  });

  if (typeof fetched.data !== 'string') {
    throw new NcbiUnavailableError(`efetch returned ${typeof fetched.data}, not XML (HTTP ${fetched.status})`);
  }

  const parsed = await parseStringPromise(fetched.data);
  const articles = parsed?.PubmedArticleSet?.PubmedArticle;

  if (articles === undefined) {
    throw new NcbiUnavailableError(
      `efetch returned no PubmedArticleSet for ${pmids.length} ids it was given`
    );
  }

  return {
    articles: Array.isArray(articles) ? articles : [articles],
    ...(totalHits !== undefined ? { totalHits } : {})
  };
}
