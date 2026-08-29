import type { Query, QueryJoin } from '@open-access-explorer/shared';

/**
 * The user's text -> a structured Query.
 *
 * Small on purpose. This is not the advanced-search grammar; it exists so the
 * orchestrator has structure to hand providers, and so a quoted phrase stays a
 * phrase all the way down to the native query. Without it every provider gets
 * a bare string and guesses — which is how `crispr gene editing` reaches arXiv
 * as `all:crispr OR all:gene OR all:editing`.
 */

const DOI_PATTERN = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[^\s]+)$/i;

export type ParseOptions = {
  /** How bare terms combine. Providers are told, not left to decide. */
  join?: QueryJoin;
  years?: { from?: number; to?: number };
};

export function parseQuery(input: string, options: ParseOptions = {}): Query {
  const text = (input ?? '').trim();
  const { join = 'AND', years } = options;

  const doi = text.match(DOI_PATTERN)?.[1];
  if (doi) {
    return { terms: [], phrases: [], join, doi, ...(years ? { years } : {}) };
  }

  const phrases: string[] = [];
  // Pull out double-quoted runs first, so their words are not also treated as
  // bare terms. An unclosed quote is left alone rather than swallowing the
  // rest of the query.
  const withoutPhrases = text.replace(/"([^"]+)"/g, (_match, phrase: string) => {
    const trimmed = phrase.trim();
    if (trimmed) phrases.push(trimmed);
    return ' ';
  });

  const terms = withoutPhrases
    .split(/\s+/)
    .map(t => t.trim())
    .filter(Boolean);

  return { terms, phrases, join, ...(years ? { years } : {}) };
}
