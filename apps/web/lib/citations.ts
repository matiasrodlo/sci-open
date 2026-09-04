import { OARecord } from '@open-access-explorer/shared';

/**
 * Two export formats, both correct.
 *
 * There were ten — BibTeX, EndNote, RIS, Web of Science, APA, MLA, Chicago,
 * Harvard, Vancouver and plain text — across 1,027 lines, and not one of them
 * conformed to the style it named. No author reformatting, so "Lovelace, Ada"
 * and "Ada Lovelace" came out however the provider happened to store them;
 * DOIs emitted as `https://doi.org/...` URLs where the field wants a bare
 * `10.x/y`; and APA and Chicago prefixed `https://doi.org/` onto a value that
 * already carried it. A reader who pasted the APA output into a manuscript got
 * something that was not APA.
 *
 * Ten wrong formats is worse than two right ones, and BibTeX and RIS are the
 * two worth keeping: they are machine formats with checkable specifications,
 * they are what reference managers actually ingest, and a reader who wants APA
 * gets it from Zotero — correctly — after importing one of these. The
 * human-readable styles are the ones that need a real CSL implementation to be
 * worth offering, and that is a dependency this app does not carry.
 */

export type CitationFormat = 'bibtex' | 'ris';

export interface CitationOptions {
  format: CitationFormat;
  includeAbstract?: boolean;
  includeKeywords?: boolean;
  includeDOI?: boolean;
  includeURL?: boolean;
  /** Authors beyond this are abbreviated rather than dropped silently. */
  maxAuthors?: number;
}

const DEFAULTS = {
  includeAbstract: true,
  includeKeywords: true,
  includeDOI: true,
  includeURL: true,
  maxAuthors: 20
};

/** The record, reduced to what a citation actually needs. */
type CitationData = {
  title: string;
  authors: string[];
  year?: number;
  venue?: string;
  publisher?: string;
  abstract?: string;
  /** Bare, always: `10.1234/example`, never a URL. */
  doi?: string;
  url?: string;
  keywords: string[];
  language?: string;
  isPreprint: boolean;
};

/**
 * A DOI as the `doi` field of both formats defines it: the bare identifier.
 *
 * Records arrive with it spelled several ways depending on the provider —
 * OpenAlex stores a URL, others store `doi:10.x`, most store it bare. Emitting
 * a URL into a `doi` field is what made APA and Chicago produce
 * `https://doi.org/https://doi.org/10.x`.
 */
export function bareDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
}

function toCitationData(record: OARecord): CitationData {
  const doi = record.doi ? bareDoi(record.doi) : undefined;

  return {
    title: (record.title || '').trim(),
    authors: (record.authors || []).filter(a => a && a.trim()).map(a => a.trim()),
    ...(record.year !== undefined ? { year: record.year } : {}),
    ...(record.venue ? { venue: record.venue } : {}),
    ...(record.publisher ? { publisher: record.publisher } : {}),
    ...(record.abstract ? { abstract: record.abstract } : {}),
    ...(doi ? { doi } : {}),
    // The DOI is the durable link, so it is preferred over whatever landing
    // page a provider recorded.
    url: doi ? `https://doi.org/${doi}` : record.landingPage || record.bestPdfUrl,
    keywords: record.topics || [],
    ...(record.language ? { language: record.language } : {}),
    isPreprint: record.oaStatus === 'preprint'
  };
}

/** Authors, capped, with the convention each format uses for the remainder. */
function cappedAuthors(authors: string[], max: number): { shown: string[]; truncated: boolean } {
  if (authors.length <= max) return { shown: authors, truncated: false };
  return { shown: authors.slice(0, max), truncated: true };
}

/* ------------------------------------------------------------------ BibTeX */

/**
 * The characters BibTeX cannot take literally, and what each becomes.
 *
 * Applied in **one pass**, which is the whole point. The previous version
 * chained ten `.replace` calls with the backslash rule first: `\` became
 * `\textbackslash{}`, and the very next two rules then escaped the braces that
 * replacement had just introduced, so a single backslash came out as
 * `\textbackslash\{\}` — not valid LaTeX for a backslash. `^` and `~` expand
 * to braces too and escaped correctly only by accident, because their rules
 * happened to run after the brace rules rather than before.
 *
 * A single regex pass cannot revisit its own output, so the ordering question
 * does not arise. Recorded as a failing test in phase 01; it passes now.
 */
const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '^': '\\textasciicircum{}',
  '~': '\\textasciitilde{}'
};

