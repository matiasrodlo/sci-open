import { formatExpression } from '@open-access-explorer/shared';

/**
 * The search a name on a record links to: everything by this author, or
 * everything in this venue.
 *
 * OpenAlex makes every author and venue on a list a link, and the grammar here
 * already has the two tags that make that a search rather than a guess —
 * `AU=` and `SO=`. The name goes in as a phrase, because an author is a run of
 * words in that order and not each of them anywhere: `AU=Jennifer Doudna`
 * would be `AU=Jennifer AND TS=Doudna`.
 *
 * Built through `formatExpression` rather than by template, so the link spells
 * the query the way the parser prints it back — the box on the results page
 * then shows exactly what the reader would have typed.
 */
export function fieldSearchHref(field: 'author' | 'venue', name: string): string | undefined {
  // A quote would end the phrase early, and the grammar has no escape for one,
  // so it is dropped. A name is the same name without it.
  const text = name.replace(/"/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;

  const query = formatExpression({ kind: 'clause', field, value: { kind: 'phrase', text } });
  return `/results?q=${encodeURIComponent(query)}`;
}
