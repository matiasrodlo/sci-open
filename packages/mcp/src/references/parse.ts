/**
 * A free-text reference, taken apart into what can be looked up: its
 * identifiers, its year, its authors' surnames and its title.
 *
 * Grown from `test/fixtures/references.json`, one case per citation style met
 * in the wild (APA, Vancouver, IEEE, Nature, Chicago, BibTeX, arXiv listings).
 * A style that parses wrongly gets a case there first. The parser is
 * deliberately conservative about authors: a surname it is not sure of would
 * become an `author_mismatch` against a real paper, so when it cannot tell
 * where the author list ends it reports none.
 */
export type ParsedReference = {
  raw: string;
  doi?: string;
  arxiv?: string;
  pmid?: string;
  year?: number;
  surnames: string[];
  title?: string;
  /**
   * What the citation says besides its authors, title and identifiers: the
   * venue, volume, pages and year, as written. Where the venue is read from.
   * Absent when nothing is left.
   */
  remainder?: string;
};

const DOI = /\b(10\.\d{4,9}\/[^\s"<>{}]+?)(?=[.,;)\]}]*(?:\s|$))/i;
// The version, when cited, is part of the id; old-style ids keep their archive.
const ARXIV = /\barxiv(?:\.org\/(?:abs|pdf)\/|[:\s/]*)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)/i;
const PMID = /\bPMID[:\s]*(\d{5,9})\b/i;
const URL = /\bhttps?:\/\/\S+/gi;
const YEAR = /\b(1[89]\d{2}|20\d{2})[a-z]?\b/;
const PAREN_YEAR = /\((1[89]\d{2}|20\d{2})[a-z]?\)\.?/;
/**
 * Numbers that can look like a year without being one. Measured 2026-10-07:
 * `pp. 2004–2021, 2001` was read as cited in 2004, which would flag a correct
 * citation with a wrong year.
 * - Pages: `pp. 2004–2021`, `p. 1993`, and the page after a volume and issue
 *   (`40(11):2004`). Any range counts as pages, wherever it stands, because a
 *   cited year stands alone (`98, 1993–1999`, `edited by A. Name, 1993–2011`).
 *   An ISO date (`2009-11-05`) is not a range.
 * - A volume or an issue (`vol. 2045`): a Lecture Notes volume can look like a year.
 */
const NOT_A_YEAR = new RegExp([
  String.raw`\b(?:pp?|pages?)\.?\s*[A-Za-z]?\d+(?:\s*[–—-]{1,2}\s*[A-Za-z]?\d+)?`,
  String.raw`(?<=[\d)]\s*:\s*)\d+(?:\s*[–—-]{1,2}\s*\d+)?`,
  String.raw`(?<!\d[–—-])\b\d+\s*[–—-]{1,2}\s*\d+\b(?![–—-]\d)`,
  String.raw`\b(?:[Vv]ol(?:ume)?|[Nn]o|[Ii]ssue)\.?\s*\d+`
].join('|'), 'g');
const QUOTED = /["“”«»]([^"“”«»]{10,})["“”«»]/;
const BIBTEX = /@\w+\s*\{|\b(?:title|author)\s*=\s*[{"]/i;

/** Words that join or abbreviate names rather than being them. */
const JOINERS = new Set(['and', '&', 'et', 'al', 'al.', 'jr', 'jr.']);
/** Lower-case parts of surnames: de la Cruz, van der Waals. */
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'di', 'del', 'della', 'la', 'le', 'du', 'dos', 'das', 'ter', 'ten', 'bin', 'al-']);

/** `Surname, I. I.`: a surname, with its particles or of two words (van der
 * Walt, Castro Neto), then initials only, each with its stop (J.-F. included). */
const INVERTED_NAME = String.raw`(?:(?:${[...PARTICLES].filter(p => /^\p{L}+$/u.test(p)).join('|')})\s+)*` +
  String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)*,\s+\p{Lu}\.(?:[\s-]*\p{Lu}\.)*`;
/** A list of them up to where the title starts, joined by `&`, `and` or a
 * space: the comma after an initial is gone by then, since the clean-up of
 * `Title., 2017.` also folds `A.,` into `A.`. */
const INVERTED_AUTHORS = new RegExp(
  String.raw`^(${INVERTED_NAME}(?:(?:\s*,?\s+(?:(?:&|and)\s+)?)${INVERTED_NAME})*)\s+(?!et al\b)(?=\S)`,
  'u'
);

/**
 * A year in brackets, as APA and Nature give it; otherwise the first year
 * standing alone that is not a page, a volume or an issue. The first, not the
 * last: IEEE and Vancouver can follow the cited year with another one
 * (`Accessed: Mar. 3, 2024`, `Epub 2019 Nov 5`). IEEE puts the year after the
 * pages, which is why the pages are taken out first.
 */
function yearIn(text: string): string | undefined {
  return text.match(PAREN_YEAR)?.[1] ?? text.replace(NOT_A_YEAR, ' ').match(YEAR)?.[1];
}

export function parseReference(raw: string): ParsedReference {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (BIBTEX.test(text)) return parseBibtex(raw, text);

  const doi = text.match(DOI)?.[1]?.replace(/[.,;]+$/, '');
  const arxiv = text.match(ARXIV)?.[1];
  const pmid = text.match(PMID)?.[1];

  // What is left once the identifiers are out: the citation itself.
  const rest = text
    .replace(URL, ' ')
    .replace(/\b(?:doi|https?:\/\/(?:dx\.)?doi\.org\/)\s*:?\s*/gi, ' ')
    .replace(DOI, ' ')
    .replace(ARXIV, ' ')
    .replace(PMID, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    // An identifier taken out of `Title. arXiv:…, 2017.` leaves `Title., 2017.`
    .replace(/([.,;:])(?:\s*[.,;:])+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const quoted = rest.match(QUOTED)?.[1];
  const split = splitAuthors(rest);
  const title = clean(quoted ?? (split ? firstSentence(split.after)[0] : undefined) ?? guessTitle(rest, yearIn(rest)));
  // The paper's year is outside its title, which can hold years of its own
  // ("in 21 regions, 1990–2010", "Study 2010"). Those count only when the
  // reference gives no other.
  const yearText = (title ? yearIn(rest.replace(title, ' ')) : undefined) ?? yearIn(rest);
  const year = yearText ? Number(yearText) : undefined;
  const surnames = split ? surnamesIn(split.authors) : quoted ? surnamesIn(rest.slice(0, rest.search(QUOTED))) : [];
  // The author list, then the title, out of the text they were read from.
  const afterAuthors = split ? split.after : quoted ? rest.slice(rest.search(QUOTED)) : rest;
  const remainder = clean((title ? afterAuthors.replace(quoted ? rest.match(QUOTED)![0] : title, ' ') : afterAuthors)
    .replace(/^[\s.,;:]+/, '').replace(/\s+/g, ' '));

  return {
    raw,
    ...(doi ? { doi } : {}),
    ...(arxiv ? { arxiv } : {}),
    ...(pmid ? { pmid } : {}),
    ...(year ? { year } : {}),
    surnames,
    ...(title ? { title } : {}),
    ...(remainder ? { remainder } : {})
  };
}

/**
 * Where the author list ends, in the styles that put it first:
 * - APA, `Names (2017). Title.` — the year in brackets right after them;
 * - Chicago, `Names. 1962. Title.` — a bare year closing the first sentence;
 * - `Name et al. Title.` — Nature and most journals with long author lists;
 * - Vancouver, `Surname AB, Surname C. Title.` — initials without stops;
 * - Nature, `Surname, A. B., Surname, C. & Surname, D. Title.` — the last initial;
 * - a first sentence that is nothing but names, as arXiv listings write it.
 * Undefined when none of them fits: then nothing is known about the authors.
 */
function splitAuthors(text: string): { authors: string; after: string } | undefined {
  const paren = text.match(PAREN_YEAR);
  if (paren && paren.index !== undefined && looksLikeNames(text.slice(0, paren.index))) {
    return { authors: text.slice(0, paren.index), after: text.slice(paren.index + paren[0].length) };
  }

  const [first, after] = firstSentence(text);
  const chicago = first.match(/^(.*?)[.,]?\s+(1[89]\d{2}|20\d{2})[a-z]?$/);
  if (chicago && looksLikeNames(chicago[1]!)) return { authors: chicago[1]!, after };

  const etAl = text.match(/^(.{2,200}?\bet al)\.?\s+/i);
  if (etAl && looksLikeNames(etAl[1]!)) return { authors: etAl[1]!, after: text.slice(etAl[0].length) };

  const name = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)*\s+\p{Lu}{1,3}`;
  const vancouver = text.match(new RegExp(String.raw`^((?:${name},\s*)*${name}(?:,?\s+et al)?)\.\s+`, 'u'));
  if (vancouver) return { authors: vancouver[1]!, after: text.slice(vancouver[0].length) };

  // Nature's `Surname, I. I., Surname, I. & Surname, I. Title.` ends at the last
  // initial. Read by sentence instead, a title in Title Case would look like
  // more names, and the whole first sentence would be taken for authors.
  const inverted = text.match(INVERTED_AUTHORS);
  if (inverted) {
    const rest = text.slice(inverted[0].length);
    // Chicago inverts the first name only (`Billingham, R. E., L. Brent, and
    // P. B. Medawar.`), so a match can stop inside its list. What follows must
    // read as a title, not as more names.
    const [next] = firstSentence(rest);
    if (!/^(?:and|&)\s/i.test(next) && !/(?:^|\s)\p{Lu}\.(?=[\s,]|$)/u.test(next)) return { authors: inverted[1]!, after: rest };
  }

  if (after && looksLikeNames(first) && /,|\band\b|&/.test(first)) return { authors: first, after };
  return undefined;
}

