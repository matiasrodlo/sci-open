/**
 * The identity of a facet value, as opposed to its spelling.
 *
 * Providers spell the same journal differently — Europe PMC's `Frontiers in
 * psychology` is OpenAlex's `Frontiers in Psychology` — and each spelling used
 * to be its own bucket, holding part of the journal's papers, with ticking one
 * finding only the papers spelled that way. Now that the panel also carries
 * the sources' own counts, which arrive in whichever spelling that source
 * uses, the two would not even meet. Case, accents, punctuation and `&` are
 * not part of what a name identifies.
 */
export function facetKey(value: string | number): string {
  if (typeof value === 'number') return String(value);
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
