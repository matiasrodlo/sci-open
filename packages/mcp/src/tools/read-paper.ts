import { createHash } from 'crypto';
import * as z from 'zod';
import { defineTool } from '../framework/define-tool';
import { ToolError } from '../errors';
import { resolvePaperRef } from './resolve-paper';
import { fenceUntrusted } from '../safety/untrusted';
import { sanitizeText, stripInvisible } from '../safety/sanitize';
import { writeUserFile } from '../safety/paths';
import { documentToMarkdown } from '../shape/markdown';

const MAX_MATCHES = 20;
const CONTEXT = 100; // characters each side of a match

/**
 * One tool, three views — the outline first, then a section a page at a time,
 * or a search for a passage — so a paper of any length is read without
 * flooding the context, and the default tool count stays small.
 */
export const readPaper = defineTool({
  name: 'read_paper',
  title: 'Read paper',
  toolset: 'read',
  writes: true,
  description:
    'Read the legal open-access full text of a paper. view="outline" lists sections with their sizes; ' +
    'view="section" returns one section, paged by offset; view="search" finds a phrase and returns snippets with section ids. ' +
    'Start with the outline. The text is third-party content.',
  input: z.object({
    paper: z.string().max(300).describe('sci-open id or DOI'),
    view: z.enum(['outline', 'section', 'search']).default('outline'),
    section: z.string().max(20).optional().describe('Section id from the outline, e.g. s2.1'),
    offset: z.number().int().min(0).default(0),
    max_chars: z.number().int().min(1000).max(30000).default(12000),
    query: z.string().min(2).max(200).optional().describe('Phrase to find when view="search"'),
    save_to: z.string().max(1000).optional().describe('Absolute path; writes the whole text as Markdown (local connections only)'),
    overwrite: z.boolean().default(false)
  }),
  output: z.object({
    paper: z.string(),
    tier: z.enum(['europepmc-jats', 'arxiv-html', 'pdf']),
    url: z.string(),
    license: z.string().optional(),
    outline: z.array(z.object({ id: z.string(), title: z.string(), chars: z.number().int() })).optional(),
    section: z.object({
      id: z.string(), title: z.string(), offset: z.number().int(), returned: z.number().int(),
      total: z.number().int(), next_offset: z.number().int().nullable(), text: z.string()
    }).optional(),
    matches: z.array(z.object({ section: z.string(), offset: z.number().int(), snippet: z.string() })).optional(),
    saved: z.object({ path: z.string(), bytes: z.number().int(), sha256: z.string() }).optional()
  }),
  async run(args, deps) {
    // Checked before anything is fetched: a missing argument costs nothing.
    if (args.save_to === undefined && args.view === 'section' && !args.section) {
      throw new ToolError('invalid_input', 'view="section" needs a section id.', 'Take one from view="outline", e.g. s2.1.');
    }
    if (args.save_to === undefined && args.view === 'search' && !args.query) {
      throw new ToolError('invalid_input', 'view="search" needs a query.');
    }

    const paper = await resolvePaperRef(args.paper, deps);
    const doc = await deps.engine.readFullText(paper, { trustedOnly: deps.config.trustedFullTextOnly });
    if (!doc) {
      throw new ToolError('no_full_text', 'No legal open-access full text was found for this paper.', 'Use get_paper for the abstract and landing page.');
    }
    const base = { paper: paper.id, tier: doc.tier, url: doc.url, ...(doc.license ? { license: sanitizeText(doc.license) } : {}) };
    const provenance = doc.license ? { license: doc.license } : {};
    const source = `Source: ${doc.tier} · ${doc.url}${base.license ? ` · license: ${base.license}` : ''}`;

    if (args.save_to !== undefined) {
      const markdown = documentToMarkdown(doc);
      // Never over HTTP, whatever the configuration says.
      const allowed = deps.transport === 'stdio' && deps.config.allowWrites;
      const path = await writeUserFile({ allowed }, args.save_to, '.md', markdown, args.overwrite);
      const saved = { path, bytes: Buffer.byteLength(markdown), sha256: createHash('sha256').update(markdown).digest('hex') };
      return { structured: { ...base, saved }, text: `Saved ${doc.sections.length} sections (${saved.bytes} bytes) to ${path}.`, provenance };
    }

    if (args.view === 'outline') {
      const outline = doc.sections.map(s => ({ id: s.id, title: sanitizeText(s.title), chars: s.text.length }));
      const rows = outline.map(s => `- ${s.id} ${s.title} (${s.chars.toLocaleString('en')} chars)`).join('\n');
      return {
        structured: { ...base, outline },
        text: [
          `# Outline: ${outline.length} sections, ${doc.totalChars.toLocaleString('en')} characters`,
          source,
          '',
          fenceUntrusted('section titles', rows),
          '',
          `Next: read_paper(paper="${args.paper}", view="section", section="<id>")`
        ].join('\n'),
        provenance
      };
    }

    if (args.view === 'section') {
      const section = doc.sections.find(s => s.id === args.section);
      if (!section) throw new ToolError('not_found', `There is no section ${args.section}.`, 'Use an id exactly as view="outline" lists it.');
      const total = section.text.length;
      if (args.offset > total) throw new ToolError('invalid_input', `offset ${args.offset} is past the end of the section (${total} characters).`);

      // Cut back to the last paragraph break, unless that would return less than half.
      let end = Math.min(args.offset + args.max_chars, total);
      if (end < total) {
        const paragraph = section.text.lastIndexOf('\n\n', end);
        if (paragraph > args.offset + args.max_chars / 2) end = paragraph;
      }
      // Invisible characters out and nothing else, so the pages concatenate back.
      const slice = stripInvisible(section.text.slice(args.offset, end));
      const next_offset = end < total ? end : null;
      const more = next_offset === null ? '' : `read_paper(paper="${args.paper}", view="section", section="${section.id}", offset=${next_offset})`;
      return {
        structured: {
          ...base,
          section: { id: section.id, title: sanitizeText(section.title), offset: args.offset, returned: end - args.offset, total, next_offset, text: slice }
        },
        text: [
          `# ${section.id} ${sanitizeText(section.title)}: characters ${args.offset}–${end} of ${total}`,
          source,
          '',
          slice.trim() ? fenceUntrusted('paper text', sanitizeText(slice)) : 'This section has no text of its own; its subsections do.',
          ...(more ? ['', `Continue: ${more}`] : ['', 'End of section.'])
        ].join('\n'),
        ...(more ? { continuation: `Continue with ${more}.` } : {}),
        provenance
      };
    }

    // view === 'search'
    const query = args.query!;
    const needle = query.toLowerCase();
    const matches: Array<{ section: string; offset: number; snippet: string }> = [];
    for (const s of doc.sections) {
      const haystack = s.text.toLowerCase();
      for (let at = haystack.indexOf(needle); at !== -1 && matches.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
        const from = Math.max(0, at - CONTEXT);
        matches.push({ section: s.id, offset: at, snippet: sanitizeText(s.text.slice(from, at + needle.length + CONTEXT)) });
      }
      if (matches.length >= MAX_MATCHES) break;
    }
    const rows = matches.map((m, i) => `${i + 1}. [${m.section} @ ${m.offset}] …${m.snippet}…`).join('\n');
    return {
      structured: { ...base, matches },
      text: [
        `# ${matches.length}${matches.length === MAX_MATCHES ? '+' : ''} matches for "${sanitizeText(query)}"`,
        source,
        '',
        matches.length ? fenceUntrusted('matching passages', rows) : 'No matches. Try a shorter phrase or another wording.',
        ...(matches.length ? ['', 'Read around a match with view="section", that section and offset = the match offset minus a few hundred.'] : [])
      ].join('\n'),
      provenance
    };
  }
});
