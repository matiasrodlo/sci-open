'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Plus, Minus, Settings, X, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SearchField {
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
  { value: 'authors', label: 'Authors' },
  { value: 'keywords', label: 'Keywords' },
  { value: 'doi', label: 'DOI' },
  { value: 'venue', label: 'Journal/Conference' },
  { value: 'publisher', label: 'Publisher' },
  { value: 'funding', label: 'Funding Agency' },
  { value: 'affiliation', label: 'Author Affiliation' },
  { value: 'language', label: 'Language' },
  { value: 'document_type', label: 'Document Type' }
];

const OPERATORS = [
  { value: 'AND', label: 'AND' },
  { value: 'OR', label: 'OR' },
  { value: 'NOT', label: 'NOT' },
  { value: 'NEAR', label: 'NEAR' },
  { value: 'SAME', label: 'SAME' }
];

const DOCUMENT_TYPES = [
  { value: 'article', label: 'Article' },
  { value: 'review', label: 'Review' },
  { value: 'preprint', label: 'Preprint' },
  { value: 'conference', label: 'Conference Paper' },
  { value: 'book', label: 'Book' },
  { value: 'chapter', label: 'Book Chapter' },
  { value: 'thesis', label: 'Thesis' },
  { value: 'patent', label: 'Patent' }
];

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' }
];

