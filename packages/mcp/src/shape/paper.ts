import * as z from 'zod';
import type { Paper } from '@sci-open/shared';
import { pagesOf } from '@sci-open/shared';
import { sanitizeText } from '../safety/sanitize';

/** Drops undefined, null, empty strings and empty arrays, so the model never
 * reads `null` noise. `keep` names fields that stay even when empty, because
 * the schema promises them. */
export function compact<T extends Record<string, unknown>>(obj: T, keep: readonly string[] = []): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([k, v]) =>
      keep.includes(k) ? v !== undefined : v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))
  ) as Partial<T>;
}

export function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`;
}

export function abbreviateAuthors(authors: readonly string[], max: number): string[] {
  const shown = authors.slice(0, max).map(a => sanitizeText(a));
  return authors.length > max ? [...shown, `+${authors.length - max} more`] : shown;
}

export const paperSchema = z.object({
  /** A source records this work as retracted. First, so it is read first. */
  retracted: z.literal(true).optional(),
  id: z.string(),
  doi: z.string().optional(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().optional(),
  venue: z.string().optional(),
  access: z.enum(['gold', 'green', 'hybrid', 'bronze', 'closed', 'unknown']),
  stage: z.enum(['preprint', 'accepted', 'published', 'unknown']),
  full_text: z.object({ kind: z.enum(['pdf', 'html', 'xml']), verified: z.boolean(), url: z.string().optional() }).optional(),
  citations: z.number().int().optional(),
  found_in: z.array(z.string()),
  abstract: z.string().optional(),
  // full view only
  volume: z.string().optional(),
  issue: z.string().optional(),
  /** First–last page, or the article number that stands in for pages. */
  pages: z.string().optional(),
  publisher: z.string().optional(),
  topics: z.array(z.string()).optional(),
  language: z.string().optional(),
  landing_page: z.string().optional(),
  sources: z.array(z.object({ source: z.string(), native_id: z.string(), rank: z.number().int(), retrieved_at: z.string() })).optional(),
  field_sources: z.record(z.string(), z.string()).optional()
});
export type ShapedPaper = z.infer<typeof paperSchema>;

/** What the schema promises on every paper, kept even when empty. */
const ALWAYS = ['id', 'title', 'authors', 'access', 'stage', 'found_in'];

/**
 * A `Paper` as a tool returns it. `concise` is the default everywhere: three
 * authors and the rest counted, the abstract cut at a word near 280
 * characters, no per-field attribution. `full` is every field, with which
 * source supplied each.
 *
 * `found_in` lists every source that returned the paper — which indexes
 * hold it, not a mark of quality — for a search or a DOI lookup, which ask
 * every source and merge. A lookup by id asks one. `full_text.verified` is always
 * shown: false means a source claimed a copy and nobody checked, not that
 * there is none.
 */
export function shapePaper(p: Paper, detail: 'concise' | 'full'): ShapedPaper {
  const full = detail === 'full';
  return compact({
    ...(p.retracted ? { retracted: true as const } : {}),
    id: p.id,
    doi: p.doi,
    title: sanitizeText(p.title),
    authors: full ? p.authors.map(a => sanitizeText(a)) : abbreviateAuthors(p.authors, 3),
    year: p.year,
    venue: p.venue ? sanitizeText(p.venue) : undefined,
    access: p.oaStatus,
    stage: p.stage,
    full_text: p.fullText
      ? { kind: p.fullText.kind, verified: p.fullText.verified, ...(full ? { url: p.fullText.url } : {}) }
      : undefined,
    citations: p.citationCount,
    found_in: [...new Set(p.sources.map(s => s.provider))],
    abstract: p.abstract ? (full ? sanitizeText(p.abstract) : truncateAtWord(sanitizeText(p.abstract), 280)) : undefined,
    ...(full
      ? {
          volume: p.biblio?.volume ? sanitizeText(p.biblio.volume) : undefined,
          issue: p.biblio?.issue ? sanitizeText(p.biblio.issue) : undefined,
          pages: pagesOf(p.biblio) ? sanitizeText(pagesOf(p.biblio)!) : undefined,
          publisher: p.publisher ? sanitizeText(p.publisher) : undefined,
          topics: p.topics.map(t => sanitizeText(t)),
          language: p.language,
          landing_page: p.landingPage,
          sources: p.sources.map(s => ({ source: s.provider, native_id: s.nativeId, rank: s.rank, retrieved_at: s.retrievedAt })),
          field_sources: p.fieldSources as Record<string, string>
        }
      : {})
  }, ALWAYS) as ShapedPaper;
}

/**
 * Where in its venue a record is, as a citation gives it: `346(6213):1258096`,
 * or nothing when no source said.
 */
export function placeIn(p: Pick<ShapedPaper, 'volume' | 'issue' | 'pages'>): string {
  return `${p.volume ?? ''}${p.issue ? `(${p.issue})` : ''}${p.pages ? `${p.volume || p.issue ? ':' : 'pp. '}${p.pages}` : ''}`;
}

/**
 * A title as a list shows it: marked when the paper is retracted, unless the
 * title already says so — publishers often rename a retracted article
 * "RETRACTED: …", and Crossref carries that title.
 */
export function listedTitle(p: { retracted?: true; title: string }): string {
  return p.retracted && !/^\s*retracted\b/i.test(p.title) ? `RETRACTED — ${p.title}` : p.title;
}

/**
 * The server's own warning about retracted papers, for the top of a text: out
 * of the untrusted fence, because it is this server's statement, not the
 * source's. `labels` name them as the rendering numbers or names them.
 */
export function retractionWarning(labels: readonly string[]): string {
  if (!labels.length) return '';
  const which = labels.length === 1 ? `${labels[0]} is` : `${labels.join(', ')} are`;
  return `**Warning: ${which} recorded as retracted.** A retracted paper is not evidence; do not cite it as support.`;
}
