import { describe, it, expect } from 'vitest';
import { AxiosError } from 'axios';
import { QueryParseError } from '@open-access-explorer/shared';
import { clientError, lookupErrorStatus } from '../client-error';
import { OpenAlexUnavailableError } from '../../providers/openalex/fetch';

/**
 * `/api/paper/:id` asks one provider for one record, and answered 500 however
 * that went. A provider being slow or down is not this service being broken,
 * and the status is the part a client or a monitor reads.
 */
describe('lookupErrorStatus', () => {
  it.each([
    ['axios timing out', new AxiosError('timeout of 15000ms exceeded', 'ECONNABORTED')],
    ['the socket timing out', new AxiosError('connect ETIMEDOUT', 'ETIMEDOUT')],
    ['a budget running out', Object.assign(new Error('exceeded the 15000ms budget'), { name: 'TimeoutError' })]
  ])('answers 504 for %s', (_case, error) => {
    expect(lookupErrorStatus(error)).toBe(504);
  });

  it.each([
    ['a provider answering with an error', new OpenAlexUnavailableError(503, 'Service Unavailable')],
    ['a provider refusing the connection', new AxiosError('connect ECONNREFUSED', 'ECONNREFUSED')],
    ['a provider saying something unreadable', new Error('arXiv 503')]
  ])('answers 502 for %s', (_case, error) => {
    expect(lookupErrorStatus(error)).toBe(502);
  });

  it('answers 400 for an id the query grammar cannot read', () => {
    expect(lookupErrorStatus(new QueryParseError('Unclosed quote', 0))).toBe(400);
  });

  it('keeps 500 for a mistake in this service\'s own code', () => {
    expect(lookupErrorStatus(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(500);
  });
});

describe('clientError', () => {
  it('does not repeat what an upstream failure said', () => {
    // A provider's message can carry its URL, a key in a query string, or a
    // response body; the request id is what finds it in the log.
    const body = clientError(new AxiosError('connect ECONNREFUSED 10.0.0.5:443', 'ECONNREFUSED'), 'req-1');
    expect(body).toEqual({ error: 'The request could not be completed', requestId: 'req-1' });
  });
});
