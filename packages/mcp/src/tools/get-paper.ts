import * as z from 'zod';
import { defineTool } from '../framework/define-tool';
import { ToolError } from '../errors';
import { shapePaper, paperSchema, retractionWarning } from '../shape/paper';
import { fenceUntrusted } from '../safety/untrusted';

const DOI_URL = /^https?:\/\/(dx\.)?doi\.org\//i;

export const getPaper = defineTool({
  name: 'get_paper',
  title: 'Get paper',
  toolset: 'core',
  description:
    'One full record by sci-open id (e.g. openalex:W2741809807, arxiv:2101.00001) or by DOI, with every field and which source supplied it. ' +
    'A DOI is looked up in every source and merged; an id asks only the source it names. Works for closed papers too.',
  input: z.object({
    id: z.string().max(300).optional(),
    doi: z.string().max(300).optional()
  }),
  output: z.object({ paper: paperSchema }),
  async run(args, deps) {
    const id = args.id?.trim();
    const doi = args.doi?.trim().replace(DOI_URL, '');
    if (Boolean(id) === Boolean(doi)) throw new ToolError('invalid_input', 'Pass exactly one of id or doi.');
    const paper = doi
      ? await deps.engine.lookupDoi(doi, { admit: deps.admit })
      : await deps.engine.lookup(id!);
    if (!paper) {
      throw new ToolError('not_found', 'No source holds this paper.', 'Ids look like openalex:W2741809807 or arxiv:2101.00001. Try search_papers, or pass doi.');
    }
    const shaped = shapePaper(paper, 'full');
    // Title, authors and venue are third-party text as much as the abstract is.
    const record = [
      `# ${shaped.title}`,
      [`${shaped.authors.slice(0, 10).join(', ')}${shaped.authors.length > 10 ? ', …' : ''}`, shaped.year ?? 'n.d.', shaped.venue]
        .filter(Boolean).join(' · '),
      shaped.abstract ? `\n${shaped.abstract}` : ''
    ].filter(Boolean).join('\n');
    const text = [
      retractionWarning(shaped.retracted ? ['This paper'] : []),
      shaped.doi ? `DOI: ${shaped.doi}` : '',
      `Access: ${shaped.access}${shaped.full_text ? ` · full text: ${shaped.full_text.kind}${shaped.full_text.verified ? ' (verified)' : ' (unverified)'}` : ''}`,
      `Found in: ${shaped.found_in.join(', ')}${id ? ' (looked up by id, which asks only that source; pass doi to see every source that holds it)' : ''}`,
      fenceUntrusted('paper record', record)
    ].filter(Boolean).join('\n');
    return { structured: { paper: shaped }, text };
  }
});
