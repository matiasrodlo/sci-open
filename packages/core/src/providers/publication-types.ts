/**
 * The publication types, in PubMed's vocabulary — which Europe PMC serves for
 * the records it shares with PubMed — of works that are not research or
 * review articles: notices, opinion and news. A paper of one of these types is
 * the published version of *something*, but not of the work the
 * `peer-reviewed` publication type stands for, so `normalize` gives it the
 * stage `unknown` and a search for published papers leaves it out upstream.
 *
 * "Retraction Notice" is what PubMed calls what it called "Retraction of
 * Publication" until 2024 (checked live 2026-10-06: 33,874 against 0). Both are
 * read, and both are sent to Europe PMC, where a name it does not use matches
 * nothing. The retracted article itself is "Retracted Publication", which is
 * a research article and stays one.
 */
export const NOTICE_TYPES: readonly string[] = [
  'Editorial', 'Letter', 'Comment', 'News', 'Newspaper Article', 'Published Erratum',
  'Retraction Notice', 'Retraction of Publication', 'Expression of Concern', 'Biography', 'Portrait', 'Interview'
];

const NOTICES = new Set(NOTICE_TYPES.map(type => type.toLowerCase()));

/** Whether a record whose publication types are these is a notice rather than an article. */
export function isNotice(types: readonly string[]): boolean {
  return types.some(type => NOTICES.has(type.trim().toLowerCase()));
}
