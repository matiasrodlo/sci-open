import type { Paper } from '@sci-open/shared';
import type { ParsedReference } from './parse';

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'with', 'by', 'from', 'at', 'via']);

/** Letters NFKD leaves whole, because Unicode counts them letters of their own. */
const UNMARKED: Record<string, string> = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ħ: 'h', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th' };

/** Lower case, accents off: `Müller` and `Muller`, `Łukasz` and `Lukasz`, are one name to a citation. */
export const fold = (text: string): string =>
  text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[łøđðħıßæœþ]/g, letter => UNMARKED[letter]!);

export function tokens(text: string): string[] {
  return fold(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
}

/** precision: share of the cited title found in the candidate; recall: the reverse. */
export function titleOverlap(cited: string, candidate: string): { precision: number; recall: number } {
  const a = tokens(cited);
  const b = new Set(tokens(candidate));
  if (!a.length || !b.size) return { precision: 0, recall: 0 };
  const hit = a.filter(t => b.has(t)).length;
  return { precision: hit / a.length, recall: hit / b.size };
}

/**
 * The words of a name, whole: "Perdomo-Ortiz" is `perdomo`, `ortiz` and
 * `perdomoortiz`; "O'Brien" is `obrien`. Apostrophes go, hyphens split.
 */
function nameWords(name: string): Set<string> {
  const words = new Set<string>();
  for (const word of fold(name).replace(/['’`]/g, '').split(/[^\p{L}-]+/u).filter(Boolean)) {
    words.add(word.replace(/-/g, ''));
    for (const part of word.split('-')) if (part) words.add(part);
  }
  return words;
}

/**
 * Whether a cited surname is a whole word of one of the record's authors'
 * names. It was a substring test, and a short surname is a substring of many
 * names: "Li" is in "Illia Polosukhin" and "Ma" in "Niki Parmar", so a real
 * title cited under someone else's name was verified as Vaswani et al.'s.
 */
export function surnameIn(surname: string, authors: readonly string[]): boolean {
  const parts = fold(surname).replace(/['’`]/g, '').split(/[^\p{L}]+/u).filter(Boolean);
  if (!parts.length) return false;
  // A hyphenated surname is matched whole or by every part.
  const whole = parts.join('');
  return authors.some(author => {
    const words = nameWords(author);
    return words.has(whole) || parts.every(part => words.has(part));
  });
}

/** Words a venue's name shares with every other, which say nothing about which one it is. */
const GENERIC_VENUE = new Set([
  ...STOP, 'journal', 'international', 'proceedings', 'conference', 'transactions', 'letters', 'series',
  'united', 'states', 'america', 'american', 'official', 'annual', 'society', 'review', 'reviews'
]);

/** Words in a citation that name no venue: identifiers, joiners, labels. */
const NOT_VENUE = new Set([
  'et', 'al', 'doi', 'org', 'http', 'https', 'www', 'dx', 'arxiv', 'pmid', 'pmc', 'vol', 'pp', 'no', 'art', 'ed', 'eds',
  'press', 'available', 'online', 'retrieved', 'accessed', 'epub', 'ahead', 'print', 'abs', 'pdf'
]);

/** Where a record's venue is a host rather than a publication, and says nothing to check. */
const HOST_VENUE = /arxiv|biorxiv|medrxiv|zenodo|ssrn|research square|preprints\.org|repository|cornell|pubmed|europe pmc|semantic scholar|figshare|osf/i;

/**
 * `natl` for `national`, `biotechnol` for `biotechnology`, `R` for `Royal`:
 * an abbreviation keeps the word's first letter and some of the rest, in order.
 */
function abbreviates(cited: string, word: string): boolean {
  if (cited === word) return true;
  if (cited[0] !== word[0] || cited.length > word.length) return false;
  if (cited.length === 1) return true;
  let at = 0;
  for (const letter of word) if (letter === cited[at]) at += 1;
  return at === cited.length;
}

/** A venue's words as a citation's are compared with them: single letters kept, as initials. */
function venueTokens(text: string): string[] {
  return fold(text).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t && !/^\d+$/.test(t));
}

/**
 * Whether the citation names the record's venue, when it names one at all.
 *
 * Read from what the citation says besides its authors and title
 * (`remainder`); nothing there means no venue was cited, and nothing is
 * judged. The venue's main title — before a colon, comma, full stop or
 * bracket, where OpenAlex adds "Series B (Methodological)" or ", Condensed
 * matter" — must mostly be there, its distinctive words in full or
 * abbreviated as ISO 4 abbreviates them (`Proc Natl Acad Sci`, `J R Stat
 * Soc`), or its initials must be (`JAMA`), or a short name it gives in
 * brackets (`CVPR`). Two venues sharing a first word are told apart: `Nature`
 * does not name Nature Communications.
 *
 * Undefined when the record's venue is a host, such as arXiv or a repository,
 * which a correct citation of the published paper would not name.
 */
export function venueConsistent(ref: ParsedReference, paper: Paper): boolean | undefined {
  if (!paper.venue || !ref.remainder || HOST_VENUE.test(paper.venue)) return undefined;
  const main = paper.venue.split(/[,:(]|\.\s|\s[-–]\s/)[0]!;
  const distinctive = (text: string) => venueTokens(text).filter(w => w.length > 1 && !GENERIC_VENUE.has(w));
  const words = distinctive(main).length ? distinctive(main) : distinctive(paper.venue);
  if (!words.length) return undefined;

  const cited = venueTokens(
    ref.remainder.replace(/\bhttps?:\/\/\S+/gi, ' ').replace(/\b10\.\d{4,9}\/\S+/g, ' ')
  ).filter(t => !STOP.has(t) && !NOT_VENUE.has(t));
  if (!cited.some(t => t.length > 1)) return undefined;

  const initials = venueTokens(paper.venue).filter(w => !STOP.has(w)).map(w => w[0]).join('');
  const bracketed = [...paper.venue.matchAll(/\(([^)]+)\)/g)].flatMap(m => venueTokens(m[1]!)).filter(w => w.length > 2);
  if (cited.some(t => (initials.length >= 3 && t === initials) || bracketed.includes(t))) return true;
  const found = words.filter(word => cited.some(t => abbreviates(t, word))).length;
  return found / words.length >= 0.6;
}

export type Verdict = 'verified' | 'likely' | 'ambiguous' | 'mismatch' | 'not_found';

export type Judgement = {
  verdict: Verdict;
  score: number;
  title_precision?: number;
  year_consistent?: boolean;
  author_consistent?: boolean;
  venue_consistent?: boolean;
  corroborated_by: string[];
  issues: string[];
};

/**
 * How well a candidate record answers a reference, graded the way OpenAlex's
 * `resolve_references` grades it — title precision and recall, year, author —
 * plus what only a federated search can add: how many independent sources
 * returned the same record. The thresholds are a starting point to calibrate
 * on the eval set, not settled numbers.
 *
 * `verified` means the citation agrees with the record on everything checked:
 * title, year, an author, and the venue where the citation names one. A wrong
 * venue makes it `likely` — the paper exists, a detail of the citation does
 * not — and says which.
 */
export function judge(ref: ParsedReference, paper: Paper): Judgement {
  const corroborated_by = [...new Set(paper.sources.map(s => s.provider))];
  const issues: string[] = [];
  const overlap = ref.title ? titleOverlap(ref.title, paper.title) : undefined;
  const yearOk = ref.year === undefined || paper.year === undefined ? undefined : Math.abs(ref.year - paper.year) <= 1;
  // A record with no authors cannot contradict a cited one.
  const authorOk = ref.surnames.length === 0 || paper.authors.length === 0 ? undefined : ref.surnames.some(s => surnameIn(s, paper.authors));
  const venueOk = venueConsistent(ref, paper);

  if (yearOk === false) issues.push(`year_mismatch: cited ${ref.year}, record ${paper.year}`);
  if (authorOk === false) issues.push('author_mismatch: no cited surname appears in the record');
  if (venueOk === false) issues.push(`venue_mismatch: the citation does not name the record's venue, ${paper.venue}`);

  const precision = overlap?.precision ?? 0;
  const recall = overlap?.recall ?? 0;
  if (overlap && (precision < 0.9 || recall < 0.9) && precision >= 0.6) {
    issues.push(`title_partial_match: the cited title and the record's share ${Math.round(precision * 100)}% of the cited words`);
  }
  const score = precision + 0.5 * recall + (yearOk ? 0.3 : 0) + (authorOk ? 0.3 : 0) + 0.05 * Math.min(corroborated_by.length - 1, 3);
  const contradicted = yearOk === false || authorOk === false;
  // A detail the paper does not settle: it exists, and the citation is off.
  const detailWrong = venueOk === false;
  // Year and authors both wrong leaves a partial title nothing to stand on.
  // Measured live: a fabricated "Quantum annealing of protein folding
  // landscapes" (2021) shares three of five title words with a real 2012 paper
  // by other authors, and was called ambiguous rather than not found.
  const bothContradicted = yearOk === false && authorOk === false;

  let verdict: Verdict;
  if (!overlap) verdict = contradicted ? 'ambiguous' : detailWrong ? 'likely' : 'verified'; // identifier-only reference
  else if (precision >= 0.9 && recall >= 0.9 && !contradicted) verdict = detailWrong ? 'likely' : 'verified';
  else if (precision >= 0.8 && (yearOk || authorOk) && !contradicted) verdict = 'likely';
  else if (precision >= 0.8 || (precision >= 0.6 && !bothContradicted)) verdict = 'ambiguous';
  else verdict = 'not_found';

  return {
    verdict,
    score: Number(score.toFixed(3)),
    ...(overlap ? { title_precision: Number(precision.toFixed(2)) } : {}),
    ...(yearOk !== undefined ? { year_consistent: yearOk } : {}),
    ...(authorOk !== undefined ? { author_consistent: authorOk } : {}),
    ...(venueOk !== undefined ? { venue_consistent: venueOk } : {}),
    corroborated_by,
    issues
  };
}
