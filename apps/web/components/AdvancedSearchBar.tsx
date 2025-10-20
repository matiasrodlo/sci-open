'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, X, HelpCircle, Calendar, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SearchRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface AdvancedSearchProps {
  initialQuery?: string;
  onSearch?: (query: string, filters: any) => void;
}

const SEARCH_FIELDS = [
  { value: 'all', label: 'All Fields' },
  { value: 'title', label: 'Title' },
  { value: 'abstract', label: 'Abstract' },
  { value: 'author', label: 'Author' },
  { value: 'keywords', label: 'Keywords/Topics' },
  { value: 'doi', label: 'DOI' },
  { value: 'venue', label: 'Publication Name' },
  { value: 'year', label: 'Year Published' },
];

const OPERATORS = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
  { value: 'NOT', label: 'NOT' },
];

const SOURCES = [
  { value: 'arxiv', label: 'arXiv' },
  { value: 'core', label: 'CORE' },
  { value: 'europepmc', label: 'Europe PMC' },
  { value: 'ncbi', label: 'NCBI/PMC' },
  { value: 'openaire', label: 'OpenAIRE' },
  { value: 'biorxiv', label: 'bioRxiv' },
  { value: 'medrxiv', label: 'medRxiv' },
  { value: 'doaj', label: 'DOAJ' },
];

