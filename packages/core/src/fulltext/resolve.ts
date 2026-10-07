import type { Paper } from '@sci-open/shared';
import { getPooledClient } from '../lib/http-client-factory';
import { ARXIV_PACER, pacerFor, SourceBusyError } from '../lib/host-pacer';
import { log } from '../lib/logger';
import { jatsToSections } from './jats';
import { arxivHtmlToSections } from './html';
import { pdfToSections } from './pdf';
import type { FullTextDocument, FullTextTier, Section } from './types';

const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const ARXIV_DOI = /^10\.48550\/arxiv\.(.+)$/i;

/** How long a paced host may hold a call before its tier is deferred: time to
 * queue behind one other reader, and well inside an HTTP request's budget. */
const MAX_WAIT_MS = 20_000;

export type ResolveOptions = {
  userAgent: string;
  /** Europe PMC and arXiv only: never fetch from an arbitrary publisher host. */
  trustedOnly: boolean;
  timeoutMs?: number;
  maxWaitMs?: number;
  /** Stops the read: the request out is aborted and no further tier is tried. */
  signal?: AbortSignal;
  now?: () => Date;
};

type Parsed = { title?: string; license?: string; sections: Section[] };

/**
 * The best-structured legal copy of a paper, or null.
 *
 * Best structure first: Europe PMC's JATS (real sections), then arXiv's HTML
 * rendering (real sections), then the PDF the record points at (pages). A tier
 * that fails falls through to the next. A tier that is only deferred — a paced
 * host with no slot soon enough — turns "none" into "later": if no tier has a
 * copy, the earliest `SourceBusyError` is thrown instead of returning null,
 * because the paper has a copy that cannot be fetched yet.
 *
 * The pooled clients resolve a 4xx rather than throw, so every response is
 * checked for its status.
 *
 * `definitive` is false when no copy was found but some tier failed rather
 * than answering: a timeout is not evidence that there is no copy, and a miss
 * held on it would hide one for as long as misses are held.
 *
 * An aborted `signal` rejects with its reason, whatever tier it stopped: a
 * read that was stopped found nothing either way, and says so rather than
 * "no copy".
 */
export async function resolveFullText(paper: Paper, options: ResolveOptions): Promise<{ doc: FullTextDocument | null; definitive: boolean }> {
  const tiers: Array<[FullTextTier, () => Promise<FullTextDocument | null>]> = [
    ['europepmc-jats', () => fromEuropePmc(paper, options)],
    ['arxiv-html', () => fromArxivHtml(paper, options)]
  ];
  if (!options.trustedOnly) tiers.push(['pdf', () => fromPdf(paper, options)]);

  let busy: SourceBusyError | undefined;
  let failed = false;
  for (const [tier, attempt] of tiers) {
    options.signal?.throwIfAborted();
    try {
      const doc = await attempt();
      if (doc && doc.sections.some(s => s.text)) return { doc, definitive: true };
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof SourceBusyError) {
        if (!busy || error.retryAfterMs < busy.retryAfterMs) busy = error;
      } else {
        failed = true;
        log.debug('Full-text tier failed', { tier, paper: paper.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  // A tier can answer "none" for a request the signal cut off.
  options.signal?.throwIfAborted();
  if (busy) throw busy;
  return { doc: null, definitive: !failed };
}

async function fromEuropePmc(paper: Paper, options: ResolveOptions): Promise<FullTextDocument | null> {
  const pmid = paper.sources.find(s => s.provider === 'ncbi')?.nativeId;
  const query = paper.doi ? `DOI:"${paper.doi}"` : pmid ? `EXT_ID:${pmid} AND SRC:MED` : undefined;
  if (!query) return null;

  const client = getPooledClient(EPMC);
  const timeout = options.timeoutMs ?? 15_000;
  const found = await client.get('/search', {
    params: { query, resultType: 'core', format: 'json', pageSize: 1 },
    timeout,
    headers: { Accept: 'application/json', 'User-Agent': options.userAgent },
    ...(options.signal ? { signal: options.signal } : {})
  });
  const hit = found.status === 200 ? found.data?.resultList?.result?.[0] : undefined;
  if (!hit?.pmcid || hit.isOpenAccess !== 'Y' || hit.inEPMC !== 'Y') return null;

  const path = `/${encodeURIComponent(hit.pmcid)}/fullTextXML`;
  const xml = await client.get<string>(path, {
    responseType: 'text',
    timeout,
    headers: { Accept: 'application/xml', 'User-Agent': options.userAgent },
    ...(options.signal ? { signal: options.signal } : {})
  });
  if (xml.status !== 200 || typeof xml.data !== 'string') return null;
  return documentOf(paper, 'europepmc-jats', `${EPMC}${path}`, jatsToSections(xml.data), options);
}

/** The arXiv id a record carries, as a source or as arXiv's own DOI; the
 * version, where there is one, is kept, so the copy read is the one cited. */
function arxivIdOf(paper: Paper): string | undefined {
  return paper.sources.find(s => s.provider === 'arxiv')?.nativeId ?? paper.doi?.match(ARXIV_DOI)?.[1];
}

async function fromArxivHtml(paper: Paper, options: ResolveOptions): Promise<FullTextDocument | null> {
  const id = arxivIdOf(paper);
  if (!id) return null;

  const client = getPooledClient('https://arxiv.org');
  const path = `/html/${encodeURI(id)}`; // encodeURI: old-style ids (hep-th/9901001) keep their slash
  await ARXIV_PACER.acquire(options.maxWaitMs ?? MAX_WAIT_MS, options.signal);
  const page = await client.get<string>(path, {
    responseType: 'text',
    timeout: options.timeoutMs ?? 15_000,
    headers: { Accept: 'text/html', 'User-Agent': options.userAgent },
    ...(options.signal ? { signal: options.signal } : {})
  });
  // 404 is "no rendering"; a 200 that is not a LaTeXML document is not one either.
  if (page.status !== 200 || typeof page.data !== 'string' || !page.data.includes('ltx_document')) return null;
  return documentOf(paper, 'arxiv-html', `https://arxiv.org${path}`, arxivHtmlToSections(page.data), options);
}

async function fromPdf(paper: Paper, options: ResolveOptions): Promise<FullTextDocument | null> {
  const copy = paper.fullText;
  if (!copy || copy.kind !== 'pdf') return null;
  // An arXiv-hosted PDF is under the same Crawl-delay as its HTML.
  await pacerFor(copy.url)?.acquire(options.maxWaitMs ?? MAX_WAIT_MS, options.signal);
  // Only a URL from the engine's own record is ever fetched; the SSRF guard
  // inside pdfToSections is the second line, not the first.
  return documentOf(paper, 'pdf', copy.url, { sections: await pdfToSections(copy.url, options.userAgent, options.signal) }, options);
}

function documentOf(paper: Paper, tier: FullTextTier, url: string, parsed: Parsed, options: ResolveOptions): FullTextDocument {
  return {
    paperId: paper.id,
    tier,
    url,
    ...(parsed.license ? { license: parsed.license } : {}),
    ...(parsed.title ? { title: parsed.title } : {}),
    sections: parsed.sections,
    totalChars: parsed.sections.reduce((n, s) => n + s.text.length, 0),
    retrievedAt: (options.now?.() ?? new Date()).toISOString()
  };
}
