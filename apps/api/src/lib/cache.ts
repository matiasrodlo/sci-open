import NodeCache from 'node-cache';
import { CacheManager, cacheManager } from './cache-manager';
import { SearchCacheManager } from './search-cache-manager';
import { PaperCacheManager } from './paper-cache-manager';
import { APICacheManager } from './api-cache-manager';
import { CacheWarmer } from './cache-warmer';

// Legacy cache instances for backward compatibility
const searchCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes
  checkperiod: 60 // Check for expired keys every minute
});

const paperCache = new NodeCache({ 
  stdTTL: 600, // 10 minutes
  checkperiod: 60
});

// Initialize advanced cache managers
const searchCacheManager = new SearchCacheManager(cacheManager);
const paperCacheManager = new PaperCacheManager(cacheManager);
const apiCacheManager = new APICacheManager(cacheManager);
const cacheWarmer = new CacheWarmer(cacheManager, searchCacheManager, paperCacheManager, apiCacheManager);

// Legacy functions for backward compatibility
export function getSearchCache() {
  return searchCache;
}

export function getPaperCache() {
  return paperCache;
}

export function generateCacheKey(prefix: string, params: any): string {
  const sortedParams = Object.keys(params)
    .sort()
    .reduce((result, key) => {
      result[key] = params[key];
      return result;
    }, {} as any);
  
  return `${prefix}:${JSON.stringify(sortedParams)}`;
}

// Export advanced cache managers
export {
  cacheManager,
  searchCacheManager,
  paperCacheManager,
  apiCacheManager,
  cacheWarmer
};
