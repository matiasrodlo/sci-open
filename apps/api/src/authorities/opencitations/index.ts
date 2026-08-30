import { capabilities } from './capabilities';
import { lookupDoi, type FetchOptions, type OpenCitationsPayload } from './fetch';
import { normalize } from './normalize';

export { capabilities, lookupDoi, normalize };
export type { FetchOptions, OpenCitationsPayload };

export type LookupOptions = FetchOptions;

export async function lookup(doi: string, options: LookupOptions) {
  return normalize(await lookupDoi(doi, options));
}
