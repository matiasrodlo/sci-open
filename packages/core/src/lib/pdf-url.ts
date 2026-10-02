/**
 * URLs that are advertised as PDFs and do not serve one, and what to ask for
 * instead.
 *
 * Phase 09 was told to prefer repository PDFs over publisher PDFs, on the
 * grounds that "publisher endpoints are the ones behind bot protection". Half
 * of that is true and the remedy is not. Measured 2026-08-30 over ten works
 * where Unpaywall offered both a publisher and a repository PDF, fetched with
 * the proxy's own headers:
 *
 * | | served a PDF |
 * |---|---|
 * | publisher location | **7 / 10** |
 * | repository location | **1 / 10** |
 *
 * The three publisher failures are real bot protection — `academic.oup.com`
 * and `onlinelibrary.wiley.com` answer **403**, and they answer it to a full
 * Chrome User-Agent too, so it is not something a header fixes. But eight of
 * the nine repository failures were one host doing one thing:
 * `pmc.ncbi.nlm.nih.gov/articles/PMC…/pdf/…` answers **HTTP 200 text/html**
 * with a "Preparing to download …" cookie-gate page, no redirect, to every
 * User-Agent tried. It is not a PDF endpoint at all.
 *
 * So the axis in the instruction is the wrong one. Host *type* does not
 * predict whether a file arrives; the specific host does. What does pay is
 * knowing that Europe PMC mirrors PMC and serves the same article's PDF
 * without a gate: rewriting those eight URLs to `europepmc.org/articles/
 * PMC…?pdf=render` returned a real PDF **8 / 8**.
 *
 * The Europe PMC provider already emits that form (`providers/europepmc/
 * normalize.ts`). This is the same knowledge in one place, so the authority
 * that learns a URL from Unpaywall and the proxy that fetches it cannot
 * disagree about it.
 */

/**
 * PMC's own PDF path, in both the current and legacy spellings.
 *
 * Matching on the path rather than on the whole URL because the gate is a
 * property of the endpoint, not of the article: every `…/articles/PMCn/pdf/…`
 * on either host answers with the interstitial.
 */
const PMC_PDF = /^(?:pmc\.ncbi\.nlm\.nih\.gov|www\.ncbi\.nlm\.nih\.gov)$/i;
const PMC_PATH = /\/(?:pmc\/)?articles\/(PMC\d+)\/pdf(?:\/|$)/i;

/** True when this URL answers a robot with something other than the file. */
export function servesInterstitial(url: string): boolean {
  return pmcIdOf(url) !== undefined;
}

function pmcIdOf(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!PMC_PDF.test(parsed.hostname)) return undefined;
  return parsed.pathname.match(PMC_PATH)?.[1];
}

/**
 * The URL to fetch instead, where a better one is known.
 *
 * Returns the input unchanged for everything else, including the publisher
 * endpoints that answer 403 — there is no alternative to substitute for those,
 * and pretending otherwise would trade a measured failure for a guess.
 */
export function preferredPdfUrl(url: string): string {
  const pmcid = pmcIdOf(url);
  return pmcid ? `https://europepmc.org/articles/${pmcid}?pdf=render` : url;
}
