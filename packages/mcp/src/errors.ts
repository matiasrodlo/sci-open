import { QueryParseError } from '@open-access-explorer/shared';
import { PdfProxyError } from '@open-access-explorer/core';

/**
 * Every failure a tool can return: a stable code, a plain message, and a hint
 * that tells the model what to do next — never a stack trace, an upstream's
 * message or a hostname. The table of codes is Appendix B of
 * docs/mcp-implementation-manual.md.
 */
export type ToolErrorCode =
  | 'invalid_input' | 'invalid_handle' | 'not_found' | 'no_full_text'
  | 'upstream_unavailable' | 'rate_limited' | 'writes_disabled' | 'internal';

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly hint?: string,
    readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Too many new result sets in too short a time. Pages of a held set never raise it. */
export class AdmissionError extends ToolError {
  constructor(retryAfterSeconds: number) {
    super(
      'rate_limited',
      `Too many new searches. Retry in ${retryAfterSeconds} s.`,
      'Paging through a search already run (get_search_page) does not count against this limit.',
      retryAfterSeconds
    );
  }
}

/** Never leaks upstream messages, hostnames or stack traces to the model. */
export function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) return error;
  if (error instanceof QueryParseError) {
    return new ToolError(
      'invalid_input',
      `The query could not be parsed at position ${error.position}: ${error.message}`,
      'Quote words that look like operators ("or"), balance brackets, and use the tags in the server instructions. NEAR and SAME are not supported.'
    );
  }
  if (error instanceof PdfProxyError) {
    return new ToolError('no_full_text', 'The full-text copy could not be fetched.', 'Try view="outline" again later, or use get_paper for the landing page.');
  }
  if (isTimeout(error)) {
    return new ToolError('upstream_unavailable', 'A source did not answer in time.', 'Retry once; if it persists, narrow the query or restrict sources.');
  }
  return new ToolError('internal', 'The server could not complete this request.');
}

function isTimeout(error: unknown): boolean {
  const e = error as { code?: string; name?: string } | undefined;
  return e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.name === 'TimeoutError';
}

export function renderError(error: ToolError): string {
  return [`Error (${error.code}): ${error.message}`, error.hint ? `Hint: ${error.hint}` : ''].filter(Boolean).join('\n');
}
