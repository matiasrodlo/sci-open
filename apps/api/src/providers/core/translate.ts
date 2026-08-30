import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the CORE search string. Pure, and the only place that knows this
 * API's syntax.
 *
 * Every form below was checked against a response, and three of them behave
 * differently from what the old connector assumed.
 */

/** Bounds for a half-open year range. CORE takes comparisons, not a range literal. */
const EARLIEST = 1000;
const LATEST = 9999;

export type TranslateOptions = {
  /**
   * Accepted and ignored. CORE aggregates open repository deposits and offers
   * no access filter to narrow to.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    // Verified: `doi:"10.1038/srep09811"` returns exactly 1.
    clauses.push(`doi:"${query.doi.replace(/"/g, '')}"`);
    return clauses.join(' AND ');
  }

  // Terms are joined explicitly. CORE ORs space-separated words: measured,
  // `crispr gene editing` returns 2,126,594 where `crispr AND gene AND
  // editing` returns 13,323 — more words giving more results, the same defect
  // arXiv had.
  const terms = query.terms.map(t => t.trim()).filter(Boolean);

  // Phrases cannot be expressed at all, so they are degraded to their words
  // rather than sent. A bare quoted phrase makes CORE answer **HTTP 500**, and
  // scoping it to a field does not help: `title:"gene editing"` returns
  // 635,878, an order of magnitude more than the phrase can possibly match, so
  // the quotes are not being honoured. Requiring the words is the closest
  // thing CORE can actually do, and `capabilities` does not claim otherwise.
  const fromPhrases = query.phrases.flatMap(p => p.trim().split(/\s+/)).filter(Boolean);

  const words = [...terms, ...fromPhrases];
  if (words.length > 0) {
    const joined = words.join(` ${query.join} `);
    clauses.push(words.length > 1 ? `(${joined})` : joined);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    // In `q`, as comparisons. The old connector sent a `filters` request
    // parameter instead — measured, CORE ignores it silently and returns the
    // unbounded count, so its year filter never did anything.
    clauses.push(`yearPublished>=${from ?? EARLIEST}`);
    clauses.push(`yearPublished<=${to ?? LATEST}`);
  }

  return clauses.join(' AND ');
}
