import type { FullTextDocument } from '@sci-open/core';
import { sanitizeText } from '../safety/sanitize';

/**
 * A full text as the Markdown file `save_to` writes: a heading per section,
 * one level deeper per segment of its id (s2.1 → ###), and where it came from.
 * A file is for the user, not the model, so it carries no untrusted fence.
 */
export function documentToMarkdown(doc: FullTextDocument): string {
  const head = [
    `# ${sanitizeText(doc.title ?? doc.paperId)}`,
    '',
    `Source: ${doc.url} (${doc.tier}, retrieved ${doc.retrievedAt})`,
    ...(doc.license ? [`License: ${sanitizeText(doc.license)}`] : [])
  ].join('\n');
  const body = doc.sections.map(s => {
    const depth = Math.min(1 + s.id.split('.').length, 6);
    return `${'#'.repeat(depth)} ${sanitizeText(s.title)}${s.text ? `\n\n${sanitizeText(s.text)}` : ''}`;
  });
  return `${[head, ...body].join('\n\n')}\n`;
}
