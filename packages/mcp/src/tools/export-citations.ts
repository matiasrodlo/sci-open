import { createHash } from 'crypto';
import * as z from 'zod';
import type { Paper } from '@sci-open/shared';
import { generateCitationsBatch, getFileExtension, getMimeType } from '@sci-open/shared';
import pLimit from '../p-limit';
import { defineTool } from '../framework/define-tool';
import { ToolError, toToolError } from '../errors';
import { paperRefKind } from './resolve-paper';
import { writeUserFile } from '../safety/paths';
import { stripInvisible } from '../safety/sanitize';
import { retractionWarning } from '../shape/paper';

/** Invisible characters out of every text field, as from all third-party text
 * this server returns. The formatter escapes the rest for its format. */
function visible(p: Paper): Paper {
  return {
    ...p,
    title: stripInvisible(p.title),
    authors: p.authors.map(stripInvisible),
    ...(p.venue ? { venue: stripInvisible(p.venue) } : {}),
    ...(p.publisher ? { publisher: stripInvisible(p.publisher) } : {}),
    ...(p.abstract ? { abstract: stripInvisible(p.abstract) } : {}),
    topics: p.topics.map(stripInvisible)
  };
}

export const exportCitations = defineTool({
  name: 'export_citations',
  title: 'Export citations',
  toolset: 'export',
  writes: true,
  description:
    'BibTeX or RIS for up to 200 papers (DOIs or sci-open ids), generated from the records: never retype a citation yourself. ' +
    'With save_to (local connections only) the file is written to disk; otherwise it is attached as a resource to save as is. ' +
    'Papers that could not be resolved are listed, never dropped silently.',
  input: z.object({
    papers: z.array(z.string().min(1).max(300)).min(1).max(200).describe('DOIs or sci-open ids, in the order wanted'),
    format: z.enum(['bibtex', 'ris']).default('bibtex'),
    include_abstracts: z.boolean().default(false).describe('Put each abstract in its entry'),
    save_to: z.string().max(1000).optional().describe('Absolute path for the file (local connections only)'),
    overwrite: z.boolean().default(false)
  }),
  output: z.object({
    format: z.enum(['bibtex', 'ris']),
    entries: z.number().int(),
    sha256: z.string(),
    path: z.string().optional(),
    resource_uri: z.string().optional(),
    /** Inputs that named a paper already in the file. */
    duplicates: z.number().int(),
    /** Inputs whose paper a source records as retracted: exported all the same. */
    retracted: z.array(z.string()),
    unresolved: z.array(z.object({ input: z.string(), reason: z.string() }))
  }),
  async run(args, deps) {
    // Before anything is resolved: a refusal certain from the start must not
    // spend a lookup, or a search per DOI, first.
    const writable = deps.transport === 'stdio' && deps.config.allowWrites;
    if (args.save_to !== undefined && !writable) {
      throw new ToolError('writes_disabled', 'This server is not allowed to write files.', 'Omit save_to to receive the file as a resource.');
    }

    const kinds = args.papers.map(paperRefKind);
    // Fifty DOIs to an OpenAlex request; a DOI it lacks, or could not be asked
    // about, falls back to a DOI lookup, which is a search and spends an
    // admission like one.
    const { found } = await deps.engine.resolveDois(kinds.flatMap(k => ('doi' in k ? [k.doi] : [])));
    const limit = pLimit(3);
    const resolved = await Promise.all(kinds.map(k => limit(async (): Promise<Paper | { reason: string }> => {
      try {
        const paper = 'doi' in k
          ? found.get(k.doi.toLowerCase()) ?? (await deps.engine.lookupDoi(k.doi, { admit: deps.admit }))
          : await deps.engine.lookup(k.id);
        return paper ?? { reason: 'not_found' };
      } catch (error) {
        return { reason: toToolError(error).code }; // one failure is that paper's, not the export's
      }
    })));

    const papers: Paper[] = [];
    const retracted: string[] = [];
    const seen = new Set<string>();
    let duplicates = 0;
    const unresolved: Array<{ input: string; reason: string }> = [];
    resolved.forEach((r, i) => {
      if ('reason' in r) unresolved.push({ input: args.papers[i]!, reason: r.reason });
      else if (seen.has(r.id)) duplicates++;
      else {
        seen.add(r.id);
        papers.push(visible(r));
        if (r.retracted) retracted.push(args.papers[i]!);
      }
    });
    if (!papers.length) {
      throw new ToolError(
        'not_found',
        'None of these papers could be resolved.',
        unresolved.some(u => u.reason === 'rate_limited')
          ? 'The search budget ran out on the DOI lookups; retry in a minute.'
          : 'Pass DOIs, or ids exactly as search_papers returned them.'
      );
    }

    const file = generateCitationsBatch(papers, { format: args.format, includeAbstract: args.include_abstracts });
    const sha256 = createHash('sha256').update(file).digest('hex');
    const ext = getFileExtension(args.format);
    const label = args.format === 'bibtex' ? 'BibTeX' : 'RIS';
    const warning = retracted.length ? `${retractionWarning(retracted)}\n` : '';
    const notes = [
      ...(duplicates ? [`${duplicates} duplicate${duplicates === 1 ? '' : 's'} left out.`] : []),
      ...(unresolved.length
        ? [`${unresolved.length} could not be resolved: ${unresolved.slice(0, 10).map(u => `${u.input} (${u.reason})`).join(', ')}` +
          `${unresolved.length > 10 ? `, and ${unresolved.length - 10} more in unresolved` : ''}.`]
        : [])
    ].join(' ');

    if (args.save_to !== undefined) {
      const path = await writeUserFile({ allowed: writable }, args.save_to, ext === 'ris' ? '.ris' : '.bib', file, args.overwrite);
      return {
        structured: { format: args.format, entries: papers.length, sha256, path, duplicates, retracted, unresolved },
        text: `${warning}Wrote ${papers.length} ${label} entries to ${path}.${notes ? ` ${notes}` : ''}`
      };
    }

    const uri = `sci-open://export/${sha256.slice(0, 12)}.${ext}`;
    return {
      structured: { format: args.format, entries: papers.length, sha256, resource_uri: uri, duplicates, retracted, unresolved },
      text: `${warning}${papers.length} ${label} entries attached as a resource (${uri}); save it as is, do not retype it.${notes ? ` ${notes}` : ''}`,
      resources: [{ type: 'resource', resource: { uri, mimeType: getMimeType(args.format), text: file } }]
    };
  }
});
