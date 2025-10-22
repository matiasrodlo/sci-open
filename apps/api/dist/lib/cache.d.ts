import NodeCache from 'node-cache';
import { cacheManager } from './cache-manager';
import { SearchCacheManager } from './search-cache-manager';
import { PaperCacheManager } from './paper-cache-manager';
import { APICacheManager } from './api-cache-manager';
import { CacheWarmer } from './cache-warmer';
declare const searchCacheManager: SearchCacheManager;
declare const paperCacheManager: PaperCacheManager;
declare const apiCacheManager: APICacheManager;
declare const cacheWarmer: CacheWarmer;
export declare function getSearchCache(): NodeCache;
export declare function getPaperCache(): NodeCache;
export declare function generateCacheKey(prefix: string, params: any): string;
export { cacheManager, searchCacheManager, paperCacheManager, apiCacheManager, cacheWarmer };
//# sourceMappingURL=cache.d.ts.map