import { QueryParseError } from '@sci-open/shared';
import { OPENCITATIONS_HOST, OpenCitationsUnavailableError, PdfFetchError, SourceBusyError, type EngineLogger } from '@sci-open/core';

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
      'Write operators in capitals (AND, OR, NOT), balance brackets and quotes, and use the tags in the server instructions. NEAR and SAME are not supported.'
    );
  }
  // A paced host with no slot soon enough: a copy that cannot be fetched yet,
  // with a number on the wait, never "no full text".
  if (error instanceof SourceBusyError) {
    const seconds = Math.ceil(error.retryAfterMs / 1000);
    // arXiv asks for a crawl delay; OpenCitations allows so many a minute and
    // answers 429 past it. Either way it is a wait, with a number on it.
    const citations = error.host === OPENCITATIONS_HOST;
    return new ToolError(
      'rate_limited',
      citations
        ? `OpenCitations limits how often it may be asked; the next request can go in ${seconds} s.`
        : `${error.host} asks automated readers to space their requests; the next one can go in ${seconds} s.`,
      citations
        ? 'Retry after the wait. Pages of a citation list already fetched never wait.'
        : 'Retry after the wait, or read another paper meanwhile. Sections of a paper already read never wait.',
      seconds
    );
  }
  if (error instanceof OpenCitationsUnavailableError) {
    return error.status === 429
      ? new ToolError('rate_limited', 'OpenCitations asks for fewer requests a minute.', 'Retry in a minute. Pages of a list already read do not ask it again.', 60)
      : new ToolError('upstream_unavailable', 'OpenCitations did not answer.', 'Retry in a minute; the other tools do not depend on it.');
  }
  if (error instanceof PdfFetchError) {
    return new ToolError('no_full_text', 'The full-text copy could not be fetched.', 'Try view="outline" again later, or use get_paper for the landing page.');
  }
  if (isTimeout(error)) {
    return new ToolError('upstream_unavailable', 'A source did not answer in time.', 'Retry once; if it persists, narrow the query or restrict sources.');
  }
  // A source's own refusal or failure, by the HTTP status its client attached
  // (arXiv, bioRxiv, OpenAlex) or the HTTP client's error carries. Measured
  // live: arXiv's 429s reached the model as `internal`, a fault of this server.
  const status = httpStatus(error);
  if (status === 429) {
    const seconds = retryAfter(error) ?? 60;
    return new ToolError('rate_limited', 'A source asks for fewer requests for now.', `Retry in ${seconds} s.`, seconds);
  }
  if (status !== undefined && status >= 500) {
    return new ToolError('upstream_unavailable', 'A source failed to answer.', 'Retry once; if it persists, restrict sources.');
  }
  return new ToolError('internal', 'The server could not complete this request.');
}

function httpStatus(error: unknown): number | undefined {
  const e = error as { status?: unknown; response?: { status?: unknown } } | undefined;
  const status = e?.status ?? e?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

function retryAfter(error: unknown): number | undefined {
  const seconds = (error as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : undefined;
}

/**
 * `toToolError`, and one log line for whoever runs the server, who is told the
 * cause the model is not. By what it says about the server:
 *
 * - `internal` is a fault here, logged as an error with its stack;
 * - a ToolError a tool threw, or a query that did not parse, is an answer (a
 *   paper nobody holds, a bad argument), logged at debug;
 * - a wait on a paced or rate-limited source is routine, at info;
 * - any other mapped failure is a source failing, a warning.
 *
 * The cause's message and the tool, never the call's arguments: they hold
 * what the user asked.
 */
export function reportToolError(raw: unknown, tool: string, logger: EngineLogger): ToolError {
  const error = toToolError(raw);
  const fields = { tool, code: error.code, err: raw instanceof Error ? raw.message : String(raw) };
  if (error.code === 'internal') {
    logger.error({ ...fields, ...(raw instanceof Error && raw.stack ? { stack: raw.stack } : {}) }, 'tool call failed');
  } else if (raw instanceof ToolError || raw instanceof QueryParseError) {
    logger.debug(fields, 'tool call refused');
  } else if (error.code === 'rate_limited') {
    logger.info(fields, 'tool call waits on a source');
  } else {
    logger.warn(fields, 'tool call failed upstream');
  }
  return error;
}

function isTimeout(error: unknown): boolean {
  const e = error as { code?: string; name?: string } | undefined;
  return e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.name === 'TimeoutError';
}

export function renderError(error: ToolError): string {
  return [`Error (${error.code}): ${error.message}`, error.hint ? `Hint: ${error.hint}` : ''].filter(Boolean).join('\n');
}
