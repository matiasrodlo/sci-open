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
export function clientError(error: unknown, requestId: string): { error: string; requestId: string } {
  if (error instanceof PdfProxyError) {
    return { error: error.message, requestId };
  }
  return { error: 'The request could not be completed', requestId };
}
