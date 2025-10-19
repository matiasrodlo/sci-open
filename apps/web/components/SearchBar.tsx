'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    sources: ['arxiv', 'core', 'europepmc', 'ncbi'],
    yearRange: [2000, new Date().getFullYear()],
    exactPhrase: false,
  });
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const handleSearch = () => {
    if (!query.trim()) return;

    const searchParams = new URLSearchParams();
    searchParams.set('q', query.trim());
    
    if (filters.sources.length < 4) {
      searchParams.set('sources', filters.sources.join(','));
    }
    
    if (filters.yearRange[0] > 2000 || filters.yearRange[1] < new Date().getFullYear()) {
      searchParams.set('yearFrom', filters.yearRange[0].toString());
      searchParams.set('yearTo', filters.yearRange[1].toString());
    }
    
    if (filters.exactPhrase) {
      searchParams.set('exact', 'true');
    }

    router.push(`/results?${searchParams.toString()}`);
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
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            type="text"
            placeholder={isDOI(query) ? "DOI detected" : "Search by title, keywords, or DOI..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            className="pl-10 h-12 text-lg"
            autoFocus
          />
        </div>
        <Popover open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="h-12 w-12">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <div className="space-y-4">
              <h4 className="font-medium">Advanced Search</h4>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Sources</label>
                <div className="space-y-2">
                  {[
                    { id: 'arxiv', label: 'arXiv' },
                    { id: 'core', label: 'CORE' },
                    { id: 'europepmc', label: 'Europe PMC' },
                    { id: 'ncbi', label: 'NCBI/PMC' },
                  ].map((source) => (
                    <div key={source.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={source.id}
                        checked={filters.sources.includes(source.id)}
                        onCheckedChange={() => toggleSource(source.id)}
                      />
                      <label
                        htmlFor={source.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {source.label}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">
                  Year Range: {filters.yearRange[0]} - {filters.yearRange[1]}
                </label>
                <Slider
                  value={filters.yearRange}
                  onValueChange={(value) => setFilters(prev => ({ ...prev, yearRange: value as [number, number] }))}
                  min={1990}
                  max={new Date().getFullYear()}
                  step={1}
                  className="w-full"
                />
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="exact"
                  checked={filters.exactPhrase}
                  onCheckedChange={(checked) => setFilters(prev => ({ ...prev, exactPhrase: !!checked }))}
                />
                <label
                  htmlFor="exact"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Exact phrase match
                </label>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button onClick={handleSearch} size="lg" className="h-12 px-8">
          Search
        </Button>
      </div>
    </div>
  );
}
