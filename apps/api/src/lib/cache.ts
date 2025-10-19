import NodeCache from 'node-cache';

// Create cache instances
const searchCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes
  checkperiod: 60 // Check for expired keys every minute
});

const paperCache = new NodeCache({ 
  stdTTL: 600, // 10 minutes
  checkperiod: 60
});

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
