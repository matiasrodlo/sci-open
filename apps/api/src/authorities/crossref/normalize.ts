import type { AuthorityFacts, FullText, PaperStage } from '@open-access-explorer/shared';
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
 * Crossref ships abstracts as JATS, tags and all — the recorded page begins
 * `<jats:title>Abstract</jats:title><jats:p>CRISPR/Cas9 technology…`. The old
 * path passed that straight through to `OARecord.abstract`, so the markup
 * reached the browser.
 *
 * The leading `Abstract` heading goes too. It is the label the field already
 * has, repeated inside its own value.
 */
export function stripJats(markup: string): string {
  return markup
    .replace(/<jats:title>\s*abstract\s*<\/jats:title>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  const url = typeof link?.URL === 'string' ? link.URL : undefined;
  return url ? { url, kind: 'pdf', verified: false } : undefined;
}

/**
 * Crossref's `type`, which is the closest it comes to reporting a version.
 *
 * `posted-content` is a preprint server deposit; everything else Crossref
 * registers is a published record of some kind.
 */
const STAGES: Record<string, PaperStage> = {
  'journal-article': 'published',
  'proceedings-article': 'published',
  'book-chapter': 'published',
  book: 'published',
  monograph: 'published',
  'reference-entry': 'published',
  dissertation: 'published',
  report: 'published',
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

export function normalize(payload: CrossrefPayload | null): AuthorityFacts | null {
  const work = (payload as any)?.message;
  if (!work) return null;

  const title = first(work.title);
  const venue = first(work['container-title']) ?? first(work['short-container-title']);
  const year = pickYear(work);
  const abstract = typeof work.abstract === 'string' ? stripJats(work.abstract) : undefined;
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
    ...(first(work.publisher) ? { publisher: first(work.publisher)! } : {}),
    ...(topics.length > 0 ? { topics } : {}),
    ...(first(work.language) ? { language: first(work.language)! } : {}),
    ...(Number.isFinite(citationCount) ? { citationCount } : {}),
    ...(fullText ? { fullText } : {}),
    ...(doi ? { landingPage: `https://doi.org/${doi}` } : {}),
    ...(stage ? { stage } : {})
  };
}
