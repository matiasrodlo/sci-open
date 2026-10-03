import * as z from 'zod';
import type { Paper } from '@sci-open/shared';
import type { CitationLink } from '@sci-open/core';
import { defineTool } from '../framework/define-tool';
import { ToolError } from '../errors';
import { paperRefKind, resolvePaperRef } from './resolve-paper';
import { shapePaper, paperSchema, listedTitle, retractionWarning } from '../shape/paper';
import { fenceUntrusted } from '../safety/untrusted';

/** A linked work's record, without its abstract: a list entry, not a reading. */
const linkedRecord = paperSchema.omit({ abstract: true });

/**
 * The record to show for a link: of the records its DOIs resolve to, the
 * published version's, so a reference listed as preprint-then-article reads
 * as the article; otherwise the first found.
 */
function recordFor(link: CitationLink, found: ReadonlyMap<string, Paper>): Paper | undefined {
  const records = link.dois.flatMap(doi => found.get(doi.toLowerCase()) ?? []);
  return records.find(r => r.stage === 'published') ?? records[0];
}

export const getCitations = defineTool({
  name: 'get_citations',
  title: 'Get citations',
  toolset: 'graph',
  description:
    'The references of a paper (direction="references") or the papers citing it (direction="cited_by"), from OpenCitations, ' +
    'each resolved to a record where OpenAlex holds it, with self-citations flagged. Paged by offset. The paper needs a DOI; ' +
    'pass the DOI itself when you have it, which skips looking the paper up.',
  input: z.object({
    paper: z.string().min(1).max(300).describe('DOI (preferred) or sci-open id, e.g. 10.7717/peerj-cs.421 or openalex:W3134956838'),
    direction: z.enum(['references', 'cited_by']),
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0)
  }),
  output: z.object({
    paper: z.string(),
    doi: z.string(),
    direction: z.enum(['references', 'cited_by']),
    total_links: z.number().int(),
    offset: z.number().int(),
    returned: z.number().int(),
    next_offset: z.number().int().nullable(),
    /** True when OpenAlex could not be asked about some DOIs on this page,
     * so a link without a record may still be in it. */
    records_incomplete: z.boolean(),
    links: z.array(z.object({
      doi: z.string().optional(),
      other_dois: z.array(z.string()).optional(),
      pmid: z.string().optional(),
      /** A sci-open id for get_paper, when one is known. */
      id: z.string().optional(),
      created: z.string().optional(),
      journal_self_citation: z.boolean(),
      author_self_citation: z.boolean(),
      record: linkedRecord.optional()
    }))
  }),
  async run(args, deps) {
    // A DOI is what OpenCitations is keyed by, so it is used as given: looking
    // the paper up first would be a search of every source, for nothing.
    const kind = paperRefKind(args.paper);
    let doi: string;
    if ('doi' in kind) {
      doi = kind.doi;
    } else {
      const paper = await resolvePaperRef(args.paper, deps);
      if (!paper.doi) {
        throw new ToolError(
          'not_found',
          'This paper has no DOI, and OpenCitations is keyed by DOI.',
          'Check get_paper for a DOI; without one there are no citation links to read.'
        );
      }
      doi = paper.doi;
    }

    const all = await deps.engine.citationLinks(doi, args.direction);
    // OpenCitations answers an unknown DOI with an empty list, the same as a
    // paper nobody cites; the DOI registry tells the two apart.
    if (all.length === 0 && (await deps.engine.doiRegistered(doi)) === false) {
      throw new ToolError('not_found', `No DOI registry holds ${doi}.`, 'Check the DOI, or find the paper with search_papers.');
    }
    if (args.offset > 0 && args.offset >= all.length) {
      throw new ToolError('not_found', `There are ${all.length} links; offset ${args.offset} is past the end.`, 'Use a smaller offset.');
    }

    const page = all.slice(args.offset, args.offset + args.limit);
    const { found, unasked } = await deps.engine.resolveDois(page.flatMap(l => l.dois));
    const notAsked = new Set(unasked.map(d => d.toLowerCase()));

    const links = page.map(link => {
      const record = recordFor(link, found);
      const chosen = record?.doi ?? link.dois[0];
      const others = link.dois.filter(d => d.toLowerCase() !== chosen?.toLowerCase());
      const id = record?.id ?? (link.openalex ? `openalex:${link.openalex}` : undefined);
      let shaped: z.infer<typeof linkedRecord> | undefined;
      if (record) {
        const { abstract: _abstract, ...rest } = shapePaper(record, 'concise');
        shaped = rest;
      }
      return {
        ...(chosen ? { doi: chosen } : {}),
        ...(others.length ? { other_dois: others } : {}),
        ...(link.pmid ? { pmid: link.pmid } : {}),
        ...(id ? { id } : {}),
        ...(link.created ? { created: link.created } : {}),
        journal_self_citation: link.journalSelfCitation,
        author_self_citation: link.authorSelfCitation,
        ...(shaped ? { record: shaped } : {})
      };
    });
    const recordsIncomplete = page.some(l => !recordFor(l, found) && l.dois.some(d => notAsked.has(d.toLowerCase())));

    const next_offset = args.offset + page.length < all.length ? args.offset + page.length : null;
    const rows = links.map((l, i) => {
      const what = l.record
        ? `${listedTitle(l.record)} (${l.record.year ?? 'n.d.'})${l.record.authors.length ? ` — ${l.record.authors.join(', ')}` : ''}`
        : 'no record';
      const flags = `${l.author_self_citation ? ' [author self-citation]' : ''}${l.journal_self_citation ? ' [journal self-citation]' : ''}`;
      return `${args.offset + i + 1}. ${what}${l.doi ? ` doi:${l.doi}` : ''}${l.id ? ` id:${l.id}` : ''}${flags}`;
    });
    const noun = args.direction === 'references' ? 'references' : 'citing papers';
    const retractedRows = links.flatMap((l, i) => (l.record?.retracted ? [`#${args.offset + i + 1}`] : []));
    const shown = page.length ? `, ${args.offset + 1}–${args.offset + page.length} shown` : '';
    return {
      structured: {
        paper: args.paper, doi, direction: args.direction, total_links: all.length, offset: args.offset,
        returned: page.length, next_offset, records_incomplete: recordsIncomplete, links
      },
      text: [
        ...(retractedRows.length ? [retractionWarning(retractedRows.length === 1 ? [`Link ${retractedRows[0]}`] : [`Links ${retractedRows.join(', ')}`])] : []),
        `# ${all.length.toLocaleString('en')} ${noun} of doi:${doi}${shown}`,
        'Links from OpenCitations, which holds most open citation data but not every citation; records from OpenAlex.',
        ...(recordsIncomplete ? ['OpenAlex could not be asked about some of these, so "no record" may only mean not looked up; retry later for them.'] : []),
        ...(all.length === 0 ? [`OpenCitations holds no ${noun} for this DOI. A very new paper, or one whose publisher does not deposit references, can have none here.`] : []),
        '',
        ...(rows.length ? [fenceUntrusted('linked works', rows.join('\n'))] : []),
        ...(next_offset !== null ? ['', `Next: get_citations(paper="${args.paper}", direction="${args.direction}", offset=${next_offset}, limit=${args.limit})`] : [])
      ].join('\n'),
      provenance: { negativeResult: all.length === 0 }
    };
  }
});
