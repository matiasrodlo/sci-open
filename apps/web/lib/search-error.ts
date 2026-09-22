/**
 * Why a search did not come back, in the only terms a reader can act on.
 *
 * `/results` caught everything and rendered one "Search Error" panel, so a
 * stale bookmark, a rate limit and a stopped API were indistinguishable — three
 * situations with three different next steps, told to try again in the one
 * wording that fits none of them.
 *
 * The API side of this distinction already exists and cannot help here.
 * `app/api/[...path]/route.ts` separates a 504 from a 502 carefully, but that
 * handler is on the *browser's* path to the API; a server-rendered search is
 * issued straight to `API_ORIGIN` by `lib/fetcher.ts` and never passes through
 * it. So the same taxonomy has to be recovered on this side, from what the
 * client throws.
 *
 * Deliberately not typed against axios. What the classifier needs is a shape —
 * a status the service answered with, or a code from the socket that never got
 * one — and reading it structurally keeps this module free of the HTTP client,
 * testable without mocking one, and correct if the caller is ever changed to
 * `fetch`.
 */

export type SearchFailure =
  /** The service refused this many searches this quickly. Waiting fixes it. */
  | 'rate-limited'
  /** The request was not one the service accepts. Retrying cannot fix it. */
  | 'bad-request'
  /**
   * The query text itself did not parse — an unbalanced bracket, an operator
   * with nothing after it, `PY=soon`.
   *
   * Split from `bad-request` because the two have nothing in common from where
   * the reader sits. A `bad-request` is an address they did not write and
   * cannot repair; this one is text they *did* write, they can see, and the
   * service can point at the character. Telling someone their search address is
   * invalid when they typed `TS=(crispr` sends them to start a new search
   * instead of closing the bracket.
   */
  | 'bad-query'
  /** The service took the search and did not finish it in time. */
  | 'timeout'
  /** Nothing answered at all — stopped, unreachable, or refusing connections. */
  | 'unavailable'
  /** It answered, and the answer was that it failed. Ours to fix, not theirs. */
  | 'server-error';

/** The parts of a thrown HTTP error this reads, whoever threw it. */
type HttpErrorish = {
  response?: { status?: number; data?: unknown } | undefined;
  code?: string | undefined;
};

/**
 * What the service said was wrong with the query, when that is what failed.
 *
 * `clientError` sends the parser's own message and the offset it stopped at,
 * because both are about text the caller wrote and neither describes anything
 * inside the service. Read structurally, like the rest of this module, so it
 * stays free of the HTTP client.
 */
export type QueryProblem = {
  message: string;
  /** Offset into the query text, where the service reported one. */
  position?: number;
};

export function queryProblem(error: unknown): QueryProblem | undefined {
  const { response } = (error ?? {}) as HttpErrorish;
  if (response?.status !== 400) return undefined;

  const body = response.data as { error?: unknown; position?: unknown } | undefined;
  if (typeof body?.error !== 'string' || !body.error.trim()) return undefined;

  return {
    message: body.error,
    ...(typeof body.position === 'number' ? { position: body.position } : {})
  };
}

/**
 * Socket-level failures that mean "no answer arrived", split by whether the
 * wait was the problem.
 *
 * `ECONNABORTED` is axios's own code for a client-side timeout rather than a
 * kernel errno, and it belongs with the timeouts for the same reason `ETIMEDOUT`
 * does: the reader's next step is to wait or narrow, not to conclude the
 * service is down.
 */
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE'
]);

/**
 * A thrown error -> what to tell the reader.
 *
 * A status decides it whenever there is one: a response means the service was
 * reached and said something, which is a stronger fact than any code alongside
 * it. Only when nothing answered does the code get a say.
 *
 * The fallback is `server-error` rather than `unavailable`, and the difference
 * matters. A `TypeError` from our own code has no response and no socket code,
 * and calling that "the service is unreachable" would send the reader to wait
 * for a recovery that is not coming. Unrecognised means ours until shown
 * otherwise.
 */
export function classifySearchError(error: unknown): SearchFailure {
  const { response, code } = (error ?? {}) as HttpErrorish;
  const status = response?.status;

  if (typeof status === 'number') {
    if (status === 429) return 'rate-limited';
    // A 400 carrying a parser message is the query, not the address. Both are
    // 400s and only the body tells them apart, which is why this asks.
    if (status === 400 && queryProblem(error)) return 'bad-query';
    // 413 and 422 join 400 because they are the same event to a reader: the
    // request as written is not one the service will take. `searchBodySchema`
    // caps `q` at 500 characters and every string array at 50 items of 200, so
    // a hand-edited or long-lived URL reaches this honestly.
    if (status === 400 || status === 413 || status === 422) return 'bad-request';
    if (status === 408 || status === 504) return 'timeout';
    if (status === 502 || status === 503) return 'unavailable';
    return 'server-error';
  }

  if (code) {
    if (TIMEOUT_CODES.has(code)) return 'timeout';
    if (UNREACHABLE_CODES.has(code)) return 'unavailable';
  }

  return 'server-error';
}

/**
 * Whether trying the same thing again could plausibly work.
 *
 * `bad-request` and `bad-query` are both settled — one asks for something the
 * service will never accept, the other is text that will not parse this time or
 * any other — so a reload spends a request to be told so a second time. The
 * copy in `SearchError` keys off this rather than repeating the list.
 */
export function isRetryable(failure: SearchFailure): boolean {
  return failure !== 'bad-request' && failure !== 'bad-query';
}
