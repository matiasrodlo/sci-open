import { QueryParseError } from '@open-access-explorer/shared';
import { PdfProxyError } from './pdf-proxy';

/**
 * What a client is told when something fails.
 *
 * Every route used to `return { error: error.message }`, which hands the
 * caller whatever the failure happened to say — a connection string in an
 * ECONNREFUSED, an upstream's response body, a file path in a stack-adjacent
 * message. None of it helps the caller and some of it describes the inside of
 * the service.
 *
 * Two kinds of message are worth sending. Validation and proxy errors are
 * *about the request* — "PDF is larger than the download limit", "Refusing to
 * download from a non-public address" — and the caller can act on them.
 * Everything else is about us, and the caller gets a generic message plus the
 * request id, which is the thing that lets an operator find the real error in
 * the log without it being published.
 */
/**
 * A caller who has spent their budget of new searches. See the search route in
 * `app.ts`: it is counted apart from `RATE_LIMIT_MAX`, and only for a search
 * that resolves a set of its own.
 */
export class SearchBudgetError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many new searches. Retry in ${retryAfterSeconds} seconds, or page through a search already run.`);
    this.name = 'SearchBudgetError';
  }
}

export type ClientError = {
  error: string;
  requestId: string;
  /** Offset into the query text, for a parse error a UI can point at. */
  position?: number;
};

export function clientError(error: unknown, requestId: string): ClientError {
  // A query the grammar could not parse is the clearest case of an error about
  // the request: the message names what is wrong with text the caller typed,
  // and the position says where. Withholding it would leave a reader with a
  // rejected search and no way to see why.
  if (error instanceof QueryParseError) {
    return { error: error.message, requestId, position: error.position };
  }

  if (error instanceof PdfProxyError || error instanceof SearchBudgetError) {
    return { error: error.message, requestId };
  }

  return { error: 'The request could not be completed', requestId };
}

/**
 * The status that goes with it.
 *
 * A malformed query is the caller's to fix, so it is a 400 and not the 500 the
 * route would otherwise return — which would have read as "the service is
 * broken" for what is a typo, and would have been logged as an error on every
 * one of them.
 */
export function clientErrorStatus(error: unknown): number {
  if (error instanceof QueryParseError) return 400;
  if (error instanceof SearchBudgetError) return 429;
  return 500;
}

/** Codes axios and the socket give a request that ran out of time. */
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);

/**
 * The status for a failure while asking a provider for one record.
 *
 * `/api/paper/:id` answered 500 for all of them, which says this service is
 * broken when what happened is that the provider holding the record was slow
 * or down — and those call for different things from whoever is reading the
 * status: a 504 or a 502 is worth retrying later, a 500 is worth a bug report.
 *
 * A mistake in this service's own code still reads as one. The providers
 * throw their own `…UnavailableError`s, axios errors or plain `Error`s; a
 * `TypeError` or `ReferenceError` is not something any of them answers with.
 */
export function lookupErrorStatus(error: unknown): number {
  if (error instanceof QueryParseError) return 400;

  const { code, name } = (error ?? {}) as { code?: unknown; name?: unknown };
  if (name === 'TimeoutError' || (typeof code === 'string' && TIMEOUT_CODES.has(code))) return 504;

  if (error instanceof TypeError || error instanceof ReferenceError) return 500;
  return 502;
}
