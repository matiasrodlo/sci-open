import { SearchBar } from '@/components/SearchBar';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Discover Open Access Research
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl">
          Search across arXiv, CORE, Europe PMC, and NCBI to find open-access papers
          with smart PDF resolution and comprehensive metadata.
        </p>
      </div>
      
      <SearchBar />
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl w-full mt-12">
        <div className="text-center space-y-2">
          <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto">
            <span className="text-2xl">🔍</span>
          </div>
          <h3 className="font-semibold">Multi-Source Search</h3>
          <p className="text-sm text-muted-foreground">
            Search across multiple open-access repositories simultaneously
          </p>
        </div>
        
        <div className="text-center space-y-2">
          <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto">
            <span className="text-2xl">📄</span>
          </div>
          <h3 className="font-semibold">Smart PDF Access</h3>
          <p className="text-sm text-muted-foreground">
            Automatic PDF resolution with intelligent fallback chains
          </p>
        </div>
        
        <div className="text-center space-y-2">
          <div className="h-12 w-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto">
            <span className="text-2xl">⚡</span>
          </div>
          <h3 className="font-semibold">Fast & Reliable</h3>
          <p className="text-sm text-muted-foreground">
            Built with modern search backends for speed and reliability
          </p>
        </div>
      </div>
    </div>
  );
}