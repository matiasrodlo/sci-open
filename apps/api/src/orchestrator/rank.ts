import type { Paper, Query } from '@open-access-explorer/shared';

/**
 * Ordering the merged set.
 *
 * Deliberately a fixed, small scheme rather than an open-ended one. Ranking is
 * a research problem wearing a task's clothing, and the failure mode is
 * spending the refactor tuning it. The stopping point is this file: rank
 * fusion, term overlap, and a quality tiebreak. Improving it is a separate
 * piece of work with its own evaluation, not something to do while the
 * pipeline is being built.
 *
 * Three signals, in decreasing authority:
 *
 * 1. Reciprocal rank fusion over each provider's own ordering. Positions, not
 *    scores — provider relevance scores are computed differently over
 *    different corpora, so pooling them directly is meaningless, while
 *    "several providers put this near the top" is comparable and is exactly
 *    what fusion captures.
 * 2. Term overlap between the query and the title and abstract, title weighted
 *    higher. This is the only signal that reads the query text.
 * 3. Record quality, as a tiebreak. This is the salvaged
 *    `calculateRelevanceScore`, and it never looks at the query — it scores
 *    completeness. Useful for separating two otherwise equal records, wrong as
 *    a relevance signal.
 */

/** Standard RRF damping. Keeps a single first place from dominating agreement across providers. */
const RRF_K = 60;

const TITLE_WEIGHT = 1.0;
const ABSTRACT_WEIGHT = 0.35;
/** How far term overlap can move a result against provider agreement. */
const OVERLAP_WEIGHT = 1.25;

export type ScoredPaper = {
  paper: Paper;
  score: number;
  fusion: number;
  overlap: number;
  quality: number;
};

/**
 * Sum of 1/(k + rank) across the providers that returned this paper, scaled so
 * a single first-place sighting is worth about 1.
 *
 * Two providers agreeing on a mid-ranked paper outscores one provider's top
 * hit, which is the property worth having in a fan-out.
 */
export function fusionScore(paper: Paper): number {
  return paper.sources.reduce((total, ref) => total + RRF_K / (RRF_K + ref.rank + 1), 0);
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Fraction of the query present in the paper's text.
 *
 * Phrases must appear intact to count; terms only have to appear. A phrase is
 * worth more than a term because the user went to the trouble of quoting it.
 */
export function overlapScore(paper: Paper, query: Query): number {
  const terms = query.terms.map(t => t.toLowerCase()).filter(Boolean);
  const phrases = query.phrases.map(p => p.toLowerCase()).filter(Boolean);
  const wanted = terms.length + phrases.length * 2;
  if (wanted === 0) return 0;

  const score = (text: string): number => {
    if (!text) return 0;
    const haystack = text.toLowerCase();
    const tokens = new Set(tokenize(text));
    const matchedTerms = terms.filter(t => tokens.has(t)).length;
    const matchedPhrases = phrases.filter(p => haystack.includes(p)).length;
    return (matchedTerms + matchedPhrases * 2) / wanted;
  };

  const title = score(paper.title) * TITLE_WEIGHT;
  const abstract = score(paper.abstract ?? '') * ABSTRACT_WEIGHT;
  return (title + abstract) / (TITLE_WEIGHT + ABSTRACT_WEIGHT);
}

/**
 * How complete and usable a record is. Never reads the query.
 *
 * Salvaged from the deleted pipeline, where it was the primary sort — which is
 * why a search could return well-formed papers about the wrong subject. Here
 * it only separates papers the first two signals could not.
 */
export function qualityScore(paper: Paper, now: number): number {
  let score = 0;
  if (paper.abstract && paper.abstract.length > 200) score += 0.3;
  if (paper.authors.length > 0) score += 0.2;
  if (paper.venue) score += 0.15;
  if (paper.fullText) score += 0.2;
  if (paper.citationCount) score += Math.min(paper.citationCount / 500, 0.15);

  if (paper.year) {
    const age = new Date(now).getUTCFullYear() - paper.year;
    if (age >= 0 && age <= 5) score += 0.1 * (1 - age / 5);
  }

  return score;
}

export type RankOptions = {
  query: Query;
  now?: number;
};

export function rank(papers: readonly Paper[], options: RankOptions): ScoredPaper[] {
  const { query, now = Date.now() } = options;

  const scored: ScoredPaper[] = papers.map(paper => {
    const fusion = fusionScore(paper);
    const overlap = overlapScore(paper, query);
    const quality = qualityScore(paper, now);
    return { paper, fusion, overlap, quality, score: fusion + overlap * OVERLAP_WEIGHT };
  });

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.quality !== a.quality) return b.quality - a.quality;
    // Stable and explainable rather than arbitrary when everything else ties.
    return a.paper.id.localeCompare(b.paper.id);
  });
}
