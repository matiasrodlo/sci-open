import type { FullText, FullTextKind } from './paper';
import { httpUrl } from './url';

/**
 * Whether a URL a provider offered as a copy is a copy at all.
 *
 * `passesPolicy` admits a paper on `fullText` being present, and the header
 * calls what survives "retrievable". Nothing between the two ever asked what
 * the URL pointed at, so a record advertising its own DOI as its full text was
 * counted as a paper you could read.
 *
 * Measured over three live searches — `ai`, `crispr gene editing`, `climate
 * adaptation`, six providers, 600 records each — 1,530 records reached the
 * gate with a non-PDF `fullText`, and the hosts were these:
 *
 * | | records | what the URL is |
 * |---|---|---|
 * | `doi.org` | 791 | the DOI resolver |
 * | `hdl.handle.net` | 74 | the Handle resolver |
 * | `doaj.org/article/…` | 47 | DOAJ's record page |
 * | `dblp.org/rec/…` | 43 | a bibliography entry |
 * | `pubmed.ncbi.nlm.nih.gov/…` | 30 | the abstract page |
 * | `arxiv.org/abs/…` | 20 | the abstract page |
 * | 137 other hosts | 525 | repository and publisher pages |
 *
 * The first six rows are not copies under any reading. A DOI and a Handle are
 * *identifiers*: resolving one lands on whatever page the registrant chose,
 * which is the publisher's, which is where a paywall lives if there is one.
 * The record pages are indexes — dblp holds no documents at all — and an
 * abstract page is the one page of a paper that is free whether or not the
 * paper is. Half of what the retrievability gate was admitting was the paper's
 * own address.
 *
 * The 137-host tail is left alone deliberately. Those are mostly repository
 * landing pages — Zenodo, university portals — where the file usually is one
 * click away, and calling them copies is optimistic where calling them nothing
 * would be a guess. `verified` is where that question gets settled, when
 * something finally sets it.
 *
 * Lives in `shared`, beside `httpUrl`, for the reason given there: the API is
 * where a bad URL should be stopped and the browser is where it would be
 * clicked, and the two should not keep separate ideas of what a copy is.
 */

/** Hosts whose entire job is to redirect to a record's home. */
const RESOLVERS = new Set(['doi.org', 'dx.doi.org', 'hdl.handle.net']);

/**
 * Endpoints that describe a paper rather than hold it.
 *
 * Matched on host *and* path, following `pdf-url.ts`: `arxiv.org` serves both
 * `/abs/` and `/pdf/`, and only one of them is the paper. A host is never
 * rejected outright for that reason.
 */
const RECORD_PAGES: ReadonlyArray<{ host: RegExp; path: RegExp }> = [
  { host: /^(?:www\.)?arxiv\.org$/i, path: /^\/abs\// },
  { host: /^(?:www\.)?dblp\.org$/i, path: /^\/rec\// },
  { host: /^(?:www\.)?doaj\.org$/i, path: /^\/article\// },
  { host: /^pubmed\.ncbi\.nlm\.nih\.gov$/i, path: /^\/\d+/ }
];

/**
 * True when the URL locates the paper rather than carrying it.
 *
 * Exported so the rule can be tested and cited directly; `fullTextAt` is what
 * the normalisers call.
 */
export function isLocator(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
  if (RESOLVERS.has(host)) return true;

  return RECORD_PAGES.some(page => page.host.test(parsed.hostname) && page.path.test(parsed.pathname));
}

/**
 * A `FullText` if this URL is one, `undefined` otherwise.
 *
 * `undefined` rather than a demoted value, for the same reason `httpUrl`
 * returns it: a record whose only advertised copy is its own DOI has no copy,
 * and saying so is what keeps it out of `total` and out of the facets. The
 * address itself is not lost — every normaliser writes it to `landingPage`,
 * which is the field that was always meant to hold it.
 *
 * `verified` is false here and everywhere else. Nothing in the pipeline fetches
 * a copy to confirm it exists, so nothing may claim it did; the field is the
 * slot for the day something does. See `FullText` in `paper.ts`.
 */
export function fullTextAt(url: unknown, kind: FullTextKind): FullText | undefined {
  const usable = httpUrl(url);
  if (!usable || isLocator(usable)) return undefined;
  return { url: usable, kind, verified: false };
}
