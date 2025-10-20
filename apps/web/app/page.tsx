'use client';

import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { SearchExamples } from '@/components/SearchExamples';
import { Search, FileText, Zap, Globe, Database, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center min-h-[75vh] space-y-10 px-6 py-20">
        <div className="text-center space-y-4 max-w-3xl">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            Open Access Research Explorer
          </h1>
              <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Advanced search across millions of open-access papers from arXiv, CORE, Europe PMC, NCBI, and more
              </p>
        </div>
        
        <div className="w-full max-w-3xl">
          <AdvancedSearchBar />
        </div>
        
        {/* Subtle Stats */}
        <div className="flex items-center gap-8 text-sm text-muted-foreground">
          <span>7+ sources</span>
          <span>·</span>
          <span>Millions of papers</span>
          <span>·</span>
          <span>100% free access</span>
        </div>
      </div>

      {/* Features Section */}
      <div className="border-t py-16 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="space-y-3">
              <h3 className="text-base font-semibold">Multi-Source Search</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Search across arXiv, CORE, Europe PMC, NCBI, bioRxiv, medRxiv, OpenAIRE, and PLOS simultaneously
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-base font-semibold">Smart PDF Access</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Automatic PDF resolution with intelligent fallback chains for the best available version
              </p>
            </div>
            <div className="space-y-3">
              <h3 className="text-base font-semibold">Advanced Search</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Boolean operators, field-specific queries, and comprehensive filtering options
              </p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Search Examples Section */}
      <div className="border-t py-16 px-6">
        <SearchExamples onSearchExample={(query, filters) => {
          const params = new URLSearchParams();
          params.set('q', query);
          if (filters) {
            Object.entries(filters).forEach(([key, value]) => {
              if (Array.isArray(value)) {
                params.set(key, value.join(','));
              } else if (value !== undefined && value !== '') {
                params.set(key, value.toString());
              }
            });
          }
          router.push(`/results?${params.toString()}`);
        }} />
      </div>
    </div>
  );
}