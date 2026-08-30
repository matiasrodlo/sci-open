import { cacheManager } from './cache-manager';
import { SearchCacheManager } from './search-cache-manager';
import { PaperCacheManager } from './paper-cache-manager';

/**
 * The cache the request path uses, wired once.
 *
 * Two bare `NodeCache` instances used to sit here as well, exported through
 * `getSearchCache` and `getPaperCache` alongside a `generateCacheKey` helper,
 * under a comment calling them "legacy ... for backward compatibility". All
 * three were imported by the route and never called by it, so they cached
 * nothing and were compatible with nothing. They are gone, and with them the
 * last use of `node-cache` — `MemoryCache` replaced it.
 */

export const searchCacheManager = new SearchCacheManager(cacheManager);
export const paperCacheManager = new PaperCacheManager(cacheManager);
export { cacheManager };
