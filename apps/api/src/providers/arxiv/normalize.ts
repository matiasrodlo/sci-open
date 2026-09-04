import type { Paper, FullText, SourceRef } from '@open-access-explorer/shared';
import { httpUrl } from '@open-access-explorer/shared';
import type { ArxivFeed } from './fetch';

/**
 * Parsed Atom feed -> Paper[]. Pure, and isolated per record.
 *
 * One bad entry costs one entry. The old connector mapped the whole feed in a
 * single expression inside a try/catch that rejected the promise, so one
 * unreadable record discarded the page and arXiv was recorded as having
 * returned nothing.
 */

export type NormalizeOptions = {
  /** Stamped onto every SourceRef. Passed in so normalisation stays pure and testable. */
  retrievedAt: string;
  /** Rank of the first record in this page, for paged reads. */
  rankOffset?: number;
  /** Round trip time of the request that produced this payload, if known. */
  latency?: number;
};

export type SkippedRecord = {
  index: number;
  nativeId?: string;
  reason: string;
};

export type NormalizeOutcome = {
  papers: Paper[];
  skipped: SkippedRecord[];
};

/**
 * arXiv reports a failed query as a feed containing one entry whose id is the
 * errors endpoint — with, in the cases measured, an HTTP 500 alongside it.
 *
 * It has a title ("Error"), an author ("arXiv api core") and a summary, so
 * nothing about its shape stops a normaliser turning it into a paper. Had the
 * status been 200, the old connector would have returned it as a search
 * result. Recognising it here means a malformed query is reported as a
 * provider error rather than answered with a fabricated record.
 */
const ERROR_ENTRY = 'arxiv.org/api/errors';

export class ArxivQueryError extends Error {
  constructor(detail: string) {
    super(`arXiv rejected the query: ${detail}`);
    this.name = 'ArxivQueryError';
  }
}

function first(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/**
 * Atom carries text with the source document's line wrapping still in it.
 *
 * Deliberately not `stripMarkup`, which every other provider's title and
 * abstract goes through. arXiv metadata is LaTeX, not markup: it has no tags
 * to remove, and `<` and `>` in an abstract are inequalities — `$n < m$`,
 * `p > 0.05`. There is nothing to gain here and a class of abstract to damage.
 */
function flatten(value: unknown): string | undefined {
  const text = first(value);
  return text ? text.replace(/\s+/g, ' ').trim() : undefined;
}

type Link = { $?: { href?: string; type?: string; rel?: string } };

function pickFullText(entry: any): FullText | undefined {
  const links: Link[] = Array.isArray(entry?.link) ? entry.link : [];
  const pdf = httpUrl(links.find(l => l.$?.type === 'application/pdf')?.$?.href);
  if (!pdf) return undefined;

  // arXiv still advertises some links over http. Serving one to a browser on
  // an https page gets it blocked as mixed content.
  return { url: pdf.replace(/^http:\/\//, 'https://'), kind: 'pdf', verified: false };
}

function pickAuthors(entry: any): string[] {
  const authors = Array.isArray(entry?.author) ? entry.author : [];
  return authors.map((a: any) => flatten(a?.name)).filter((n: unknown): n is string => Boolean(n));
}

function pickTopics(entry: any): string[] {
  const categories = Array.isArray(entry?.category) ? entry.category : [];
  return categories
    .map((c: any) => c?.$?.term)
    .filter((t: unknown): t is string => typeof t === 'string' && t.length > 0);
}

function normalizeOne(entry: any, ref: SourceRef): Paper {
  const url = first(entry?.id);
  if (!url) throw new Error('entry has no id');

  const nativeId = url.split('/').pop() ?? '';
  if (!nativeId) throw new Error('entry id has no arXiv identifier in it');

  const title = flatten(entry?.title);
  if (!title) throw new Error('entry has no title');

  const published = first(entry?.published);
  const year = published ? new Date(published).getFullYear() : undefined;

  // `arxiv:doi` is the DOI of the published version, which arXiv supplies once
  // the preprint has appeared. The old connector never read it, so an arXiv
  // record could not deduplicate against the same paper from any other
  // provider — it fell back to a title-and-year key, and the preprint's
  // submission year rarely matches the publication year, so the two survived
  // as separate results.
  const doi = flatten(entry?.['arxiv:doi']);

  // `arxiv:journal_ref` is where the preprint was published, when it has been.
  const venue = flatten(entry?.['arxiv:journal_ref']);

  const fullText = pickFullText(entry);

  return {
    id: `arxiv:${nativeId}`,
    ...(doi ? { doi } : {}),
    title,
    authors: pickAuthors(entry),
    ...(Number.isFinite(year) ? { year } : {}),
    ...(venue ? { venue } : {}),
    ...(flatten(entry?.summary) ? { abstract: flatten(entry?.summary)! } : {}),
    topics: pickTopics(entry),
    // arXiv reports no language. Its metadata is English by submission policy,
    // which is why the old connector stamped every record `en` and why that is
    // kept — but it is a fact about the corpus, not a field arXiv returns.
    language: 'en',

    // The route is Unpaywall's vocabulary to supply during enrichment. What is
    // known here is that arXiv holds a freely retrievable copy, and `fullText`
    // is where that belongs.
    oaStatus: 'unknown',
    // The arXiv copy is the author's version even when `arxiv:doi` says a
    // published one exists elsewhere. Where the two are merged, the published
    // record has the higher provider priority and its stage wins.
    stage: 'preprint',
    ...(fullText ? { fullText } : {}),
    landingPage: url,

    sources: [ref],
    fieldSources: {},
    retrievedAt: ref.retrievedAt
  };
}

export function normalize(payload: ArxivFeed, options: NormalizeOptions): NormalizeOutcome {
  const { retrievedAt, rankOffset = 0, latency } = options;
  const entries = (payload?.feed?.entry ?? []) as any[];

  const rejected = entries.find(e => first(e?.id)?.includes(ERROR_ENTRY));
  if (rejected) {
    throw new ArxivQueryError(flatten(rejected?.summary) ?? 'no reason given');
  }

  const papers: Paper[] = [];
  const skipped: SkippedRecord[] = [];

  entries.forEach((entry, index) => {
    const nativeId = first(entry?.id)?.split('/').pop() ?? '';
    const ref: SourceRef = {
      provider: 'arxiv',
      nativeId,
      // Position in arXiv's own result list — provenance, and the input to
      // rank fusion.
      rank: rankOffset + index,
      retrievedAt,
      ...(latency !== undefined ? { latency } : {})
    };

    try {
      papers.push(normalizeOne(entry, ref));
    } catch (error) {
      skipped.push({
        index: rankOffset + index,
        ...(nativeId ? { nativeId } : {}),
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return { papers, skipped };
}

/** arXiv's corpus-wide count for this query, when the feed carries one. */
export function totalHits(payload: ArxivFeed): number | undefined {
  const raw = payload?.feed?.['opensearch:totalResults'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const reported = Number(typeof value === 'object' && value !== null ? (value as any)._ : value);
  return Number.isFinite(reported) ? reported : undefined;
}
