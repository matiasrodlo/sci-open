import * as z from 'zod';
import { defineTool } from '../framework/define-tool';
import { ToolError } from '../errors';
import { shapePaper, paperSchema, placeIn, retractionWarning } from '../shape/paper';
import { fenceUntrusted } from '../safety/untrusted';
import { doiIn, paperRefKind } from './resolve-paper';

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
    const doi = args.doi?.trim();
    if (Boolean(id) === Boolean(doi)) throw new ToolError('invalid_input', 'Pass exactly one of id or doi.');
    // `doi` is a DOI on the caller's word; an id that is one, `doi:10.…` as the
    // other tools print it, is looked up as one too.
    const ref = doi ? { doi: doiIn(doi) ?? doi } : paperRefKind(id!);
    const paper = 'doi' in ref
      ? await deps.engine.lookupDoi(ref.doi, { admit: deps.admit, signal: deps.signal })
      : await deps.engine.lookup(ref.id, { signal: deps.signal });
    if (!paper) {
      throw new ToolError('not_found', 'No source holds this paper.', 'Ids look like openalex:W2741809807 or arxiv:2101.00001. Try search_papers, or pass doi.');
    }
    const shaped = shapePaper(paper, 'full');
    // Title, authors and venue are third-party text as much as the abstract is.
    // So are the links: a landing page or a copy's URL is whatever a source
    // said it was.
    const record = [
      `# ${shaped.title}`,
      [`${shaped.authors.slice(0, 10).join(', ')}${shaped.authors.length > 10 ? ', …' : ''}`, shaped.year ?? 'n.d.', [shaped.venue, placeIn(shaped)].filter(Boolean).join(' '), shaped.publisher]
        .filter(Boolean).join(' · '),
      shaped.landing_page ? `Landing page: ${shaped.landing_page}` : '',
      shaped.full_text?.url ? `Full text (${shaped.full_text.kind}, ${shaped.full_text.verified ? 'verified' : 'unverified'}): ${shaped.full_text.url}` : '',
      shaped.topics?.length ? `Topics: ${shaped.topics.slice(0, 10).join('; ')}` : '',
      shaped.abstract ? `\n${shaped.abstract}` : ''
    ].filter(Boolean).join('\n');
    const text = [
      retractionWarning(shaped.retracted ? ['This paper'] : []),
      shaped.doi ? `DOI: ${shaped.doi}` : '',
      `Access: ${shaped.access}${shaped.full_text ? ` · full text: ${shaped.full_text.kind}${shaped.full_text.verified ? ' (verified)' : ' (unverified)'}` : ''}`,
      shaped.citations !== undefined ? `Cited ${shaped.citations.toLocaleString('en')} times` : '',
      `Found in: ${shaped.found_in.join(', ')}${'id' in ref ? ' (looked up by id, which asks only that source; pass doi to see every source that holds it)' : ''}`,
      fenceUntrusted('paper record', record)
    ].filter(Boolean).join('\n');
    return { structured: { paper: shaped }, text };
  }
});
