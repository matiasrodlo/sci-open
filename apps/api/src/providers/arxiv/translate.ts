import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the arXiv `search_query` string. Pure, and the only place that
 * knows this API's syntax.
 *
 * This provider is the clearest case for why `Query` exists. The old connector
 * sent the user's words through as `all:crispr gene editing`, and arXiv reads
 * that as `all:crispr OR all:gene OR all:editing` — measured: 23,510 hits
 * whose top two results were "Primer on the Gene Ontology" and "Gene Ontology:
 * Pitfalls, Biases, Remedies", neither about CRISPR. The same words joined
 * with AND return 16, all of them on the subject. A raw string gave the
 * connector no way to say which words were required, so it could not have
 * asked the question the user meant.
 */

/** Every clause searches all metadata fields; arXiv has no combined default. */
const FIELD = 'all';

/**
 * Concrete endpoints for a half-open range, because arXiv rejects a wildcard
 * one — see the note on `submittedDate` below. 1991 is arXiv's first year.
 */
const EARLIEST = '199101010000';
const LATEST = '999912312359';

/**
 * arXiv documents no escape for a quote inside a quoted phrase, and an
 * unbalanced one makes the parser reject the whole query. Dropping it is the
 * only option that keeps the rest of the phrase searchable.
 */
function quote(phrase: string): string {
  return `${FIELD}:"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. arXiv is a preprint repository — every record it
   * holds is free to read — so there is no access filter to apply, and adding
   * a clause for one would only narrow the query for no reason. Declining to
   * act on it here is what keeps the orchestrator from having to special-case
   * which providers understand the option.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  // No DOI clause: arXiv has no DOI index, which `capabilities.doiLookup`
  // declares, so the orchestrator never routes a DOI lookup here.
  const terms = query.terms.filter(t => t.trim()).map(t => `${FIELD}:${t.trim()}`);
  const phrases = query.phrases.filter(p => p.trim()).map(quote);

  if (terms.length > 0) {
    const joined = terms.join(` ${query.join} `);
    // Parenthesised so an OR join cannot swallow the clauses beside it —
    // `all:a OR all:b AND submittedDate:[...]` does not mean what it looks
    // like.
    clauses.push(terms.length > 1 ? `(${joined})` : joined);
  }

  // Phrases are always required, whatever `join` says about the bare terms.
  clauses.push(...phrases);

  // A single range with two real endpoints. The wildcard form the old
  // connector used — `submittedDate:[202201010000 TO *]`, and both bounds as
  // two AND-ed clauses — makes arXiv answer **HTTP 500** with an error
  // document in the feed. The connector caught that and returned an empty
  // array, so arXiv dropped out of every year-filtered search entirely, and
  // nothing distinguished it from a query that matched nothing.
  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    const start = from !== undefined ? `${from}01010000` : EARLIEST;
    const end = to !== undefined ? `${to}12312359` : LATEST;
    clauses.push(`submittedDate:[${start} TO ${end}]`);
  }

  return clauses.join(' AND ');
}
