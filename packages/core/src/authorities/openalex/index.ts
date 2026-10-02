import { capabilities } from './capabilities';
import { lookupDoi, OpenAlexUnavailableError, type FetchOptions, type OpenAlexPayload } from './fetch';
import { normalize } from './normalize';

export { capabilities, lookupDoi, normalize, OpenAlexUnavailableError };
export type { FetchOptions, OpenAlexPayload };

export type LookupOptions = FetchOptions;

export async function lookup(doi: string, options: LookupOptions) {
  return normalize(await lookupDoi(doi, options));
}
