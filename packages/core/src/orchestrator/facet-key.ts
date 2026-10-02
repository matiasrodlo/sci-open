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
 *
 * Also how titles are keyed for the merge and how text is matched for ranking,
 * so it runs over every abstract a search reads — see `fold` for why that
 * shapes how it is written.
 */
export function facetKey(value: string | number): string {
  if (typeof value === 'number') return String(value);

  // An ASCII separator is a separator before and after decomposition, and it
  // bounds what decomposition can reorder, so splitting on them first is exact.
  // Only the words carrying other characters then need the Unicode rules.
  const words = value.replace(/&/g, ' and ').split(/[^A-Za-z0-9\u0080-\uffff]+/);

  let key = '';
  for (const word of words) {
    const folded = NON_ASCII.test(word) ? foldOnce(word) : word.toLowerCase();
    if (folded) key = key ? `${key} ${folded}` : folded;
  }
  return key;
}

const NON_ASCII = /[\u0080-\uffff]/;

/**
 * `fold`, remembered. The words that take the slow path repeat heavily — `α`,
 * `β`, `μm`, a dash-joined `crispr–cas9` — so most calls are answered here.
 * Emptied rather than evicted when full: a bound, not a working set.
 */
const foldedWords = new Map<string, string>();
const FOLDED_LIMIT = 50_000;

function foldOnce(word: string): string {
  let result = foldedWords.get(word);
  if (result === undefined) {
    result = fold(word);
    if (foldedWords.size >= FOLDED_LIMIT) foldedWords.clear();
    foldedWords.set(word, result);
  }
  return result;
}

/**
 * Decomposed, unaccented, lowercased, with anything but letters and digits as
 * a single space.
 *
 * Applied to one word at a time rather than to the whole text. `normalize`
 * hands back a two-byte string, and the Unicode-aware replacements after it
 * run several times slower over one — measured over 6,000 synthetic abstracts,
 * 226 ms for the whole-text form against 19 ms for the same regex over the
 * text as it arrived. Most words in an abstract are ASCII and skip this.
 */
function fold(word: string): string {
  return word
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
