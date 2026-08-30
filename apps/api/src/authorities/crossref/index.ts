import { capabilities } from './capabilities';
import { lookupDoi, type FetchOptions, type CrossrefPayload } from './fetch';
import { normalize, pickFullText, stripJats } from './normalize';

export { capabilities, lookupDoi, normalize, pickFullText, stripJats };
export type { FetchOptions, CrossrefPayload };

export type LookupOptions = FetchOptions;

export async function lookup(doi: string, options: LookupOptions) {
  return normalize(await lookupDoi(doi, options));
}
