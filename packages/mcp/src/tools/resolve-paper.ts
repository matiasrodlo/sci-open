import type { Paper } from '@sci-open/shared';
import { parseQuery, PROVIDERS } from '@sci-open/core';
import type { ToolDeps } from '../framework/define-tool';
import { ToolError } from '../errors';

/**
 * The DOI `text` is, bare, when the whole of it is one: `10.…`, `doi:10.…` or
 * a doi.org URL. The engine's own rule (`parseQuery`), so no tool calls
 * something a DOI that the engine would search as words, or the reverse.
 */
export function doiIn(text: string): string | undefined {
  try {
    return parseQuery(text).doi;
  } catch {
    return undefined; // not even a query, let alone a DOI
  }
}

/** Every provider an id can name, in the lower case ids carry. medRxiv shares
 * bioRxiv's module but keeps its own ids. */
const PROVIDER_IDS = new Set<string>([...PROVIDERS.map(p => p.id), 'medrxiv']);

const ID_PREFIX = /^([a-z]+)\s*:\s*/i;

/**
 * An id as sci-open writes it, from one as people and other services do:
 * `arXiv:2101.00001` is arXiv's own spelling, `PMID: 12345` PubMed's. A
 * provider's name is matched in any case and a PMID is NCBI's; anything else
 * is left as it was given.
 */
function canonicalId(ref: string): string {
  const match = ref.match(ID_PREFIX);
  if (!match) return ref;
  const named = match[1]!.toLowerCase();
  const provider = named === 'pmid' ? 'ncbi' : named;
  return PROVIDER_IDS.has(provider) ? `${provider}:${ref.slice(match[0].length)}` : ref;
}

/** A DOI in any of the forms `doiIn` reads is a DOI; anything else is a
 * sci-open id. One rule, so every tool that takes "a paper" as one string
 * agrees on what it is — this server's own lists write `doi:10.…`. */
export function paperRefKind(ref: string): { doi: string } | { id: string } {
  const trimmed = ref.trim();
  const doi = doiIn(trimmed);
  return doi ? { doi } : { id: canonicalId(trimmed) };
}

/**
 * The answer for a paper no source holds. An OpenAlex id — which earlier
 * versions printed, and a model may still hold — names a source no longer
 * asked, and says so rather than that the paper does not exist.
 */
export function paperNotFound(ref: string | undefined, hint: string): ToolError {
  if (ref && /^openalex\s*:/i.test(ref.trim())) {
    return new ToolError('not_found', 'OpenAlex is no longer one of the sources, so its ids name no paper here.', 'Pass the paper\'s DOI, or find it with search_papers.');
  }
  return new ToolError('not_found', 'No source holds this paper.', hint);
}

export async function resolvePaperRef(ref: string, deps: ToolDeps): Promise<Paper> {
  const kind = paperRefKind(ref);
  const paper = 'doi' in kind
    ? await deps.engine.lookupDoi(kind.doi, { admit: deps.admit, signal: deps.signal }) // a DOI lookup is a search
    : await deps.engine.lookup(kind.id, { signal: deps.signal });
  if (!paper) throw paperNotFound(ref, 'Pass a DOI or an id from search_papers, such as europepmc:13054692.');
  return paper;
}
