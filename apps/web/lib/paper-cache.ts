import { OARecord } from '@open-access-explorer/shared';

/**
 * Client-side paper cache using sessionStorage
 * This allows us to view paper details without needing a full paper detail API
 */

const CACHE_KEY_PREFIX = 'paper_cache_';

export function cachePaper(paper: OARecord): void {
  if (typeof window === 'undefined') return;
  
  try {
    const key = `${CACHE_KEY_PREFIX}${paper.id}`;
    sessionStorage.setItem(key, JSON.stringify(paper));
  } catch (error) {
    console.error('Error caching paper:', error);
  }
}

export function getCachedPaper(id: string): OARecord | null {
  if (typeof window === 'undefined') return null;
  
  try {
    const key = `${CACHE_KEY_PREFIX}${id}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (error) {
    console.error('Error retrieving cached paper:', error);
  }
  
  return null;
}

export function clearPaperCache(): void {
  if (typeof window === 'undefined') return;
  
  try {
    const keys = Object.keys(sessionStorage);
    keys.forEach(key => {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (error) {
    console.error('Error clearing paper cache:', error);
  }
}

