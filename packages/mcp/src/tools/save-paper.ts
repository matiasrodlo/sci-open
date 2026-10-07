import { createHash } from 'crypto';
import * as z from 'zod';
import { defineTool } from '../framework/define-tool';
import { ToolError } from '../errors';
import { resolvePaperRef } from './resolve-paper';
import { copySource } from './read-paper';
import { writeUserFile } from '../safety/paths';
import { sanitizeText } from '../safety/sanitize';
import { writesAllowed } from '../config';
import { retractionWarning } from '../shape/paper';
import { documentToMarkdown } from '../shape/markdown';

/**
 * The whole of a paper's full text to a Markdown file, none of it through the
 * context: for a paper the user wants to keep, or to search with their own
 * tools. A tool of its own, not a parameter of read_paper, because a tool
 * that can write is annotated as one, and a client that asks before every
 * call of such a tool would otherwise ask before every read.
 *
 * Served only where writes are allowed: on a local connection, unless turned
 * off. The path names a file on the caller's machine, and over HTTP this
 * process is not on it.
 */
export const savePaper = defineTool({
  name: 'save_paper',
  title: 'Save paper',
  toolset: 'read',
  onlyWhereWritable: true,
  description:
    'Write the legal open-access full text of a paper to a local Markdown file, a heading per section, without reading it into the conversation. ' +
    'For a paper the user wants to keep or to search with other tools; use read_paper to read it here.',
  input: z.object({
    paper: z.string().max(300).describe('sci-open id or DOI'),
    path: z.string().min(1).max(1000).describe('Absolute path of the file to write (~ is the home directory); .md is added when missing'),
    overwrite: z.boolean().default(false).describe('Replace a file already at the path')
  }),
  output: z.object({
    /** A source records this paper as retracted. */
    retracted: z.literal(true).optional(),
    paper: z.string(),
    tier: z.enum(['europepmc-jats', 'arxiv-html', 'pdf']),
    url: z.string(),
    license: z.string().optional(),
    path: z.string(),
    sections: z.number().int(),
    bytes: z.number().int(),
    sha256: z.string()
  }),
  async run(args, deps) {
    // Never served where it may not write, but asked anyway it refuses before
    // fetching anything: a refusal certain from the start must not spend a
    // lookup, a download or a paced host's slot first.
    const writable = writesAllowed(deps);
    if (!writable) {
      throw new ToolError('writes_disabled', 'This server is not allowed to write files.', 'Read the paper with read_paper instead.');
    }

    const paper = await resolvePaperRef(args.paper, deps);
    const doc = await deps.engine.readFullText(paper, { trustedOnly: deps.config.trustedFullTextOnly, signal: deps.signal });
    if (!doc) {
      throw new ToolError('no_full_text', 'No legal open-access full text was found for this paper.', 'Use get_paper for the abstract and landing page.');
    }
    const markdown = documentToMarkdown(doc);
    const path = await writeUserFile({ allowed: writable }, args.path, '.md', markdown, args.overwrite);
    const bytes = Buffer.byteLength(markdown);
    return {
      structured: {
        ...(paper.retracted ? { retracted: true as const } : {}),
        paper: paper.id, tier: doc.tier, url: doc.url,
        ...(doc.license ? { license: sanitizeText(doc.license) } : {}),
        path, sections: doc.sections.length, bytes,
        sha256: createHash('sha256').update(markdown).digest('hex')
      },
      text: [
        ...(paper.retracted ? [retractionWarning(['This paper'])] : []),
        `Saved ${doc.sections.length} sections (${bytes} bytes) to ${path}.`,
        copySource(paper, doc)
      ].join('\n'),
      provenance: doc.license ? { license: doc.license } : {}
    };
  }
});