export function AdvancedSearchBar({ initialQuery = '', onSearch }: AdvancedSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<'basic' | 'advanced'>('basic');
  const [basicQuery, setBasicQuery] = useState(initialQuery);
  const [searchRows, setSearchRows] = useState<SearchRow[]>([
    { id: '1', field: 'all', operator: 'AND', value: initialQuery }
  ]);
  const [yearFrom, setYearFrom] = useState('');
  const [yearTo, setYearTo] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>(
    SOURCES.map(s => s.value)
  );

  useEffect(() => {
    setBasicQuery(initialQuery);
    if (searchRows.length === 1) {
      setSearchRows([{ id: '1', field: 'all', operator: 'AND', value: initialQuery }]);
    }
  }, [initialQuery]);

  const addRow = () => {
    const newRow: SearchRow = {
      id: Date.now().toString(),
      field: 'all',
      operator: 'AND',
      value: ''
    };
    setSearchRows([...searchRows, newRow]);
  };

  const removeRow = (id: string) => {
    if (searchRows.length > 1) {
      setSearchRows(searchRows.filter(row => row.id !== id));
    }
  };

  const updateRow = (id: string, updates: Partial<SearchRow>) => {
    setSearchRows(searchRows.map(row => 
      row.id === id ? { ...row, ...updates } : row
    ));
  };

  const buildQuery = (): string => {
    if (mode === 'basic') {
      return basicQuery;
    }

    // Build advanced query
    return searchRows
      .filter(row => row.value.trim())
      .map((row, index) => {
        const value = row.value.trim();
        const fieldPrefix = row.field !== 'all' ? `${row.field}:` : '';
        const operator = index > 0 ? ` ${row.operator} ` : '';
        
        // Wrap in quotes if contains spaces
        const wrappedValue = value.includes(' ') && !value.startsWith('"') 
          ? `"${value}"` 
          : value;
        
        return `${operator}${fieldPrefix}${wrappedValue}`;
      })
      .join('');
  };

  const handleSearch = () => {
    const query = buildQuery();
    if (!query.trim()) return;

    const params = new URLSearchParams();
    params.set('q', query);
    
    if (selectedSources.length > 0 && selectedSources.length < SOURCES.length) {
      params.set('sources', selectedSources.join(','));
    }
    
    if (yearFrom) params.set('yearFrom', yearFrom);
    if (yearTo) params.set('yearTo', yearTo);

    if (onSearch) {
      onSearch(query, { sources: selectedSources, yearFrom, yearTo });
    } else {
      router.push(`/results?${params.toString()}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
  };

  const toggleSource = (source: string) => {
    setSelectedSources(prev => 
      prev.includes(source)
        ? prev.filter(s => s !== source)
        : [...prev, source]
    );
  };

  return (
    <div className="w-full space-y-4">
      {/* Mode Tabs */}
      <Tabs value={mode} onValueChange={(v) => setMode(v as 'basic' | 'advanced')} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="grid w-auto grid-cols-2">
            <TabsTrigger value="basic" className="px-6">Basic Search</TabsTrigger>
            <TabsTrigger value="advanced" className="px-6">Advanced Search</TabsTrigger>
          </TabsList>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <HelpCircle className="h-4 w-4" />
                Search Help
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96" align="end">
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Search Syntax</h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <strong>Boolean Operators:</strong>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li>• AND: Both terms must appear</li>
                      <li>• OR: Either term can appear</li>
                      <li>• NOT: Exclude term</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Phrase Search:</strong>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li>• Use quotes: "machine learning"</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Field Search:</strong>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li>• title:quantum</li>
                      <li>• author:"Einstein"</li>
                      <li>• year:2024</li>
                    </ul>
                  </div>
                  <div>
                    <strong>Examples:</strong>
                    <ul className="ml-4 mt-1 space-y-1 text-muted-foreground">
                      <li>• quantum AND computing</li>
                      <li>• "deep learning" OR "neural networks"</li>
                      <li>• title:CRISPR AND year:2024</li>
                    </ul>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <TabsContent value="basic" className="space-y-4 mt-0">
          {/* Basic Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              placeholder="Search for papers, authors, topics, or DOIs..."
              value={basicQuery}
              onChange={(e) => setBasicQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="pl-12 h-14 text-base"
            />
          </div>
        </TabsContent>

        <TabsContent value="advanced" className="space-y-4 mt-0">
          {/* Advanced Search Rows */}
          <div className="space-y-3">
            {searchRows.map((row, index) => (
              <div key={row.id} className="flex gap-2 items-start">
                {/* Operator (except first row) */}
                {index > 0 && (
                  <Select
                    value={row.operator}
                    onValueChange={(value) => updateRow(row.id, { operator: value })}
                  >
                    <SelectTrigger className="w-24 h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(op => (
                        <SelectItem key={op.value} value={op.value}>
                          {op.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* Field */}
                <Select
                  value={row.field}
                  onValueChange={(value) => updateRow(row.id, { field: value })}
                >
                  <SelectTrigger className={`${index === 0 ? 'w-48' : 'w-40'} h-11`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEARCH_FIELDS.map(field => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Value */}
                <Input
                  placeholder={`Enter ${SEARCH_FIELDS.find(f => f.field === row.field)?.label.toLowerCase() || 'search term'}...`}
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  onKeyDown={handleKeyDown}
                  className="flex-1 h-11"
                />

                {/* Remove button */}
                {searchRows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(row.id)}
                    className="h-11 w-11 shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}

            {/* Add Row Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={addRow}
              className="gap-2"
              disabled={searchRows.length >= 10}
            >
              <Plus className="h-4 w-4" />
              Add Row
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Filters Section - Only show in Advanced mode */}
      {mode === 'advanced' && (
        <div className="border-t pt-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Filter className="h-4 w-4" />
            REFINE RESULTS
          </div>

          {/* Year Range */}
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium min-w-24">Year:</span>
            <Input
              type="number"
              placeholder="From"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
              className="w-28 h-9"
              min="1900"
              max={new Date().getFullYear()}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="number"
              placeholder="To"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              className="w-28 h-9"
              min="1900"
              max={new Date().getFullYear()}
            />
          </div>

          {/* Sources */}
          <div className="flex items-start gap-3">
            <div className="flex items-center gap-2 min-w-24">
              <span className="text-sm font-medium">Sources:</span>
            </div>
            <div className="flex-1 flex flex-wrap gap-2">
              {SOURCES.map(source => (
                <button
                  key={source.value}
                  onClick={() => toggleSource(source.value)}
                  className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                    selectedSources.includes(source.value)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:border-foreground/50'
                  }`}
                >
                  {source.label}
                </button>
              ))}
            </div>
          </div>

          {/* Selected Filters Summary */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{selectedSources.length} of {SOURCES.length} sources selected</span>
            {(yearFrom || yearTo) && (
              <>
                <span>•</span>
                <span>
                  {yearFrom && yearTo ? `${yearFrom}-${yearTo}` : yearFrom ? `From ${yearFrom}` : `To ${yearTo}`}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Search Button */}
      <Button
        onClick={handleSearch}
        size="lg"
        className="w-full h-12 text-base font-semibold gap-2"
        disabled={mode === 'basic' ? !basicQuery.trim() : !buildQuery().trim()}
      >
        <Search className="h-5 w-5" />
        Search
      </Button>
    </div>
  );
}
