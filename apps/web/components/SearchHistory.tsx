'use client';

import { useState, useEffect } from 'react';
import { Clock, Trash2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SearchHistoryItem {
  id: string;
  query: string;
  filters?: Record<string, any>;
  timestamp: number;
  resultCount?: number;
}

interface SearchHistoryProps {
  onSearchHistoryItem: (query: string, filters?: Record<string, any>) => void;
  maxItems?: number;
}

export function SearchHistory({ onSearchHistoryItem, maxItems = 10 }: SearchHistoryProps) {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  useEffect(() => {
    // Load search history from localStorage
    const savedHistory = localStorage.getItem('searchHistory');
    if (savedHistory) {
      try {
        const parsedHistory = JSON.parse(savedHistory);
        setHistory(parsedHistory.slice(0, maxItems));
      } catch (error) {
        console.error('Failed to parse search history:', error);
      }
    }
  }, [maxItems]);

  const addToHistory = (query: string, filters?: Record<string, any>, resultCount?: number) => {
    const newItem: SearchHistoryItem = {
      id: Date.now().toString(),
      query,
      filters,
      timestamp: Date.now(),
      resultCount
    };

    const updatedHistory = [
      newItem,
      ...history.filter(item => item.query !== query) // Remove duplicates
    ].slice(0, maxItems);

    setHistory(updatedHistory);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
  };

  const removeFromHistory = (id: string) => {
    const updatedHistory = history.filter(item => item.id !== id);
    setHistory(updatedHistory);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('searchHistory');
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const getFilterBadges = (filters?: Record<string, any>) => {
    if (!filters) return null;

    return Object.entries(filters)
      .filter(([_, value]) => value !== undefined && value !== '')
      .map(([key, value]) => (
        <Badge key={key} variant="outline" className="text-xs">
          {key}: {Array.isArray(value) ? value.join(', ') : value.toString()}
        </Badge>
      ));
  };

  if (history.length === 0) {
    return null;
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Searches
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearHistory}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {history.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors group cursor-pointer"
            onClick={() => onSearchHistoryItem(item.query, item.filters)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <code className="text-sm font-medium truncate">
                  {item.query}
                </code>
                {item.resultCount && (
                  <Badge variant="secondary" className="text-xs">
                    {item.resultCount} results
                  </Badge>
                )}
              </div>
              
              {item.filters && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {getFilterBadges(item.filters)}
                </div>
              )}
              
              <div className="text-xs text-muted-foreground">
                {formatTimeAgo(item.timestamp)}
              </div>
            </div>
            
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onSearchHistoryItem(item.query, item.filters);
                }}
              >
                <Search className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromHistory(item.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Hook to use search history
export function useSearchHistory() {
  const addToHistory = (query: string, filters?: Record<string, any>, resultCount?: number) => {
    const savedHistory = localStorage.getItem('searchHistory');
    let history: SearchHistoryItem[] = [];
    
    if (savedHistory) {
      try {
        history = JSON.parse(savedHistory);
      } catch (error) {
        console.error('Failed to parse search history:', error);
      }
    }

    const newItem: SearchHistoryItem = {
      id: Date.now().toString(),
      query,
      filters,
      timestamp: Date.now(),
      resultCount
    };

    const updatedHistory = [
      newItem,
      ...history.filter(item => item.query !== query) // Remove duplicates
    ].slice(0, 10); // Keep last 10 searches

    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
  };

  return { addToHistory };
}
