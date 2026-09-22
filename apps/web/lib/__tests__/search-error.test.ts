import { describe, it, expect } from 'vitest';
import { classifySearchError, isRetryable, queryProblem } from '../search-error';

/**
 * `/results` caught every failure and rendered one panel, so the three
 * situations a reader can actually respond to differently — wait, start over,
 * it is not you — arrived as the same sentence.
 *
 * These pin the split rather than the wording. The copy is a product decision
 * and will move; which bucket a failure lands in is the part that would
 * silently regress, because a wrong bucket still renders a plausible-looking
 * panel.
 */

/** What axios throws when the service answered. */
const answered = (status: number) => ({ response: { status }, code: 'ERR_BAD_REQUEST' });

/** What it throws when nothing answered. */
const socket = (code: string) => ({ code });

describe('classifySearchError', () => {
  it('separates a rate limit from a failure', () => {
    expect(classifySearchError(answered(429))).toBe('rate-limited');
  });

  it('treats every rejected-request status as one thing', () => {
    // Three statuses, one reader-facing fact: the request as written will not
    // be accepted, so a retry spends a request to be told so again.
    expect(classifySearchError(answered(400))).toBe('bad-request');
    expect(classifySearchError(answered(413))).toBe('bad-request');
    expect(classifySearchError(answered(422))).toBe('bad-request');
  });

  it('separates an answer that failed from no answer at all', () => {
    expect(classifySearchError(answered(500))).toBe('server-error');
    expect(classifySearchError(answered(502))).toBe('unavailable');
    expect(classifySearchError(answered(503))).toBe('unavailable');
  });

  it('reads a gateway timeout as a timeout rather than an outage', () => {
    expect(classifySearchError(answered(504))).toBe('timeout');
    expect(classifySearchError(answered(408))).toBe('timeout');
  });

  it('prefers the status over the code when the service answered', () => {
    // A response means the service was reached and said something, which
    // outranks whatever code the client attached alongside it.
    expect(classifySearchError({ response: { status: 429 }, code: 'ECONNREFUSED' }))
      .toBe('rate-limited');
  });

  describe('when nothing answered', () => {
    it('reads a refused or unresolvable connection as unavailable', () => {
      for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH']) {
        expect(classifySearchError(socket(code))).toBe('unavailable');
      }
    });

    it('reads a client-side timeout as a timeout', () => {
      // `ECONNABORTED` is axios's own code rather than an errno, and it belongs
      // with the timeouts: the reader's next step is to wait or narrow, not to
      // conclude the service is down.
      expect(classifySearchError(socket('ECONNABORTED'))).toBe('timeout');
      expect(classifySearchError(socket('ETIMEDOUT'))).toBe('timeout');
    });
  });

  /**
   * The fallback is ours, not theirs. A bug in this app has no response and no
   * socket code, and calling it "the service is unreachable" would send the
   * reader off to wait for a recovery that is not coming.
   */
  it('blames itself for anything it does not recognise', () => {
    expect(classifySearchError(new TypeError('undefined is not a function'))).toBe('server-error');
    expect(classifySearchError(socket('ESOMETHINGNEW'))).toBe('server-error');
    expect(classifySearchError(undefined)).toBe('server-error');
    expect(classifySearchError(null)).toBe('server-error');
    expect(classifySearchError('a string')).toBe('server-error');
  });
});

/**
 * A query the grammar rejected is also a 400, and only the body tells it apart
 * from a malformed address. The difference is the whole point: one is text the
 * reader wrote and can fix, the other is an address they did not.
 */
describe('a query that would not parse', () => {
  const rejected = (body: unknown) => ({ response: { status: 400, data: body } });

  it('is its own failure, not a bad address', () => {
    expect(classifySearchError(rejected({ error: 'Unbalanced (', position: 3 }))).toBe('bad-query');
  });

  it('carries the parser message and position through', () => {
    expect(queryProblem(rejected({ error: 'Unbalanced (', position: 3 })))
      .toEqual({ message: 'Unbalanced (', position: 3 });
  });

  it('carries a message with no position', () => {
    expect(queryProblem(rejected({ error: 'Empty query' }))).toEqual({ message: 'Empty query' });
  });

  it('stays a bad address when the 400 says nothing about a query', () => {
    // The generic body `clientError` sends for anything that is not about the
    // request. Nothing here is worth showing as a query problem.
    expect(classifySearchError(answered(400))).toBe('bad-request');
    expect(queryProblem(rejected({ error: '   ' }))).toBeUndefined();
    expect(queryProblem(rejected(undefined))).toBeUndefined();
  });

  it('is not read from any status other than 400', () => {
    expect(queryProblem({ response: { status: 500, data: { error: 'Unbalanced (' } } })).toBeUndefined();
  });
});

describe('isRetryable', () => {
  it('calls a rejected request and an unparseable query hopeless', () => {
    expect(isRetryable('bad-request')).toBe(false);
    // Text that will not parse this time will not parse the next time either.
    expect(isRetryable('bad-query')).toBe(false);

    for (const failure of ['rate-limited', 'timeout', 'unavailable', 'server-error'] as const) {
      expect(isRetryable(failure)).toBe(true);
    }
  });
});