export function AdvancedSearchBar({ initialQuery = '', onSearch }: AdvancedSearchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [searchFields, setSearchFields] = useState<SearchField[]>([
    { id: '1', field: 'all', operator: 'AND', value: initialQuery }
  ]);
  const [filters, setFilters] = useState({
    yearFrom: '',
    yearTo: '',
    documentType: '',
    language: '',
    openAccess: true,
    hasPdf: true,
    sources: ['arxiv', 'core', 'europepmc', 'ncbi', 'openaire', 'doaj']
  });

  const addSearchField = () => {
    const newField: SearchField = {
      id: Date.now().toString(),
      field: 'all',
      operator: 'AND',
      value: ''
    };
    setSearchFields([...searchFields, newField]);
  };

  const removeSearchField = (id: string) => {
    if (searchFields.length > 1) {
      setSearchFields(searchFields.filter(field => field.id !== id));
    }
  };

  const updateSearchField = (id: string, updates: Partial<SearchField>) => {
    setSearchFields(searchFields.map(field => 
      field.id === id ? { ...field, ...updates } : field
    ));
  };

  const buildQuery = () => {
    return searchFields
      .filter(field => field.value.trim())
      .map((field, index) => {
        const prefix = index > 0 ? ` ${field.operator} ` : '';
        const fieldPrefix = field.field !== 'all' ? `${field.field}:"` : '';
        const fieldSuffix = field.field !== 'all' ? '"' : '';
        return `${prefix}${fieldPrefix}${field.value}${fieldSuffix}`;
      })
      .join('');
  };

  const handleSearch = () => {
    const query = buildQuery();
    if (!query.trim()) return;

    const searchFilters = {
      ...filters,
      yearFrom: filters.yearFrom ? parseInt(filters.yearFrom) : undefined,
      yearTo: filters.yearTo ? parseInt(filters.yearTo) : undefined,
      documentType: filters.documentType || undefined,
      language: filters.language || undefined,
      sources: filters.sources.length > 0 ? filters.sources : undefined
    };

    // Remove undefined values
    const cleanFilters = Object.fromEntries(
      Object.entries(searchFilters).filter(([_, value]) => value !== undefined)
    );

    if (onSearch) {
      onSearch(query, cleanFilters);
    } else {
      const params = new URLSearchParams();
      params.set('q', query);
      Object.entries(cleanFilters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          params.set(key, value.join(','));
        } else if (value !== undefined && value !== '') {
          params.set(key, value.toString());
        }
      });
      router.push(`/results?${params.toString()}`);
    }
    setIsAdvancedOpen(false);
  };

  const getFieldPlaceholder = (field: string) => {
    switch (field) {
      case 'title': return 'Enter title keywords...';
      case 'abstract': return 'Enter abstract keywords...';
      case 'authors': return 'Enter author names...';
      case 'keywords': return 'Enter subject keywords...';
      case 'doi': return 'Enter DOI (e.g., 10.1000/182)';
      case 'venue': return 'Enter journal or conference name...';
      case 'publisher': return 'Enter publisher name...';
      case 'funding': return 'Enter funding agency...';
      case 'affiliation': return 'Enter institution name...';
      case 'language': return 'Enter language...';
      case 'document_type': return 'Enter document type...';
      default: return 'Enter search terms...';
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Quick Search Bar */}
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search for papers, authors, or topics..."
            value={initialQuery}
            onChange={(e) => {
              if (searchFields.length === 1) {
                updateSearchField(searchFields[0].id, { value: e.target.value });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSearch();
              }
            }}
            className="pl-10 h-12 text-lg"
          />
        </div>
        <Popover open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="lg" className="h-12 px-6">
              <Settings className="h-4 w-4 mr-2" />
              Advanced
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[800px] p-0" align="end">
            <Card className="border-0 shadow-none">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg font-semibold">Advanced Search</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsAdvancedOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Build complex queries with multiple fields and operators
                </p>
              </CardHeader>
              <CardContent className="space-y-6">
                <Tabs defaultValue="search" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="search">Search Fields</TabsTrigger>
                    <TabsTrigger value="filters">Filters</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="search" className="space-y-4">
                    {/* Search Fields */}
                    <div className="space-y-3">
                      {searchFields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-2">
                          {index > 0 && (
                            <Select
                              value={field.operator}
                              onValueChange={(value) => updateSearchField(field.id, { operator: value })}
                            >
                              <SelectTrigger className="w-20">
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
                          
                          <Select
                            value={field.field}
                            onValueChange={(value) => updateSearchField(field.id, { field: value })}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SEARCH_FIELDS.map(f => (
                                <SelectItem key={f.value} value={f.value}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          
                          <Input
                            placeholder={getFieldPlaceholder(field.field)}
                            value={field.value}
                            onChange={(e) => updateSearchField(field.id, { value: e.target.value })}
                            className="flex-1"
                          />
                          
                          {searchFields.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeSearchField(field.id)}
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={addSearchField}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Search Field
                      </Button>
                    </div>

                    {/* Query Preview */}
                    {buildQuery() && (
                      <div className="p-3 bg-muted rounded-lg">
                        <div className="text-sm font-medium mb-1">Query Preview:</div>
                        <code className="text-sm text-muted-foreground break-all">
                          {buildQuery()}
                        </code>
                      </div>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="filters" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      {/* Year Range */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Publication Year</label>
                        <div className="flex gap-2">
                          <Input
                            placeholder="From"
                            value={filters.yearFrom}
                            onChange={(e) => setFilters({ ...filters, yearFrom: e.target.value })}
                            type="number"
                          />
                          <Input
                            placeholder="To"
                            value={filters.yearTo}
                            onChange={(e) => setFilters({ ...filters, yearTo: e.target.value })}
                            type="number"
                          />
                        </div>
                      </div>

                      {/* Document Type */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Document Type</label>
                        <Select
                          value={filters.documentType}
                          onValueChange={(value) => setFilters({ ...filters, documentType: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Any type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Any type</SelectItem>
                            {DOCUMENT_TYPES.map(type => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Language */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Language</label>
                        <Select
                          value={filters.language}
                          onValueChange={(value) => setFilters({ ...filters, language: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Any language" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Any language</SelectItem>
                            {LANGUAGES.map(lang => (
                              <SelectItem key={lang.value} value={lang.value}>
                                {lang.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Open Access Options */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Access Type</label>
                        <div className="space-y-2">
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={filters.openAccess}
                              onChange={(e) => setFilters({ ...filters, openAccess: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-sm">Open Access only</span>
                          </label>
                          <label className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              checked={filters.hasPdf}
                              onChange={(e) => setFilters({ ...filters, hasPdf: e.target.checked })}
                              className="rounded"
                            />
                            <span className="text-sm">Has PDF available</span>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Sources */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Data Sources</label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'arxiv', label: 'arXiv', color: 'bg-orange-100 text-orange-800' },
                          { value: 'core', label: 'CORE', color: 'bg-blue-100 text-blue-800' },
                          { value: 'europepmc', label: 'Europe PMC', color: 'bg-green-100 text-green-800' },
                          { value: 'ncbi', label: 'NCBI', color: 'bg-purple-100 text-purple-800' },
                          { value: 'openaire', label: 'OpenAIRE', color: 'bg-indigo-100 text-indigo-800' },
                          { value: 'doaj', label: 'DOAJ', color: 'bg-emerald-100 text-emerald-800' }
                        ].map(source => (
                          <Badge
                            key={source.value}
                            variant={filters.sources.includes(source.value) ? 'default' : 'outline'}
                            className={`cursor-pointer ${filters.sources.includes(source.value) ? source.color : ''}`}
                            onClick={() => {
                              const newSources = filters.sources.includes(source.value)
                                ? filters.sources.filter(s => s !== source.value)
                                : [...filters.sources, source.value];
                              setFilters({ ...filters, sources: newSources });
                            }}
                          >
                            {source.label}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Search Button */}
                <div className="flex justify-end gap-2 pt-4 border-t">
                  <Button variant="outline" onClick={() => setIsAdvancedOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSearch} className="min-w-24">
                    <Search className="h-4 w-4 mr-2" />
                    Search
                  </Button>
                </div>
              </CardContent>
            </Card>
          </PopoverContent>
        </Popover>
      </div>

      {/* Search Tips */}
      <div className="text-sm text-muted-foreground">
        <div className="flex items-center gap-1 mb-1">
          <HelpCircle className="h-3 w-3" />
          <span className="font-medium">Search Tips:</span>
        </div>
        <div className="space-y-1">
          <div>• Use quotes for exact phrases: "machine learning"</div>
          <div>• Use AND, OR, NOT operators for complex queries</div>
          <div>• Use field-specific searches for precise results</div>
        </div>
      </div>
    </div>
  );
}
