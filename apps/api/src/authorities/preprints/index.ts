import type { AuthorityFacts } from '@open-access-explorer/shared';
import { servesPdf } from '../../lib/pdf-proxy';
import { capabilities } from './capabilities';
import { locate } from './locate';

export { capabilities, locate };

export type LookupOptions = {
  timeoutMs: number;
  signal?: AbortSignal;
  userAgent?: string;
};

/** Sent when the caller has none, so a server's logs can still name us. */
const DEFAULT_USER_AGENT = 'OpenAccessExplorer/1.0';

/**
 * The server's PDF for this DOI, once it has been fetched and found to be one.
 *
 * Fetched because this is the one place a copy is built rather than reported,
 * and the rescue admits a paper to the results on it. An address that follows
 * from a DOI is still a guess about the server: a withdrawn preprint, an OSF
 * preprint whose file is a Word document, a path the server has moved. So the
 * first bytes are read, and anything that is not `%PDF-` is no copy — which is
 * also what makes `verified: true` true.
 *
 * `null` when no server's rule covers the DOI, or its answer is not a PDF.
 * Throws when there was no answer, so the report tells an outage from a miss.
 */
export async function lookup(doi: string, options: LookupOptions): Promise<AuthorityFacts | null> {
  const url = locate(doi);
  if (!url) return null;

  const found = await servesPdf(new URL(url), options.userAgent ?? DEFAULT_USER_AGENT, {
    timeoutMs: options.timeoutMs,
    ...(options.signal ? { signal: options.signal } : {})
  });

  return found ? { fullText: { url, kind: 'pdf', verified: true } } : null;
}
