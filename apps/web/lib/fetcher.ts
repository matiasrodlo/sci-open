import axios from 'axios';
import { OARecord, SearchParams, SearchResponse } from '@open-access-explorer/shared';

/**
 * Every call to the API goes through here.
 *
 * The origin is decided in one place, and it is decided differently on the two
 * sides of the render. In the browser the path stays relative, so the
 * `/api/:path*` rewrite in `next.config.js` is what points at the API — which
 * is the rewrite's whole purpose, and it was being bypassed by every caller
 * that built its own `http://localhost:4000`. On the server there is no origin
 * to be relative to, so the configured base is used.
 *
 * That split is why components must not construct URLs themselves: a component
 * cannot know which side it will run on, and the one that hardcoded the
 * localhost origin worked in development and could not have worked anywhere
 * else.
 */

const SERVER_API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:4000';

function apiUrl(path: string): string {
  return typeof window === 'undefined' ? `${SERVER_API_BASE}${path}` : path;
}

export async function searchPapers(params: SearchParams): Promise<SearchResponse> {
  const response = await axios.post<SearchResponse>(apiUrl('/api/search'), params);
  return response.data;
}

/**
 * `/api/paper/:id` returns the record itself.
 *
 * It was typed `PaperResponse` — `{ record, pdf: { url?, status } }` — which
 * the endpoint has never returned. Nothing read the declared shape, because
 * the only caller bypassed this function and treated the response as what it
 * actually is. The type is gone rather than corrected: `OARecord` is the
 * contract, and a second name for it that disagreed was the whole problem.
 */
export async function getPaper(id: string): Promise<OARecord> {
  const response = await axios.get<OARecord>(apiUrl(`/api/paper/${encodeURIComponent(id)}`), {
    headers: { 'Cache-Control': 'no-store' }
  });
  return response.data;
}

export function isDOI(query: string): boolean {
  // Simple DOI pattern matching
  const doiPattern = /^10\.\d{4,}\/[^\s]+$/i;
  return doiPattern.test(query.trim());
}
