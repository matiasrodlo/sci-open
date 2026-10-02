import { capabilities } from './capabilities';
import { lookupDoi, UnpaywallUnidentifiedError, type FetchOptions, type UnpaywallPayload } from './fetch';
import { normalize, pickFullText, pickRoute } from './normalize';

export { capabilities, lookupDoi, normalize, pickFullText, pickRoute, UnpaywallUnidentifiedError };
export type { FetchOptions, UnpaywallPayload };

export type LookupOptions = FetchOptions;

export async function lookup(doi: string, options: LookupOptions) {
  return normalize(await lookupDoi(doi, options));
}
