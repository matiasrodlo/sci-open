/** Control, format and default-ignorable characters, except tab and newline.
 * `.trim()` keeps all of these: zero-width spaces, bidi overrides, word
 * joiners, variation selectors, Hangul fillers. */
const INVISIBLE = /(?![\t\n])[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi;
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_, e: string) => {
    const lower = e.toLowerCase();
    const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : lower.startsWith('#') ? parseInt(lower.slice(1), 10) : undefined;
    if (code === undefined) return NAMED[lower] ?? '';
    // A code point past Unicode's range would make fromCodePoint throw.
    return code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/**
 * Third-party text as the model may read it.
 *
 * Two passes, as GitHub's server does: decoding entities can *create*
 * invisible characters (`&#8203;` is a zero-width space), so the filter runs
 * again on the decoded text.
 */
export function sanitizeText(raw: string, options: { decodeEntities?: boolean } = {}): string {
  let text = raw.replace(INVISIBLE, '');
  if (options.decodeEntities) text = decodeEntities(text).replace(INVISIBLE, '');
  return text
    .replace(/```/g, 'ʼʼʼ') // cannot open a code fence in our Markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Removes invisible characters and nothing else, for text whose length must survive. */
export const stripInvisible = (raw: string): string => raw.replace(INVISIBLE, '');

/** For values that must be visible to mean anything (queries, ids). */
export function hasVisibleText(value: string): boolean {
  return value.replace(INVISIBLE, '').trim().length > 0;
}
