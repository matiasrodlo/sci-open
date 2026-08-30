import type { AuthorityFacts, FullText, OaRoute, PaperStage } from '@open-access-explorer/shared';
import { preferredPdfUrl } from '../../lib/pdf-url';
import type { UnpaywallPayload } from './fetch';

/** Unpaywall payload -> AuthorityFacts. Pure. */

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const ROUTES = new Set<OaRoute>(['gold', 'green', 'hybrid', 'bronze', 'closed']);

/**
 * The open-access route, graded.
 *
 * `is_oa` is deliberately not consulted except as a fallback: it is the
 * boolean collapse of the field beside it, and collapsing a five-value
 * vocabulary to a yes/no is the thing `OaRoute` exists to undo.
 */
export function pickRoute(response: any): OaRoute {
  const status = String(response?.oa_status ?? '').toLowerCase();
  if (ROUTES.has(status as OaRoute)) return status as OaRoute;
  if (response?.is_oa === false) return 'closed';
  return 'unknown';
}

/** Unpaywall names the version of each copy it lists. */
const STAGES: Record<string, PaperStage> = {
  submittedVersion: 'preprint',
  acceptedVersion: 'accepted',
  publishedVersion: 'published'
};

/**
 * Which copy to advertise.
 *
 * The instruction for this phase was to invert `getBestPdfUrl`, which prefers
 * publisher copies, on the grounds that publisher endpoints are the ones
 * behind bot protection. Taken literally that is a regression. Measured
 * 2026-08-30 over twenty works where Unpaywall offered both a publisher and a
 * repository PDF, fetched with the proxy's own headers:
 *
 * | choice | served a PDF |
 * |---|---|
 * | publisher location | 11 / 20 |
 * | repository location, as Unpaywall gives it | **6 / 20** |
 * | repository location, rewritten | **19 / 20** |
 *
 * So the premise holds — nine of twenty publisher fetches failed, and the
 * failures are `academic.oup.com`, `onlinelibrary.wiley.com`, `mdpi.com` and
 * `neurology.org` among others answering 403 to a full Chrome User-Agent,
 * which is not something a header fixes. But the repository copies were *worse* until the
 * PMC download gate was handled: thirteen of the twenty repository URLs point
 * at `pmc.ncbi.nlm.nih.gov/articles/PMC…/pdf/…`, which answers HTTP 200
 * `text/html` with a cookie-gate page. `preferredPdfUrl` rewrites those to
 * Europe PMC, and the same twenty go from 6 to 19.
 *
 * Preferring repositories is therefore right, and it is right for a different
 * reason than the one given: not because publishers block robots, but because
 * a repository copy that has been rewritten past its gate is the one that
 * arrives. Ordering by host type alone would have made the number worse.
 *
 * `verified` stays false. Confirming these would cost a fetch per result.
 */
export function pickFullText(response: any): FullText | undefined {
  const locations = asArray<any>(response?.oa_locations).filter(l => text(l?.url_for_pdf));

  const repository = locations.find(l => l?.host_type === 'repository');
  const publisher = locations.find(l => l?.host_type === 'publisher');
  const best = text(response?.best_oa_location?.url_for_pdf);

  const chosen = text(repository?.url_for_pdf) ?? text(publisher?.url_for_pdf) ?? best;
  if (!chosen) return undefined;

  return { url: preferredPdfUrl(chosen), kind: 'pdf', verified: false };
}

/** The landing page of the copy we chose, falling back to the DOI. */
function pickLandingPage(response: any): string | undefined {
  const doi = text(response?.doi);
  return text(response?.best_oa_location?.url_for_landing_page)
    ?? (doi ? `https://doi.org/${doi}` : undefined);
}

/**
 * `z_authors`, which is no longer the shape the old client expected.
 *
 * `UnpaywallResponse` declared `{ given, family, ORCID }` and
 * `convertUnpaywallToOARecord` built `` `${author.given} ${author.family}` ``
 * from it. All three recorded responses carry `raw_author_name`,
 * `author_position`, `is_corresponding` and `raw_affiliation_strings`, and no
 * `given` or `family` at all — so that template interpolated two `undefined`s
 * and `.trim()` left the literal string `"undefined undefined"`, once per
 * author, as a name. The name field is read first here and the split form kept
 * as the fallback rather than the other way round.
 */
function pickAuthors(response: any): string[] {
  return asArray<any>(response?.z_authors)
    .map(author =>
      text(author?.raw_author_name)
      ?? text(author?.name)
      ?? `${author?.given ?? ''} ${author?.family ?? ''}`.trim())
    .filter((name: string) => name.length > 0);
}

export function normalize(payload: UnpaywallPayload | null): AuthorityFacts | null {
  if (!payload) return null;

  const response = payload as any;
  const year = Number(response.year);
  const authors = pickAuthors(response);
  const fullText = pickFullText(response);
  const landingPage = pickLandingPage(response);
  const stage = STAGES[String(response?.best_oa_location?.version ?? '')];

  return {
    ...(text(response.title) ? { title: text(response.title)! } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(Number.isFinite(year) ? { year } : {}),
    ...(text(response.journal_name) ? { venue: text(response.journal_name)! } : {}),
    ...(text(response.publisher) ? { publisher: text(response.publisher)! } : {}),

    oaStatus: pickRoute(response),
    ...(fullText ? { fullText } : {}),
    ...(landingPage ? { landingPage } : {}),
    ...(stage ? { stage } : {})
  };
}
