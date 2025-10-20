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
    <div className="w-full max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">Example Searches</h2>
        <p className="text-sm text-muted-foreground">
          Click any example to try it out
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {SEARCH_EXAMPLES.map((example, index) => (
          <button
            key={index}
            onClick={() => onSearchExample(example.query, example.filters)}
            className="group text-left p-4 border rounded-lg hover:border-foreground/20 transition-colors"
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium group-hover:text-primary transition-colors">
                  {example.title}
                </h3>
                <Badge variant="outline" className="text-xs shrink-0">
                  {example.category}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {example.description}
              </p>
              <code className="block text-xs bg-muted px-2 py-1 rounded break-all">
                {example.query}
              </code>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
