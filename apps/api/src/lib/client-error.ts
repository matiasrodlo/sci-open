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

  if (error instanceof PdfProxyError) {
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
  return error instanceof QueryParseError ? 400 : 500;
}
