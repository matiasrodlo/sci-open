import { createHash } from 'crypto';
import * as z from 'zod';
import { PROVIDERS } from '@sci-open/core';
import { canonicalJson } from './provenance';
import { ToolError } from './errors';

export const SOURCES = PROVIDERS.map(p => p.id) as [string, ...string[]];
export const SORTS = ['relevance', 'date', 'date_asc', 'citations', 'citations_asc'] as const;
export const PUBLICATION_TYPES = ['peer-reviewed', 'preprint'] as const;

/** Exactly what search_papers can produce. A decoded handle is checked against
 * it, so a handle can carry nothing the tool's own input would have refused. */
const specSchema = z.object({
  q: z.string().max(2000).optional(),
  doi: z.string().max(300).optional(),
  filters: z.object({
    openAccessOnly: z.boolean(),
    yearFrom: z.number().int().min(1600).max(2100).optional(),
    yearTo: z.number().int().min(1600).max(2100).optional(),
    source: z.array(z.enum(SOURCES)).max(SOURCES.length).optional(),
    publicationType: z.array(z.enum(PUBLICATION_TYPES)).optional()
  }).strict(),
  sort: z.enum(SORTS),
  // Part of the handle, so page N names the same results on every call.
  pageSize: z.number().int().min(1).max(25),
  // The search counted its facets across the sources (`include_facets`). A
  // set counted is held apart from one that was not, so its pages must ask
  // for the counts too, or resolve the whole search again.
  facets: z.literal(true).optional()
}).strict();

/**
 * A search, as a handle encodes it: the query, filters, sort, page size and
 * whether it counted facets — everything but the page. Without `facets` it is
 * a valid `SearchParams` minus the page (`engineCall`).
 */
export type SearchSpec = z.infer<typeof specSchema>;

/** What both search tools send the engine for a spec: the search, and the
 * options that decide which held set answers it. */
export function engineCall(spec: SearchSpec): {
  params: Omit<SearchSpec, 'facets'>;
  options: { sources?: string[]; facets?: true };
} {
  const { facets, ...params } = spec;
  return {
    params,
    // `sources` narrows the fan-out itself, so it saves upstream requests as
    // well as results; it stays in the spec too, because the handle records it.
    options: { ...(spec.filters.source ? { sources: spec.filters.source } : {}), ...(facets ? { facets } : {}) }
  };
}

const PREFIX = 's1';

/** Arrays in filters are sets; sort them so equal searches get equal handles. */
function normalize(spec: SearchSpec): SearchSpec {
  const { source, publicationType } = spec.filters;
  return {
    ...spec,
    filters: {
      ...spec.filters,
      ...(source ? { source: [...source].sort() } : {}),
      ...(publicationType ? { publicationType: [...publicationType].sort() } : {})
    }
  };
}

const check = (body: string) => createHash('sha256').update(body).digest('base64url').slice(0, 10);

const invalid = () =>
  new ToolError('invalid_handle', 'This search handle is not valid.', 'Copy the handle exactly as search_papers returned it, or run the search again.');

/**
 * A self-describing handle: any server instance can serve a page from it, so
 * paging needs no session (decision D4). The checksum is not a security
 * control — anyone can compute it, and anyone can run any search anyway. It
 * catches a model that truncated or retyped a handle, which would otherwise
 * silently run a different search. The schema check on decoding is the
 * control.
 */
export function encodeSearchHandle(spec: SearchSpec): string {
  const body = Buffer.from(canonicalJson(normalize(spec))).toString('base64url');
  return `${PREFIX}.${body}.${check(body)}`;
}

export function decodeSearchHandle(handle: string): SearchSpec {
  const [prefix, body, sum, ...rest] = handle.trim().split('.');
  if (prefix !== PREFIX || !body || !sum || rest.length || check(body) !== sum) throw invalid();
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw invalid(); // a correct checksum over a body that is not JSON
  }
  const parsed = specSchema.safeParse(json);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
