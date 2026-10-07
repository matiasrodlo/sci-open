import { getPooledClient } from './http-client-factory';

/**
 * Whether any registration agency holds this DOI — the Handle System's own
 * answer, which covers Crossref, DataCite, mEDRA, JaLC and the rest alike.
 * Asking Crossref alone would call every DataCite DOI unregistered, Zenodo's
 * and arXiv's own `10.48550/…` included.
 *
 * The Handle API answers `{"responseCode":1}` (HTTP 200) for a registered DOI
 * and `{"responseCode":100}` (HTTP 404) for one never minted. `undefined` when
 * the registry could not be asked or said something else: that is no evidence
 * either way. An aborted `signal` rejects with its reason instead: a caller
 * that has gone is not told "no evidence".
 */
export async function doiRegistered(
  doi: string,
  options: { userAgent: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<boolean | undefined> {
  const client = getPooledClient('https://doi.org');
  // The slashes stay: they separate the handle's parts, they are not in one.
  const path = `/api/handles/${doi.split('/').map(encodeURIComponent).join('/')}`;
  try {
    const response = await client.get<{ responseCode?: number }>(path, {
      timeout: options.timeoutMs ?? 5000,
      headers: { Accept: 'application/json', 'User-Agent': options.userAgent },
      validateStatus: () => true,
      ...(options.signal ? { signal: options.signal } : {})
    });
    if (response.data?.responseCode === 1) return true;
    if (response.data?.responseCode === 100) return false;
    return undefined;
  } catch {
    options.signal?.throwIfAborted();
    return undefined;
  }
}
