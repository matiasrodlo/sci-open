import type { Paper } from '@sci-open/shared';
import type { ParsedReference } from './parse';

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'with', 'by', 'from', 'at', 'via']);

/** Lower case, accents off: `Müller` and `Muller` are one name to a citation. */
export const fold = (text: string): string => text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

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

export type Verdict = 'verified' | 'likely' | 'ambiguous' | 'mismatch' | 'not_found';

export type Judgement = {
  verdict: Verdict;
  score: number;
  title_precision?: number;
  year_consistent?: boolean;
  author_consistent?: boolean;
  corroborated_by: string[];
  issues: string[];
};

/**
 * How well a candidate record answers a reference, graded the way OpenAlex's
 * `resolve_references` grades it — title precision and recall, year, author —
 * plus what only a federated search can add: how many independent sources
 * returned the same record. The thresholds are a starting point to calibrate
 * on the eval set, not settled numbers.
 */
export function judge(ref: ParsedReference, paper: Paper): Judgement {
  const corroborated_by = [...new Set(paper.sources.map(s => s.provider))];
  const issues: string[] = [];
  const overlap = ref.title ? titleOverlap(ref.title, paper.title) : undefined;
  const yearOk = ref.year === undefined || paper.year === undefined ? undefined : Math.abs(ref.year - paper.year) <= 1;
  const names = paper.authors.map(fold);
  // A record with no authors cannot contradict a cited one.
  const authorOk = ref.surnames.length === 0 || names.length === 0 ? undefined : ref.surnames.some(s => names.some(n => n.includes(fold(s))));

  if (yearOk === false) issues.push(`year_mismatch: cited ${ref.year}, record ${paper.year}`);
  if (authorOk === false) issues.push('author_mismatch: no cited surname appears in the record');

  const precision = overlap?.precision ?? 0;
  const recall = overlap?.recall ?? 0;
  const score = precision + 0.5 * recall + (yearOk ? 0.3 : 0) + (authorOk ? 0.3 : 0) + 0.05 * Math.min(corroborated_by.length - 1, 3);
  const contradicted = yearOk === false || authorOk === false;
  // Year and authors both wrong leaves a partial title nothing to stand on.
  // Measured live: a fabricated "Quantum annealing of protein folding
  // landscapes" (2021) shares three of five title words with a real 2012 paper
  // by other authors, and was called ambiguous rather than not found.
  const bothContradicted = yearOk === false && authorOk === false;

  let verdict: Verdict;
  if (!overlap) verdict = contradicted ? 'ambiguous' : 'verified'; // identifier-only reference
  else if (precision >= 0.9 && recall >= 0.9 && !contradicted) verdict = 'verified';
  else if (precision >= 0.8 && (yearOk || authorOk) && !contradicted) verdict = 'likely';
  else if (precision >= 0.8 || (precision >= 0.6 && !bothContradicted)) verdict = 'ambiguous';
  else verdict = 'not_found';

  return {
    verdict,
    score: Number(score.toFixed(3)),
    ...(overlap ? { title_precision: Number(precision.toFixed(2)) } : {}),
    ...(yearOk !== undefined ? { year_consistent: yearOk } : {}),
    ...(authorOk !== undefined ? { author_consistent: authorOk } : {}),
    corroborated_by,
    issues
  };
}
