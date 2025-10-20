'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { isDOI } from '@/lib/fetcher';

interface SearchFilters {
  sources: string[];
  yearRange: [number, number];
  exactPhrase: boolean;
}

interface SearchBarProps {
  initialQuery?: string;
}

export function SearchBar({ initialQuery = '' }: SearchBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({
    sources: ['arxiv', 'core', 'europepmc', 'ncbi', 'doaj'],
    yearRange: [2000, new Date().getFullYear()],
    exactPhrase: false,
  });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  // Read query from URL parameters on component mount
  useEffect(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) {
      setQuery(urlQuery);
    } else if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [searchParams, initialQuery]);

  const handleSearch = () => {
    if (!query.trim()) return;

    const urlParams = new URLSearchParams();
    urlParams.set('q', query.trim());
    
    if (filters.sources.length < 5) {
      urlParams.set('sources', filters.sources.join(','));
    }
    
    if (filters.yearRange[0] > 2000 || filters.yearRange[1] < new Date().getFullYear()) {
      urlParams.set('yearFrom', filters.yearRange[0].toString());
      urlParams.set('yearTo', filters.yearRange[1].toString());
    }
    
    if (filters.exactPhrase) {
      urlParams.set('exact', 'true');
    }

    router.push(`/results?${urlParams.toString()}`);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleSource = (source: string) => {
    setFilters(prev => ({
      ...prev,
      sources: prev.sources.includes(source)
        ? prev.sources.filter(s => s !== source)
        : [...prev.sources, source]
    }));
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="relative">
        <div className="flex gap-3">
          <div className="relative flex-1 group">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground h-5 w-5 group-focus-within:text-primary transition-colors" />
            <Input
              type="text"
              placeholder={isDOI(query) ? "DOI detected - Click search to find this paper" : "Search by title, keywords, or DOI..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyPress={handleKeyPress}
              className="pl-12 h-14 text-lg border-2 focus:border-primary/50 transition-all duration-200 shadow-lg hover:shadow-xl focus:shadow-xl"
              autoFocus
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-4 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          
          <Popover open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                size="icon" 
                className="h-14 w-14 border-2 hover:border-primary/50 transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                <Settings className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-6 shadow-2xl border-2" align="end">
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-primary" />
                  <h4 className="font-semibold text-lg">Advanced Search</h4>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-semibold mb-3 block text-foreground">Search Sources</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: 'arxiv', label: 'arXiv', color: 'bg-orange-100 text-orange-800' },
                        { id: 'core', label: 'CORE', color: 'bg-blue-100 text-blue-800' },
                        { id: 'europepmc', label: 'Europe PMC', color: 'bg-green-100 text-green-800' },
                        { id: 'ncbi', label: 'NCBI/PMC', color: 'bg-purple-100 text-purple-800' },
                        { id: 'doaj', label: 'DOAJ', color: 'bg-emerald-100 text-emerald-800' },
                      ].map((source) => (
                        <div key={source.id} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 transition-colors">
                          <Checkbox
                            id={source.id}
                            checked={filters.sources.includes(source.id)}
                            onCheckedChange={() => toggleSource(source.id)}
                            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                          />
                          <label
                            htmlFor={source.id}
                            className="text-sm font-medium leading-none cursor-pointer flex-1"
                          >
                            {source.label}
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-semibold block text-foreground">
                      Publication Year: {filters.yearRange[0]} - {filters.yearRange[1]}
                    </label>
                    <div className="px-2">
                      <Slider
                        value={filters.yearRange}
                        onValueChange={(value) => setFilters(prev => ({ ...prev, yearRange: value as [number, number] }))}
                        min={1990}
                        max={new Date().getFullYear()}
                        step={1}
                        className="w-full"
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>1990</span>
                      <span>{new Date().getFullYear()}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-3 p-3 rounded-lg border bg-muted/30">
                    <Checkbox
                      id="exact"
                      checked={filters.exactPhrase}
                      onCheckedChange={(checked) => setFilters(prev => ({ ...prev, exactPhrase: !!checked }))}
                      className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                    <label
                      htmlFor="exact"
                      className="text-sm font-medium leading-none cursor-pointer"
                    >
                      Exact phrase match
                    </label>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          
          <Button 
            onClick={handleSearch} 
            size="lg" 
            className="h-14 px-8 text-lg font-semibold shadow-lg hover:shadow-xl transition-all duration-200 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/90 hover:to-primary"
            disabled={!query.trim()}
          >
            <Search className="h-5 w-5 mr-2" />
            Search
          </Button>
        </div>
        
        {/* Search Suggestions */}
        {query.length > 2 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-background border border-border rounded-lg shadow-lg z-10 max-h-60 overflow-y-auto">
            <div className="p-3 text-sm text-muted-foreground border-b">
              Popular searches for "{query}"
            </div>
            <div className="p-2">
              {[
                `${query} machine learning`,
                `${query} artificial intelligence`,
                `${query} deep learning`,
                `${query} neural networks`
              ].map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => setQuery(suggestion)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-muted rounded-md transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
