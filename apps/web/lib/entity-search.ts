import { formatExpression, type QueryNode } from '@open-access-explorer/shared';

/**
 * The search a name on a record links to: everything by this author, or
 * everything in this venue.
 *
 * OpenAlex makes every author and venue on a list a link, and the grammar here
 * has the two tags that make that a search rather than a guess — `AU=` and
 * `SO=`. Built through `formatExpression` rather than by template, so the link
 * spells the query the way the parser prints it back, and the box on the
 * results page shows exactly what the reader would have typed.
 */
export function fieldSearchHref(field: 'author' | 'venue', name: string): string | undefined {
  const node = field === 'author' ? authorQuery(name) : venueQuery(name);
  if (!node) return undefined;
  return `/results?q=${encodeURIComponent(formatExpression(node))}`;
}

/**
 * An author as each word of their name, rather than as the name.
 *
 * The sources do not agree on how to write one. PubMed gives "Doudna Jennifer
 * A", bioRxiv "Doudna, Jennifer", most of the rest "Jennifer A. Doudna" — and an
 * author is a narrow field, so a record whose list does not contain the phrase
 * is ruled out rather than kept. The link used to be the phrase as the card
 * happened to spell it, and measured on one author it found 0, 7, 24 or 30
 * papers depending on which source's card was clicked, against 195 for the
 * surname alone. Every word, each its own clause, matches all of those
 * spellings.
 *
 * Initials are dropped because they are what the spellings disagree on most —
 * "A.", "JA", nothing at all — and a surname with a forename is specific enough
 * without them. What this gives up is order: two co-authors who share the words
 * between them match too, which is rare, and a record that matches is at least
 * by someone with that name.
 */
function authorQuery(name: string): QueryNode | undefined {
  const seen = new Set<string>();
  const words = name
    .split(/[\s,;]+/)
    // Quotes and brackets would end the word early and `*` and `?` are
    // wildcards. No name needs them.
    .map(word => word.replace(/["()*?]/g, ''))
    // Something other than punctuation: a stray "&" or "-" is not a name.
    // Tested this way round so a name in a script without letter case counts.
    .filter(word => /[^!-/:-@[-`{-~‐–—’]/.test(word) && !isInitial(word))
    .filter(word => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (words.length === 0) return undefined;

  const clauses: QueryNode[] = words.map(text => ({
    kind: 'clause',
    field: 'author',
    value: { kind: 'term', text }
  }));
  return clauses.length === 1 ? clauses[0] : { kind: 'and', nodes: clauses };
}

/** A lone letter, or letters each followed by a stop: "A", "A.", "B.U.", "J.-P.". */
function isInitial(word: string): boolean {
  if (word.replace(/[.\-‐]/g, '').length <= 1) return true;
  return word.includes('.') && word.split('.').every(part => part.replace(/[-‐]/g, '').length <= 1);
}

/**
 * A venue as one phrase — a journal's name is a run of words in that order —
 * less a trailing year in brackets.
 *
 * OpenAIRE appends one, "PLOS Computational Biology (2020)", which names an
 * issue and not the journal: kept, the link would reach that year's papers
 * from that one source. A place in brackets, as PubMed writes "Bioinformatics
 * (Oxford, England)", stays, because without it the phrase would also match
 * "Briefings in Bioinformatics".
 */
function venueQuery(name: string): QueryNode | undefined {
  const text = name
    .replace(/"/g, '')
    .replace(/\s*\((?:1[89]|20)\d{2}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return { kind: 'clause', field: 'venue', value: { kind: 'phrase', text } };
}