/** Every word a name or an initial, and nothing a title would hold. */
function looksLikeNames(text: string): boolean {
  const words = text.split(/[\s,;]+/).filter(Boolean).filter(w => !JOINERS.has(w.toLowerCase()));
  return words.length > 0 && words.every(w =>
    /^\p{Lu}[\p{L}'’-]*\.?$/u.test(w) || /^(\p{Lu}\.)+(-\p{Lu}\.)*$/u.test(w) || PARTICLES.has(w.toLowerCase()));
}

/** The text up to the first full stop that does not close an initial, and the rest. */
function firstSentence(text: string): [string, string] {
  for (const match of text.matchAll(/[.?!](?=\s|$)/g)) {
    const at = match.index!;
    // `J.` and `A.` are initials; `Cas9.` and `need.` end a sentence.
    if (/(?:^|[\s.(-])\p{Lu}$/u.test(text.slice(0, at))) continue;
    return [text.slice(0, at).trim(), text.slice(at + 1).trim()];
  }
  return [text.trim(), ''];
}

function surnamesIn(authors: string): string[] {
  const words = authors.match(/\p{Lu}[\p{L}'’-]+/gu) ?? [];
  return words
    // Initials written together (JD, FHC) are not names.
    .filter(w => !/^\p{Lu}{1,3}$/u.test(w))
    .map(w => w.toLowerCase())
    .filter(w => !JOINERS.has(w))
    .slice(0, 6);
}

/** BibTeX's own fields: no guessing where the title is. */
function parseBibtex(raw: string, text: string): ParsedReference {
  const field = (name: string): string | undefined => {
    const match = text.match(new RegExp(String.raw`\b${name}\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)"|(\d+))`, 'i'));
    const value = match?.[1] ?? match?.[2] ?? match?.[3];
    return value?.replace(/[{}]/g, '').trim() || undefined;
  };
  const doi = field('doi')?.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const arxiv = field('eprint')?.match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/)?.[1];
  const yearText = field('year')?.match(/\d{4}/)?.[0];
  const title = clean(field('title'));
  const remainder = clean([field('journal'), field('booktitle'), field('volume'), field('pages')].filter(Boolean).join(', '));
  const surnames = (field('author') ?? '')
    .split(/\s+and\s+/i)
    .map(name => (name.includes(',') ? name.split(',')[0]! : name.split(' ').pop() ?? ''))
    .map(name => name.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6);
  return {
    raw,
    ...(doi ? { doi } : {}),
    ...(arxiv ? { arxiv } : {}),
    ...(yearText ? { year: Number(yearText) } : {}),
    surnames,
    ...(title ? { title } : {}),
    ...(remainder ? { remainder } : {})
  };
}

/** The manual's fallback: the longest sentence-like segment that is neither
 * the author list nor the venue and volume. */
function guessTitle(text: string, year?: string): string | undefined {
  const segments = text
    .split(/(?<=[.?!])\s+|\(\d{4}[a-z]?\)/)
    .map(s => s.trim().replace(/^[.,;:\s]+|[.,;:\s]+$/g, ''))
    .filter(s => s.length >= 15)
    .filter(s => !looksLikeNames(s))
    .filter(s => !/\b\d+\s*\(\d+\)|\bpp?\.\s*\d+|\bvol\.?\s*\d+|\d+\s*[:;]\s*\d+/i.test(s))
    .filter(s => s !== year);
  return segments.sort((a, b) => b.length - a.length)[0];
}

function clean(title: string | undefined): string | undefined {
  const trimmed = title?.replace(/^[\s"'“”«»]+|[\s"'“”«».,;:]+$/g, '').trim();
  return trimmed && trimmed.length >= 3 && /\p{L}/u.test(trimmed) ? trimmed : undefined;
}
