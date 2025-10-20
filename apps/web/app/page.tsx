'use client';

import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';

export default function HomePage() {
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
      </div>

    </div>
  );
}