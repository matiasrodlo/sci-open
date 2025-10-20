'use client';

import { useState } from 'react';
import { Search, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SearchExample {
  title: string;
  description: string;
  query: string;
  filters?: Record<string, any>;
  category: 'basic' | 'advanced' | 'expert';
}

const SEARCH_EXAMPLES: SearchExample[] = [
  {
    title: 'Basic Keyword Search',
    description: 'Simple search for machine learning papers',
    query: 'machine learning',
    category: 'basic'
  },
  {
    title: 'Exact Phrase Search',
    description: 'Find papers with exact phrase',
    query: '"artificial intelligence"',
    category: 'basic'
  },
  {
    title: 'Author Search',
    description: 'Find papers by specific author',
    query: 'authors:"Geoffrey Hinton"',
    category: 'advanced'
  },
  {
    title: 'Title and Abstract Search',
    description: 'Search in both title and abstract',
    query: 'title:"deep learning" AND abstract:"neural networks"',
    category: 'advanced'
  },
  {
    title: 'Journal-Specific Search',
    description: 'Find papers from specific journal',
    query: 'venue:"Nature" AND title:"cancer"',
    category: 'advanced'
  },
  {
    title: 'DOI Lookup',
    description: 'Find specific paper by DOI',
    query: 'doi:"10.1038/nature12373"',
    category: 'basic'
  },
  {
    title: 'Complex Boolean Query',
    description: 'Advanced search with multiple conditions',
    query: '(title:"machine learning" OR title:"deep learning") AND authors:"Yann LeCun" AND year:2020..2024',
    category: 'expert'
  },
  {
    title: 'Funding Agency Search',
    description: 'Find papers funded by specific agency',
    query: 'funding:"National Science Foundation" AND title:"artificial intelligence"',
    category: 'expert'
  },
  {
    title: 'Language and Type Filter',
    description: 'Find English reviews from recent years',
    query: 'title:"climate change"',
    filters: {
      language: 'en',
      documentType: 'review',
      yearFrom: 2020
    },
    category: 'expert'
  },
  {
    title: 'Open Access Only',
    description: 'Find only open access papers with PDFs',
    query: 'title:"quantum computing"',
    filters: {
      openAccess: true,
      hasPdf: true,
      sources: ['arxiv', 'core', 'europepmc']
    },
    category: 'advanced'
  }
];

const CATEGORY_COLORS = {
  basic: 'bg-green-100 text-green-800',
  advanced: 'bg-blue-100 text-blue-800',
  expert: 'bg-purple-100 text-purple-800'
};

const CATEGORY_LABELS = {
  basic: 'Basic',
  advanced: 'Advanced',
  expert: 'Expert'
};

interface SearchExamplesProps {
  onSearchExample: (query: string, filters?: Record<string, any>) => void;
}

export function SearchExamples({ onSearchExample }: SearchExamplesProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const getCategoryExamples = (category: keyof typeof CATEGORY_COLORS) => {
    return SEARCH_EXAMPLES.filter(example => example.category === category);
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold tracking-tight">Search Examples</h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Learn how to use advanced search features with these examples. Click any example to try it out.
        </p>
      </div>

      <div className="grid gap-8">
        {(['basic', 'advanced', 'expert'] as const).map(category => (
          <div key={category} className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge className={CATEGORY_COLORS[category]}>
                {CATEGORY_LABELS[category]}
              </Badge>
              <h3 className="text-xl font-semibold capitalize">{category} Search</h3>
            </div>
            
            <div className="grid gap-4 md:grid-cols-2">
              {getCategoryExamples(category).map((example, index) => (
                <Card key={index} className="hover:shadow-md transition-shadow cursor-pointer group">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-base font-medium group-hover:text-primary transition-colors">
                          {example.title}
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {example.description}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          copyToClipboard(example.query, index);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        {copiedIndex === index ? (
                          <Check className="h-4 w-4 text-green-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent 
                    className="pt-0 cursor-pointer"
                    onClick={() => onSearchExample(example.query, example.filters)}
                  >
                    <div className="space-y-3">
                      <div className="p-3 bg-muted rounded-lg">
                        <code className="text-sm break-all">
                          {example.query}
                        </code>
                      </div>
                      
                      {example.filters && (
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(example.filters).map(([key, value]) => (
                            <Badge key={key} variant="outline" className="text-xs">
                              {key}: {Array.isArray(value) ? value.join(', ') : value.toString()}
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Search className="h-3 w-3" />
                        <span>Click to search</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="text-center space-y-4">
        <h3 className="text-xl font-semibold">Search Tips</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 text-sm text-muted-foreground">
          <div className="space-y-2">
            <h4 className="font-medium text-foreground">Boolean Operators</h4>
            <ul className="space-y-1">
              <li>• <code>AND</code> - Both terms must be present</li>
              <li>• <code>OR</code> - Either term can be present</li>
              <li>• <code>NOT</code> - Exclude terms</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-foreground">Field Search</h4>
            <ul className="space-y-1">
              <li>• <code>title:"phrase"</code> - Search in title</li>
              <li>• <code>authors:"name"</code> - Search by author</li>
              <li>• <code>venue:"journal"</code> - Search by journal</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-foreground">Advanced Features</h4>
            <ul className="space-y-1">
              <li>• Use quotes for exact phrases</li>
              <li>• Combine field searches with operators</li>
              <li>• Use filters for precise results</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