export function escapeBibTeX(value: string): string {
  return value.replace(/[\\{}&%$#_^~]/g, char => BIBTEX_ESCAPES[char] ?? char);
}

/**
 * A cite key that is safe to use as one: ASCII, no whitespace, no separators.
 *
 * BibTeX keys are referenced by hand in a document, so they are built from
 * author, year and title rather than from an opaque id.
 */
export function citeKey(data: CitationData): string {
  const surname = (data.authors[0] || '')
    .split(',')[0]
    .split(/\s+/)
    .pop() ?? '';

  const ascii = (value: string) => value.normalize('NFD').replace(/[^a-zA-Z0-9]/g, '');

  const word = data.title
    .split(/\s+/)
    .find(w => ascii(w).length > 3) ?? '';

  const key = [ascii(surname).toLowerCase(), data.year ?? '', ascii(word).toLowerCase()]
    .filter(part => part !== '' && part !== undefined)
    .join('');

  return key || 'citation';
}

function bibtexEntryType(data: CitationData): string {
  if (data.isPreprint) return 'misc';
  return data.venue ? 'article' : 'misc';
}

function generateBibTeXEntry(data: CitationData, options: Required<CitationOptions>): string {
  const fields: Array<[string, string]> = [];
  const add = (name: string, value: string | undefined) => {
    if (value && value.trim()) fields.push([name, escapeBibTeX(value.trim())]);
  };

  const { shown, truncated } = cappedAuthors(data.authors, options.maxAuthors);
  if (shown.length > 0) {
    // ` and ` is the separator; `others` is BibTeX's own "et al.".
    add('author', [...shown, ...(truncated ? ['others'] : [])].join(' and '));
  }

  add('title', data.title);
  if (data.year !== undefined) fields.push(['year', String(data.year)]);
  add(data.venue && !data.isPreprint ? 'journal' : 'howpublished', data.venue);
  add('publisher', data.publisher);
  add('language', data.language);
  if (options.includeDOI) add('doi', data.doi);
  if (options.includeURL) add('url', data.url);
  if (options.includeAbstract) add('abstract', data.abstract);
  if (options.includeKeywords && data.keywords.length > 0) add('keywords', data.keywords.join(', '));

  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(',\n');
  return `@${bibtexEntryType(data)}{${citeKey(data)},\n${body}\n}`;
}

/* --------------------------------------------------------------------- RIS */

/**
 * RIS is line-oriented: a six-character tag, then the value. The spec uses
 * CRLF, every tag is exactly `XX  - `, and `ER  - ` closes the record.
 * A newline inside a value would start a line the parser cannot read, so
 * abstracts are flattened.
 */
function risLine(tag: string, value: string): string {
  return `${tag.padEnd(2)}  - ${value.replace(/\s*\r?\n\s*/g, ' ').trim()}`;
}

function generateRISEntry(data: CitationData, options: Required<CitationOptions>): string {
  const lines: string[] = [];

  lines.push(risLine('TY', data.isPreprint ? 'GEN' : data.venue ? 'JOUR' : 'GEN'));

  const { shown } = cappedAuthors(data.authors, options.maxAuthors);
  // One AU line per author; RIS has no "et al." convention, so extras are
  // simply not claimed.
  for (const author of shown) lines.push(risLine('AU', author));

  if (data.title) lines.push(risLine('TI', data.title));
  if (data.year !== undefined) {
    lines.push(risLine('PY', String(data.year)));
    lines.push(risLine('DA', `${data.year}///`));
  }
  if (data.venue) lines.push(risLine('T2', data.venue));
  if (data.publisher) lines.push(risLine('PB', data.publisher));
  if (data.language) lines.push(risLine('LA', data.language));
  if (options.includeDOI && data.doi) lines.push(risLine('DO', data.doi));
  if (options.includeURL && data.url) lines.push(risLine('UR', data.url));
  if (options.includeAbstract && data.abstract) lines.push(risLine('AB', data.abstract));
  if (options.includeKeywords) for (const keyword of data.keywords) lines.push(risLine('KW', keyword));

  lines.push('ER  - ');
  return lines.join('\r\n');
}

/* ------------------------------------------------------------------- entry */

export function generateCitation(record: OARecord, options: CitationOptions): string {
  const resolved: Required<CitationOptions> = { ...DEFAULTS, ...options };
  const data = toCitationData(record);

  return resolved.format === 'ris'
    ? generateRISEntry(data, resolved)
    : generateBibTeXEntry(data, resolved);
}

/**
 * A batch, with cite keys made unique.
 *
 * Two papers by the same author in the same year produce the same key, and a
 * `.bib` file with a repeated key silently loses one of the entries.
 */
export function generateCitationsBatch(records: OARecord[], options: CitationOptions): string {
  const separator = options.format === 'ris' ? '\r\n\r\n' : '\n\n';
  const entries = records.map(record => generateCitation(record, options));

  if (options.format !== 'bibtex') return entries.join(separator);

  const seen = new Map<string, number>();
  return entries
    .map(entry => {
      const match = entry.match(/^@\w+\{([^,]+),/);
      if (!match) return entry;

      const key = match[1];
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      if (count === 0) return entry;

      // a, b, c ... the convention a bibliography would use anyway.
      const suffix = String.fromCharCode('a'.charCodeAt(0) + count - 1);
      return entry.replace(`{${key},`, `{${key}${suffix},`);
    })
    .join(separator);
}

export function getFileExtension(format: CitationFormat): string {
  return format === 'ris' ? 'ris' : 'bib';
}

export function getMimeType(format: CitationFormat): string {
  return format === 'ris' ? 'application/x-research-info-systems' : 'application/x-bibtex';
}

/**
 * Hands the file to the browser.
 *
 * The revoke is deferred, and that is the whole of what this function had
 * wrong. Revoking straight after `click()` can cancel the download before the
 * browser has finished reading the blob — the anchor's click is dispatched
 * synchronously but the fetch of the object URL is not, so tearing the URL down
 * in the same tick is a race the download sometimes loses. `PaperActions`
 * already deferred it for exactly this reason on the PDF path; this is the same
 * fix on the export path, which produces the larger file of the two and so had
 * the wider window to lose in.
 */
export function downloadCitation(citation: string, filename: string, format: CitationFormat): void {
  const blob = new Blob([citation], { type: `${getMimeType(format)};charset=utf-8` });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
