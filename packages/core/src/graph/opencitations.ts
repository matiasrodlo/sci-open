import { getPooledClient } from '../lib/http-client-factory';

/**
 * Who cites whom, from the OpenCitations Index: what a paper cites
 * (`references`) and what cites it (`cited_by`), by DOI.
 *
 * The same host the citation-count authority asks, and the same encoding of
 * the DOI. OpenCitations allows 180 requests a minute per address; an access
 * token, sent as `authorization`, raises that. It answers every link at once,
 * with no paging of its own, so a caller pages the list it gets back.
 */

const DEFAULT_BASE_URL = 'https://api.opencitations.net/index/v2';

export type CitationDirection = 'references' | 'cited_by';

/** One link: the work at the other end, by every identifier OpenCitations gives it. */
export type CitationLink = {
  /** In OpenCitations' order, which is not a ranking: see `idsIn`. */
  dois: string[];
  pmid?: string;
  /** When the citing work was published. Only for a paper's citers: for its
   * references the citing work is the paper itself, the same on every link. */
  created?: string;
  journalSelfCitation: boolean;
  authorSelfCitation: boolean;
};

/** The host the index answers from, as the pacing and cool-down name it. */
export const OPENCITATIONS_HOST = 'api.opencitations.net';

/** OpenCitations answered with something other than a list of links. */
export class OpenCitationsUnavailableError extends Error {
  constructor(readonly status: number, detail: string, readonly retryAfterSeconds?: number) {
    super(`OpenCitations ${status}: ${detail}`);
    this.name = 'OpenCitationsUnavailableError';
  }
}

/** `Retry-After` in seconds, when it is a number of them. */
function retryAfter(headers: unknown): number | undefined {
  const raw = (headers as Record<string, unknown> | undefined)?.['retry-after'];
  const seconds = Number(raw);
  return typeof raw === 'string' && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

export type CitationLinkOptions = {
  userAgent: string;
  token?: string;
  timeoutMs?: number;
  baseUrl?: string;
  signal?: AbortSignal;
};

/**
 * The identifiers in a list such as
 * `"omid:br/06101801781 doi:10.7717/peerj-cs.421 openalex:W3134956838 pmid:33817056"`.
 *
 * Every DOI, not the first: one work can carry two, and the first is not
 * reliably the publisher's. Measured 2026-10-02, a reference of
 * 10.7717/peerj-cs.421 is listed as `doi:10.7287/peerj.preprints.26727v1
 * doi:10.7717/peerj-cs.163` — the preprint before the published article.
 * Which one to cite is decided by the records they resolve to. The OpenAlex
 * and OMID ids beside them name records no source here is asked for.
 */
export function idsIn(field: string): { dois: string[]; pmid?: string } {
  const dois: string[] = [];
  let pmid: string | undefined;
  for (const id of field.split(' ')) {
    if (id.startsWith('doi:') && id.length > 4) {
      if (!dois.some(d => d.toLowerCase() === id.slice(4).toLowerCase())) dois.push(id.slice(4));
    } else if (id.startsWith('pmid:') && id.length > 5) pmid ??= id.slice(5);
  }
  return { dois, ...(pmid ? { pmid } : {}) };
}

export async function citationLinks(
  doi: string,
  direction: CitationDirection,
  options: CitationLinkOptions
): Promise<CitationLink[]> {
  const client = getPooledClient(options.baseUrl ?? DEFAULT_BASE_URL);
  const path = `/${direction === 'references' ? 'references' : 'citations'}/doi:${encodeURIComponent(doi)}`;
  const response = await client.get<unknown>(path, {
    // A much-cited paper's list is every citing work at once: measured
    // 2026-10-02, the 24,956 citers of 10.48550/arXiv.1706.03762 came back as
    // 8.5 MB in 15.8 s. Forty seconds, and Crossref's fifteen after it for
    // the records, keep an MCP call under a minute.
    timeout: options.timeoutMs ?? 40_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': options.userAgent,
      ...(options.token ? { authorization: options.token } : {})
    },
    ...(options.signal ? { signal: options.signal } : {})
  });
  // The pooled client resolves a 4xx rather than throwing.
  if (response.status >= 400) {
    throw new OpenCitationsUnavailableError(response.status, response.statusText || 'no message given', retryAfter(response.headers));
  }
  if (!Array.isArray(response.data)) throw new OpenCitationsUnavailableError(response.status, 'a 2xx response carrying no list');

  // The other end of each link: the cited work for a paper's references, the
  // citing one for its citations. An unknown DOI is an empty list, not a 404.
  const end = direction === 'references' ? 'cited' : 'citing';
  return (response.data as Array<Record<string, unknown>>).map(row => ({
    ...idsIn(typeof row[end] === 'string' ? row[end] : ''),
    ...(direction === 'cited_by' && typeof row.creation === 'string' && row.creation ? { created: row.creation } : {}),
    journalSelfCitation: row.journal_sc === 'yes',
    authorSelfCitation: row.author_sc === 'yes'
  }));
}
