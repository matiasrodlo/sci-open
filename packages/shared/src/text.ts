/**
 * Provider markup, taken off a string before it becomes a `Paper` field.
 *
 * Nothing in the pipeline renders HTML — the frontend prints `title` and
 * `abstract` as text — so a tag that survives normalisation is shown to the
 * reader as a tag. Measured: `/api/paper/plos:10.1371%2Fjournal.pone.0265114`
 * answered with `"Optimization of CRISPR/LbCas12a-mediated gene editing in
 * <i>Arabidopsis</i>"`, and that is what the card displayed.
 *
 * It lives here, next to `httpUrl`, and for the same reason: this is one rule
 * about what a provider string may contain, and it was being restated once per
 * connector that happened to notice. OpenAIRE had `stripMarkup`, Crossref had
 * `stripJats`, the two disagreed on whether a tag leaves a space behind, and
 * the eleven other sources had neither.
 */

/**
 * Elements whose boundary is a break in the text.
 *
 * The two implementations this replaces each picked one substitution and lived
 * with the other's failure. Crossref replaced every tag with a space, so
 * `atring1<sup>ko</sup>` — which is Europe PMC's recorded abstract — reads
 * `atring1 ko`. OpenAIRE replaced every tag with nothing, so
 * `<jats:p>one</jats:p><jats:p>two</jats:p>` reads `onetwo`. Neither is a
 * transcription of the source.
 *
 * Which substitution is right is a property of the element: a paragraph ends a
 * run of text, a superscript sits inside a word. Namespace prefixes are dropped
 * before the lookup, so `jats:p` and `p` are the same element.
 */
const BLOCK_ELEMENTS = new Set([
  'abstract', 'blockquote', 'br', 'caption', 'dd', 'disp-quote', 'div', 'dl',
  'dt', 'fig', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'li', 'list',
  'list-item', 'ol', 'p', 'sec', 'table', 'tbody', 'td', 'th', 'thead', 'title',
  'tr', 'ul'
]);

/**
 * A tag, and only something really shaped like one.
 *
 * The obvious spelling, `/<[^>]*>/`, is what both of the replaced helpers used
 * and it eats mathematics. Abstracts are full of inequalities — PubMed's XML
 * carries `p &lt; 0.05 and n &gt; 30`, which reaches a normaliser decoded —
 * and `<[^>]*>` matches `< 0.05 and n >` and deletes it, quietly turning that
 * into `p 30`. Requiring a name immediately after the `<` refuses it, and
 * costs nothing real: no element is named ` 0.05 and n`.
 */
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9.\-_]*(?::[a-zA-Z][a-zA-Z0-9.\-_]*)?(?:\s[^<>]*)?\/?>/g;

/** The element's local name, lowercased and without its namespace prefix. */
function localName(tag: string): string {
  const name = tag.replace(/^<\/?/, '').match(/^[^\s/>]+/)?.[0] ?? '';
  return (name.includes(':') ? name.slice(name.indexOf(':') + 1) : name).toLowerCase();
}

/**
 * A `title` element whose whole content is the word "Abstract".
 *
 * Crossref opens most abstracts with `<jats:title>Abstract</jats:title>`,
 * which is the label the field already has, repeated inside its own value.
 * Removing the tags alone would leave the word behind.
 */
const ABSTRACT_HEADING =
  /<(?:[a-zA-Z][a-zA-Z0-9.\-_]*:)?title(?:\s[^<>]*)?>\s*abstract\s*<\/(?:[a-zA-Z][a-zA-Z0-9.\-_]*:)?title\s*>/gi;

/**
 * The named entities worth decoding, in the order they are applied.
 *
 * `&amp;` is last, so a literally-escaped entity such as `&amp;quot;` comes
 * out as `&quot;` rather than being decoded twice — the record said `&quot;`
 * and that is what it should still say. `&apos;` is here because OpenAIRE
 * emits it and the list this replaces left it out, so abstracts reached the
 * reader as "Alzheimer&apos;s disease".
 *
 * Decoding runs after the tags are gone, which is what keeps escaped markup
 * visible: `&lt;i&gt;` is a record that wanted to show the characters `<i>`,
 * not a record with an italic in it.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&#0*39;/g, "'"],
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&']
];

/**
 * `value` with its markup removed, its entities decoded and its whitespace
 * collapsed, or `undefined` if there is no text left.
 *
 * `unknown` in and `string | undefined` out, the same shape as `httpUrl`:
 * payload fields are whatever the provider put there, and a value that is
 * nothing but markup is not a title. Saying so is what lets the caller drop
 * the field, rather than writing an empty string into it.
 *
 * Whitespace is collapsed last and unconditionally, which also takes care of
 * the source document's own line wrapping and indentation — PLOS's Solr
 * abstracts and Crossref's JATS both arrive with it still attached.
 */
export function stripMarkup(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const withoutTags = value
    .replace(ABSTRACT_HEADING, ' ')
    .replace(TAG, tag => (BLOCK_ELEMENTS.has(localName(tag)) ? ' ' : ''));

  const text = ENTITIES
    .reduce((acc, [pattern, character]) => acc.replace(pattern, character), withoutTags)
    .replace(/\s+/g, ' ')
    .trim();

  return text || undefined;
}
