'use client';

import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { SearchExamples } from '@/components/SearchExamples';
import { Search, FileText, Zap, Globe, Database, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function HomePage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center min-h-[70vh] space-y-12 px-4">
        <div className="text-center space-y-6 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Globe className="h-4 w-4" />
            Open Access Research Platform
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
            Discover Open Access
            <br />
            <span className="text-primary">Research Papers</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
            Search across <span className="font-semibold text-foreground">arXiv</span>, <span className="font-semibold text-foreground">CORE</span>, <span className="font-semibold text-foreground">Europe PMC</span>, and <span className="font-semibold text-foreground">NCBI</span> to find open-access papers with smart PDF resolution and comprehensive metadata.
          </p>
        </div>
        
        <div className="w-full max-w-4xl">
          <AdvancedSearchBar />
        </div>
        
        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-2xl w-full">
          <div className="text-center space-y-2">
            <div className="text-2xl font-bold text-primary">7+</div>
            <div className="text-sm text-muted-foreground">Sources</div>
          </div>
          <div className="text-center space-y-2">
            <div className="text-2xl font-bold text-primary">1M+</div>
            <div className="text-sm text-muted-foreground">Papers</div>
          </div>
          <div className="text-center space-y-2">
            <div className="text-2xl font-bold text-primary">100%</div>
            <div className="text-sm text-muted-foreground">Free Access</div>
          </div>
          <div className="text-center space-y-2">
            <div className="text-2xl font-bold text-primary">24/7</div>
            <div className="text-sm text-muted-foreground">Available</div>
          </div>
        </div>
      </div>
      
      {/* Features Section */}
      <div className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center space-y-4 mb-16">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
              Why Choose Our Platform?
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Built for researchers, by researchers. Experience the future of academic search.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="group text-center space-y-4 p-6 rounded-2xl border bg-card/50 hover:bg-card hover:shadow-lg transition-all duration-300">
              <div className="h-16 w-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-300">
                <Search className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold">Multi-Source Search</h3>
              <p className="text-muted-foreground leading-relaxed">
                Search across multiple open-access repositories simultaneously with intelligent query optimization and result aggregation.
              </p>
            </div>
            
            <div className="group text-center space-y-4 p-6 rounded-2xl border bg-card/50 hover:bg-card hover:shadow-lg transition-all duration-300">
              <div className="h-16 w-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-300">
                <FileText className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold">Smart PDF Access</h3>
              <p className="text-muted-foreground leading-relaxed">
                Automatic PDF resolution with intelligent fallback chains, ensuring you always get the best available version.
              </p>
            </div>
            
            <div className="group text-center space-y-4 p-6 rounded-2xl border bg-card/50 hover:bg-card hover:shadow-lg transition-all duration-300">
              <div className="h-16 w-16 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto group-hover:scale-110 transition-transform duration-300">
                <Zap className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-xl font-semibold">Lightning Fast</h3>
              <p className="text-muted-foreground leading-relaxed">
                Built with modern search backends and caching for speed and reliability. Get results in milliseconds.
              </p>
            </div>
          </div>
          
          {/* Additional Features */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-16">
            <div className="flex items-start space-x-4 p-6 rounded-xl border bg-card/30">
              <div className="h-12 w-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Database className="h-6 w-6 text-white" />
              </div>
              <div>
                <h4 className="font-semibold mb-2">Comprehensive Coverage</h4>
                <p className="text-sm text-muted-foreground">
                  Access papers from arXiv, CORE, Europe PMC, NCBI, bioRxiv, medRxiv, OpenAIRE, and PLOS with unified search.
                </p>
              </div>
            </div>
            
            <div className="flex items-start space-x-4 p-6 rounded-xl border bg-card/30">
              <div className="h-12 w-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <div>
                <h4 className="font-semibold mb-2">Privacy First</h4>
                <p className="text-sm text-muted-foreground">
                  Your searches are private. We don't track personal information and respect your academic freedom.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Search Examples Section */}
      <div className="py-20 px-4">
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