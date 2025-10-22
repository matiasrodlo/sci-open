'use client';

import { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';

interface CacheMetrics {
  hits: number;
  misses: number;
  l1Hits: number;
  l2Hits: number;
  l3Hits: number;
  avgResponseTime: number;
  cacheSize: number;
}

interface WarmingStats {
  popularQueries: number;
  trendingPapers: number;
  warmingInProgress: boolean;
}

interface CacheData {
  cache: CacheMetrics;
  warming: WarmingStats;
  timestamp: string;
}

export default function CacheDashboard() {
  const [cacheData, setCacheData] = useState<CacheData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCacheMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/cache/metrics');
      if (!response.ok) {
        throw new Error('Failed to fetch cache metrics');
      }
      const data = await response.json();
      setCacheData(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const startCacheWarming = async () => {
    try {
      const response = await fetch('/api/cache/warm', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to start cache warming');
      }
      await fetchCacheMetrics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const clearCache = async () => {
    try {
      const response = await fetch('/api/cache/clear', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to clear cache');
      }
      await fetchCacheMetrics();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  useEffect(() => {
    fetchCacheMetrics();
    const interval = setInterval(fetchCacheMetrics, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, []);

  if (loading && !cacheData) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p>Loading cache metrics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-red-800 font-semibold mb-2">Error</h3>
          <p className="text-red-600">{error}</p>
          <Button 
            onClick={fetchCacheMetrics}
            className="mt-3"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!cacheData) return null;

  const { cache, warming } = cacheData;
  const totalRequests = cache.hits + cache.misses;
  const hitRate = totalRequests > 0 ? (cache.hits / totalRequests) * 100 : 0;
  const l1HitRate = totalRequests > 0 ? (cache.l1Hits / totalRequests) * 100 : 0;
  const l2HitRate = totalRequests > 0 ? (cache.l2Hits / totalRequests) * 100 : 0;
  const l3HitRate = totalRequests > 0 ? (cache.l3Hits / totalRequests) * 100 : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Cache Performance Dashboard</h1>
        <div className="flex space-x-2">
          <Button onClick={fetchCacheMetrics} variant="outline">
            Refresh
          </Button>
          <Button onClick={startCacheWarming} disabled={warming.warmingInProgress}>
            {warming.warmingInProgress ? 'Warming...' : 'Start Warming'}
          </Button>
          <Button onClick={clearCache} variant="destructive">
            Clear Cache
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Cache Hit Rate</h3>
          <div className="text-2xl font-bold text-green-600">
            {hitRate.toFixed(1)}%
          </div>
          <p className="text-sm text-gray-500">
            {cache.hits} hits / {totalRequests} total
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Avg Response Time</h3>
          <div className="text-2xl font-bold text-blue-600">
            {cache.avgResponseTime.toFixed(0)}ms
          </div>
          <p className="text-sm text-gray-500">
            Average across all requests
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Cache Size</h3>
          <div className="text-2xl font-bold text-purple-600">
            {cache.cacheSize.toLocaleString()}
          </div>
          <p className="text-sm text-gray-500">
            Total cached items
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Cache Misses</h3>
          <div className="text-2xl font-bold text-orange-600">
            {cache.misses}
          </div>
          <p className="text-sm text-gray-500">
            Misses requiring API calls
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">L1 Cache (Memory)</h3>
          <div className="text-xl font-bold text-green-600">
            {l1HitRate.toFixed(1)}%
          </div>
          <p className="text-sm text-gray-500">
            {cache.l1Hits} hits - Fastest access
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">L2 Cache (Redis)</h3>
          <div className="text-xl font-bold text-blue-600">
            {l2HitRate.toFixed(1)}%
          </div>
          <p className="text-sm text-gray-500">
            {cache.l2Hits} hits - Fast access
          </p>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">L3 Cache (Database)</h3>
          <div className="text-xl font-bold text-purple-600">
            {l3HitRate.toFixed(1)}%
          </div>
          <p className="text-sm text-gray-500">
            {cache.l3Hits} hits - Persistent
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Cache Warming</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Popular Queries:</span>
              <span className="font-semibold">{warming.popularQueries}</span>
            </div>
            <div className="flex justify-between">
              <span>Trending Papers:</span>
              <span className="font-semibold">{warming.trendingPapers}</span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className={`font-semibold ${warming.warmingInProgress ? 'text-blue-600' : 'text-green-600'}`}>
                {warming.warmingInProgress ? 'In Progress' : 'Idle'}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-gray-700 mb-2">Performance Impact</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>API Calls Saved:</span>
              <span className="font-semibold text-green-600">
                {Math.round(cache.hits * 0.8)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span>Response Time Improvement:</span>
              <span className="font-semibold text-blue-600">
                {hitRate > 50 ? '75%+' : hitRate > 25 ? '50%+' : '25%+'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Last Updated:</span>
              <span className="font-semibold text-gray-600">
                {new Date(cacheData.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
