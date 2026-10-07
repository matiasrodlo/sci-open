import type { AuthorityFacts, FullText, PaperStage } from '@sci-open/shared';
import { biblioOf, fullTextAt, splitPages, stripMarkup, withBiblio } from '@sci-open/shared';
import type { CrossrefPayload } from './fetch';

/** Crossref payload -> AuthorityFacts. Pure. */

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const first = (value: unknown): string | undefined => {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
};

/**
 * A fetchable PDF, and only a fetchable one.
 *
 * The old `extractPdfLink` accepted a link if its content type was
 * `application/pdf` **or** its `intended-application` was `text-mining`, with
 * no other condition — so for `10.1016/j.cell.2014.05.010`, whose only
 * text-mining links are `text/plain` and `text/xml`, it wrote a plain-text URL
 * into `bestPdfUrl`. The content type is the thing that was actually being
 * asked about, so it is the thing that is tested.
 *
 * `similarity-checking` links are excluded as well: they exist for plagiarism
 * services and are not a promise of public access.
 */
export function pickFullText(work: any): FullText | undefined {
  const link = asArray<any>(work?.link).find(
    l => String(l?.['content-type'] ?? '').toLowerCase() === 'application/pdf'
      && String(l?.['intended-application'] ?? '') !== 'similarity-checking'
  );

  return fullTextAt(link?.URL, 'pdf');
}

/**
 * Crossref's `type`, which is the closest it comes to reporting a version.
 *
 * `posted-content` is a preprint server deposit, and the rest here are the
 * published versions of articles, books and chapters. Crossref types an
 * editorial or an erratum `journal-article` too, which is why a stage it
 * supplies fills an `unknown` on a page but never settles a filter.
 */
const STAGES: Record<string, PaperStage> = {
  'journal-article': 'published',
  'proceedings-article': 'published',
  'book-chapter': 'published',
  book: 'published',
  monograph: 'published',
  // Not `reference-entry`, `dissertation` or `report`: what `published` stands
  // for is a reviewed article, review, book or chapter.
  'posted-content': 'preprint'
};

/**
 * The publication year.
 *
 * `published-print` first, then `published-online`, matching the old client —
 * a paper's year is the year of the version of record where there is one.
 */
function pickYear(work: any): number | undefined {
  const parts =
    work?.['published-print']?.['date-parts']?.[0]?.[0] ??
    work?.['published-online']?.['date-parts']?.[0]?.[0] ??
    work?.issued?.['date-parts']?.[0]?.[0];
  const year = Number(parts);
  return Number.isFinite(year) ? year : undefined;
}

function pickAuthors(work: any): string[] {
  return asArray<any>(work?.author)
    .map(author => {
      if (typeof author?.name === 'string' && author.name.trim()) return author.name.trim();
      return `${author?.given ?? ''} ${author?.family ?? ''}`.trim();
    })
    .filter((name: string) => name.length > 0);
}

/**
 * The title with its subtitle, which Crossref keeps apart: "MapReduce" and
 * "simplified data processing on large clusters". A title read alone is not
 * the one a citation gives — OpenAlex's records carry it so, and correct
 * citations of both papers were taken for DOIs on other works.
 */
function pickTitle(work: any): string | undefined {
  const title = stripMarkup(first(work.title));
  const subtitle = stripMarkup(first(work.subtitle));
  if (!title || !subtitle || title.toLowerCase().includes(subtitle.toLowerCase())) return title;
  return `${title}: ${subtitle}`;
}

/**
 * The notices that leave a work standing no longer, as Crossref's `updated-by`
 * names them: the publisher's own deposits, and Retraction Watch's database,
 * which Crossref now carries (`source: "retraction-watch"`). Wakefield et al.
 * 1998 in The Lancet lists a correction from 2004 and the retraction of 2010.
 * A correction, an erratum or an expression of concern is not one of them.
 */
const RETRACTING = new Set(['retraction', 'withdrawal', 'removal']);

const isRetracted = (work: any): boolean =>
  asArray<any>(work?.['updated-by']).some(update => RETRACTING.has(String(update?.type ?? '').toLowerCase()));

export function normalize(payload: CrossrefPayload | null): AuthorityFacts | null {
  const work = (payload as any)?.message;
  return work ? normalizeWork(work) : null;
}

/** One Crossref work, as a single-DOI request's `message` or a list's `items` carry it. Pure. */
export function normalizeWork(work: any): AuthorityFacts {

  // Crossref ships both of these as JATS, tags and all — the recorded page's
  // abstract begins `<jats:title>Abstract</jats:title><jats:p>CRISPR/Cas9
  // technology…`, and its titles carry `<i>` and `<sub>` for species names and
  // formulae. The old path passed them straight into `AuthorityFacts`, so the
  // markup reached the browser.
  const title = pickTitle(work);
  const venue = first(work['container-title']) ?? first(work['short-container-title']);
  const year = pickYear(work);
  const abstract = stripMarkup(work.abstract);
  const authors = pickAuthors(work);
  const topics = asArray<string>(work.subject).filter(s => typeof s === 'string' && s.trim());
  const citationCount = Number(work['is-referenced-by-count']);
  const fullText = pickFullText(work);
  const doi = typeof work.DOI === 'string' ? work.DOI : undefined;
  const stage = STAGES[String(work.type ?? '')];

  return {
    ...(title ? { title } : {}),
    ...(abstract ? { abstract } : {}),
    ...(authors.length > 0 ? { authors } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...withBiblio(biblioOf({
      volume: work.volume, issue: work.issue,
      // An article number stands in for pages where there are none.
      ...(work.page ? splitPages(work.page) : { firstPage: work['article-number'] })
    })),
    ...(first(work.publisher) ? { publisher: first(work.publisher)! } : {}),
    ...(topics.length > 0 ? { topics } : {}),
    ...(first(work.language) ? { language: first(work.language)! } : {}),
    ...(Number.isFinite(citationCount) ? { citationCount } : {}),
    ...(fullText ? { fullText } : {}),
    ...(doi ? { landingPage: `https://doi.org/${doi}` } : {}),
    ...(stage ? { stage } : {}),
    ...(isRetracted(work) ? { retracted: true as const } : {})
  };
}
