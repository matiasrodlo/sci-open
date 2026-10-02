import type { Paper } from '@open-access-explorer/shared';
import type { ToolDeps } from '../framework/define-tool';
import { ToolError } from '../errors';

const DOI_URL = /^https?:\/\/(dx\.)?doi\.org\//i;

/** `10.…` or a doi.org URL is a DOI; anything else is a sci-open id. One rule,
 * so every tool that takes "a paper" as one string agrees on what it is. */
export function paperRefKind(ref: string): { doi: string } | { id: string } {
  const trimmed = ref.trim();
  return DOI_URL.test(trimmed) || /^10\.\d{4,9}\//.test(trimmed)
    ? { doi: trimmed.replace(DOI_URL, '') }
    : { id: trimmed };
}

export async function resolvePaperRef(ref: string, deps: ToolDeps): Promise<Paper> {
  const kind = paperRefKind(ref);
  const paper = 'doi' in kind
    ? await deps.engine.lookupDoi(kind.doi, { admit: deps.admit }) // a DOI lookup is a search
    : await deps.engine.lookup(kind.id);
  if (!paper) {
    throw new ToolError('not_found', 'No source holds this paper.', 'Pass a DOI or an id from search_papers, such as openalex:W2741809807.');
  }
  return paper;
}
