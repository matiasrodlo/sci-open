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
 * An author as their name, quoted, which the search matches as a name: every
 * word of it in one author's name, in any order and however the source
 * punctuated it. See `nameMatcher` in the shared package.
 *
 * The sources do not agree on how to write one. PubMed gives "Doudna Jennifer
 * A", bioRxiv "Doudna, Jennifer", most of the rest "Jennifer A. Doudna". The
 * first links were the card's spelling as a phrase matched word for word, and
 * found 0, 7, 24 or 30 of one author's papers depending on which card was
 * clicked. The second were each word as its own clause, `AU=Wei AND AU=Wang`,
 * which matched every spelling and also two different co-authors who shared
 * the words between them: 7 of the first 20 results for that name had no Wei
 * Wang on them. Quoted, it is one person again — none of the first 20 — and
 * found more, 2,291 against 2,096.
 *
 * Initials are dropped where a forename is written out: they are what the
 * spellings disagree on most, and Europe PMC finds 123 papers for "Jennifer A.
 * Doudna" against 153 for "Jennifer Doudna". Where the name is a surname and
 * initials alone — "Doudna JA", "J. Doudna" — the first initial stays, after
 * the surname, because it is all that tells one Doudna from another.
 */
function authorQuery(name: string): QueryNode | undefined {
  const seen = new Set<string>();
  const cleaned = name
    .split(/[\s,;]+/)
    // Quotes would end the phrase early, and a name needs none of the rest.
    .map(word => word.replace(/["()*?]/g, ''))
    // Something other than punctuation: a stray "&" or "-" is not a name.
    // Tested this way round so a name in a script without letter case counts.
    .filter(word => /[^!-/:-@[-`{-~‐–—’]/.test(word));

  const names = cleaned
    .filter(word => !isInitial(word))
    .filter(word => {
      const key = word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (names.length === 0) return undefined;

  // An initial is letters, stops and hyphens only. See `isInitial`.
  const initial = cleaned.find(isInitial)?.replace(/[.\-‐]/g, '').charAt(0);
  const text = names.length === 1 && initial ? `${names[0]} ${initial.toUpperCase()}` : names.join(' ');
  return { kind: 'clause', field: 'author', value: { kind: 'phrase', text } };
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
