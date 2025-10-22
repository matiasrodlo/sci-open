# Development Guide

This guide covers setting up the Open Access Explorer development environment, contributing guidelines, and project structure.

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** (LTS recommended)
- **pnpm** (preferred) or npm
- **Docker** (for local search backends)
- **Git** for version control

### Installation
```bash
# Clone the repository
git clone <repository-url>
cd sci-open

# Install dependencies
pnpm install

# Copy environment file
cp env.example .env

# Start development environment
pnpm dev
```

Visit `http://localhost:3000` to see the application.

## 🏗️ Project Structure

```
sci-open/
├── apps/                    # Applications
│   ├── web/                # Next.js frontend
│   │   ├── app/            # App Router pages
│   │   ├── components/     # React components
│   │   ├── lib/           # Utilities and helpers
│   │   └── package.json    # Frontend dependencies
│   └── api/                # Fastify API server
│       ├── src/            # Source code
│       │   ├── lib/       # Core business logic
│       │   └── sources/   # Data source connectors
│       └── package.json    # API dependencies
├── packages/               # Shared packages
│   ├── shared/            # Shared TypeScript types
│   └── search/            # Search backend adapters
├── docs/                  # Documentation
├── docker-compose.yml      # Local development setup
└── package.json           # Root package configuration
```

## 🔧 Development Environment

### Environment Configuration
```bash
# .env file
# Frontend
NEXT_PUBLIC_API_BASE=http://localhost:4000
NEXT_PUBLIC_SEARCH_BACKEND=typesense

# API
PORT=4000
NODE_ENV=development

# Search Backend
SEARCH_BACKEND=typesense
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz

# Optional: Enhanced APIs
CORE_API_KEY=your_core_api_key
NCBI_API_KEY=your_ncbi_api_key
UNPAYWALL_EMAIL=your-email@example.com
```

### Local Search Backend Setup

#### Option 1: Typesense (Recommended)
```bash
# Start Typesense with Docker
docker run -p 8108:8108 -v/tmp/typesense-data:/data \
  typesense/typesense:0.25.1 \
  --data-dir /data --api-key=xyz --listen-port 8108 --enable-cors
```

#### Option 2: Meilisearch
```bash
# Start Meilisearch with Docker
docker run -p 7700:7700 -v/tmp/meilisearch-data:/meili_data \
  getmeili/meilisearch:v1.5
```

#### Option 3: Docker Compose (All Services)
```bash
# Start all services
docker-compose up -d
```

### Development Scripts
```bash
# Start all services
pnpm dev

# Start specific services
pnpm dev:web    # Frontend only
pnpm dev:api    # API only

# Build all packages
pnpm build

# Run linting
pnpm lint

# Seed search index
pnpm seed

# Clean build artifacts
pnpm clean
```

## 🎯 Development Workflow

### 1. Feature Development
```bash
# Create feature branch
git checkout -b feature/new-data-source

# Make changes
# ... implement feature ...

# Test changes
pnpm test
pnpm lint

# Commit changes
git add .
git commit -m "feat: add new data source connector"

# Push and create PR
git push origin feature/new-data-source
```

### 2. Code Quality
```bash
# Run linting
pnpm lint

# Fix linting issues
pnpm lint:fix

# Type checking
pnpm type-check

# Run tests
pnpm test
```

### 3. Testing
```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm test --filter=api
pnpm test --filter=web

# Run tests in watch mode
pnpm test:watch
```

## 🧩 Adding New Data Sources

### Step 1: Create Source Connector
```typescript
// apps/api/src/sources/new-source.ts
import { SourceConnector } from '../lib/types';

export class NewSourceConnector implements SourceConnector {
  name = 'new-source';
  
  async search(params: SearchParams): Promise<OARecord[]> {
    // Implement search logic
    const response = await fetch(`${this.baseUrl}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        query: params.q,
        limit: params.pageSize,
        offset: (params.page - 1) * params.pageSize
      })
    });
    
    const data = await response.json();
    return this.normalizeResults(data.results);
  }
  
  private normalizeResults(results: any[]): OARecord[] {
    return results.map(result => ({
      id: `${this.name}:${result.id}`,
      title: result.title,
      authors: result.authors || [],
      year: result.year,
      venue: result.journal,
      abstract: result.abstract,
      source: this.name,
      sourceId: result.id,
      doi: result.doi,
      bestPdfUrl: result.pdf_url,
      landingPage: result.url,
      topics: result.keywords || [],
      language: result.language,
      createdAt: new Date().toISOString()
    }));
  }
}
```

### Step 2: Register Source
```typescript
// apps/api/src/index.ts
import { NewSourceConnector } from './sources/new-source';

// Add to sources array
const sources = [
  new ArxivConnector(),
  new CoreConnector(),
  new EuropePMCConnector(),
  new NCBIConnector(),
  new NewSourceConnector() // Add new source
];
```

### Step 3: Update Frontend
```typescript
// apps/web/lib/types.ts
export type DataSource = 
  | 'arxiv' 
  | 'core' 
  | 'europepmc' 
  | 'ncbi' 
  | 'new-source'; // Add new source
```

### Step 4: Test Integration
```bash
# Test new source
curl -X POST http://localhost:4000/api/search \
  -H "Content-Type: application/json" \
  -d '{"q": "test", "filters": {"sources": ["new-source"]}}'
```

## 🔍 Adding New Search Backends

### Step 1: Create Search Adapter
```typescript
// packages/search/src/new-backend.ts
import { SearchAdapter } from './types';

export class NewBackendAdapter implements SearchAdapter {
  constructor(private config: NewBackendConfig) {}
  
  async search(params: SearchParams): Promise<SearchResponse> {
    const response = await this.client.search({
      index: this.config.index,
      body: {
        query: {
          multi_match: {
            query: params.q,
            fields: ['title', 'authors', 'abstract', 'topics']
          }
        },
        from: (params.page - 1) * params.pageSize,
        size: params.pageSize,
        sort: this.buildSort(params.sort)
      }
    });
    
    return this.normalizeResponse(response);
  }
  
  async index(documents: OARecord[]): Promise<void> {
    const body = documents.flatMap(doc => [
      { index: { _index: this.config.index, _id: doc.id } },
      doc
    ]);
    
    await this.client.bulk({ body });
  }
  
  private buildSort(sort?: string): any {
    switch (sort) {
      case 'date': return [{ createdAt: { order: 'desc' } }];
      case 'relevance': return [{ _score: { order: 'desc' } }];
      default: return [{ _score: { order: 'desc' } }];
    }
  }
}
```

### Step 2: Register Adapter
```typescript
// packages/search/src/index.ts
export { NewBackendAdapter } from './new-backend';

// Update factory function
export function createSearchAdapter(type: string, config: any): SearchAdapter {
  switch (type) {
    case 'typesense': return new TypesenseAdapter(config);
    case 'meili': return new MeilisearchAdapter(config);
    case 'algolia': return new AlgoliaAdapter(config);
    case 'new-backend': return new NewBackendAdapter(config);
    default: throw new Error(`Unknown search backend: ${type}`);
  }
}
```

### Step 3: Update Configuration
```typescript
// apps/api/src/lib/search-pipeline.ts
const searchBackend = createSearchAdapter(
  process.env.SEARCH_BACKEND || 'typesense',
  {
    // New backend configuration
    host: process.env.NEW_BACKEND_HOST,
    apiKey: process.env.NEW_BACKEND_API_KEY,
    index: process.env.NEW_BACKEND_INDEX
  }
);
```

## 🧪 Testing

### Unit Tests
```typescript
// apps/api/src/sources/__tests__/arxiv.test.ts
import { ArxivConnector } from '../arxiv';

describe('ArxivConnector', () => {
  let connector: ArxivConnector;
  
  beforeEach(() => {
    connector = new ArxivConnector();
  });
  
  it('should search arXiv successfully', async () => {
    const results = await connector.search({
      q: 'machine learning',
      page: 1,
      pageSize: 10
    });
    
    expect(results).toBeDefined();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('title');
  });
  
  it('should handle search errors gracefully', async () => {
    // Mock network error
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'));
    
    const results = await connector.search({
      q: 'test',
      page: 1,
      pageSize: 10
    });
    
    expect(results).toEqual([]);
  });
});
```

### Integration Tests
```typescript
// apps/api/src/__tests__/search.test.ts
import { createServer } from '../index';

describe('Search API', () => {
  let server: FastifyInstance;
  
  beforeAll(async () => {
    server = await createServer();
  });
  
  afterAll(async () => {
    await server.close();
  });
  
  it('should search papers successfully', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        q: 'machine learning',
        pageSize: 10
      }
    });
    
    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.hits).toBeDefined();
    expect(data.total).toBeGreaterThan(0);
  });
});
```

### Frontend Tests
```typescript
// apps/web/components/__tests__/SearchBar.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SearchBar } from '../SearchBar';

describe('SearchBar', () => {
  it('should render search input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });
  
  it('should handle search submission', () => {
    const mockOnSearch = jest.fn();
    render(<SearchBar onSearch={mockOnSearch} />);
    
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'test query' } });
    fireEvent.submit(input);
    
    expect(mockOnSearch).toHaveBeenCalledWith('test query');
  });
});
```

## 📝 Code Style and Guidelines

### TypeScript Guidelines
```typescript
// Use strict typing
interface SearchParams {
  q: string;
  page?: number;
  pageSize?: number;
  filters?: SearchFilters;
}

// Use enums for constants
enum DataSource {
  ARXIV = 'arxiv',
  CORE = 'core',
  EUROPE_PMC = 'europepmc',
  NCBI = 'ncbi'
}

// Use type guards
function isOARecord(obj: any): obj is OARecord {
  return obj && typeof obj.id === 'string' && typeof obj.title === 'string';
}
```

### React Guidelines
```typescript
// Use functional components with hooks
export function SearchBar({ initialQuery = '' }: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [loading, setLoading] = useState(false);
  
  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      await searchPapers({ q: query });
    } finally {
      setLoading(false);
    }
  }, [query]);
  
  return (
    <div className="search-bar">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search papers..."
      />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? 'Searching...' : 'Search'}
      </button>
    </div>
  );
}
```

### Error Handling
```typescript
// Use try-catch for async operations
async function searchPapers(params: SearchParams): Promise<SearchResponse> {
  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    
    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

// Use error boundaries for React components
class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }
  
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true };
  }
  
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }
  
  render() {
    if (this.state.hasError) {
      return <div>Something went wrong.</div>;
    }
    
    return this.props.children;
  }
}
```

## 🔧 Debugging

### API Debugging
```typescript
// Enable debug logging
const debug = require('debug')('api:search');

app.post('/api/search', async (request, reply) => {
  debug('Search request:', request.body);
  
  try {
    const results = await searchPipeline.search(request.body);
    debug('Search results:', { total: results.total, took: results.took });
    return results;
  } catch (error) {
    debug('Search error:', error);
    throw error;
  }
});
```

### Frontend Debugging
```typescript
// Use React DevTools
import { useState, useEffect } from 'react';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  
  useEffect(() => {
    console.log('Search query changed:', query);
  }, [query]);
  
  useEffect(() => {
    console.log('Results updated:', results);
  }, [results]);
  
  return (
    // Component JSX
  );
}
```

### Network Debugging
```bash
# Check API health
curl http://localhost:4000/health

# Test search endpoint
curl -X POST http://localhost:4000/api/search \
  -H "Content-Type: application/json" \
  -d '{"q": "machine learning", "pageSize": 5}'

# Check search backend
curl http://localhost:4000/debug/sources
```

## 📦 Package Management

### Adding Dependencies
```bash
# Add to specific package
pnpm add axios --filter=api
pnpm add react-query --filter=web

# Add to root (dev dependencies)
pnpm add -D typescript @types/node

# Add to workspace
pnpm add -w some-global-package
```

### Updating Dependencies
```bash
# Update all dependencies
pnpm update

# Update specific package
pnpm update axios --filter=api

# Check for outdated packages
pnpm outdated
```

### Lock File Management
```bash
# Install from lock file
pnpm install --frozen-lockfile

# Update lock file
pnpm install

# Clean install
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

## 🚀 Performance Optimization

### Frontend Optimization
```typescript
// Use React.memo for expensive components
export const ResultCard = React.memo(({ paper }: { paper: OARecord }) => {
  return (
    <div className="result-card">
      <h3>{paper.title}</h3>
      <p>{paper.abstract}</p>
    </div>
  );
});

// Use useMemo for expensive calculations
const sortedResults = useMemo(() => {
  return results.sort((a, b) => b.year - a.year);
}, [results]);

// Use useCallback for event handlers
const handleSearch = useCallback((query: string) => {
  setQuery(query);
  performSearch(query);
}, []);
```

### API Optimization
```typescript
// Use connection pooling
const httpAgent = new Agent({
  keepAlive: true,
  maxSockets: 10
});

// Implement caching
const cache = new Map();

async function searchWithCache(params: SearchParams): Promise<SearchResponse> {
  const key = JSON.stringify(params);
  
  if (cache.has(key)) {
    return cache.get(key);
  }
  
  const result = await searchPipeline.search(params);
  cache.set(key, result);
  
  // Clear cache after 5 minutes
  setTimeout(() => cache.delete(key), 300000);
  
  return result;
}
```

## 📋 Contributing Guidelines

### Pull Request Process
1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Add** tests for new functionality
5. **Run** the test suite
6. **Update** documentation if needed
7. **Submit** a pull request

### Commit Message Format
```
type(scope): description

feat(api): add new data source connector
fix(web): resolve search input validation
docs(readme): update installation instructions
test(api): add unit tests for search pipeline
```

### Code Review Checklist
- [ ] Code follows project style guidelines
- [ ] Tests pass and new tests are added
- [ ] Documentation is updated
- [ ] No breaking changes (or properly documented)
- [ ] Performance implications considered
- [ ] Security implications reviewed

## 🐛 Troubleshooting

### Common Issues

#### Build Failures
```bash
# Clear all caches
pnpm clean
rm -rf node_modules
pnpm install

# Check Node.js version
node --version  # Should be 18+
```

#### API Connection Issues
```bash
# Check if API is running
curl http://localhost:4000/health

# Check search backend
curl http://localhost:4000/debug/sources

# Check environment variables
echo $TYPESENSE_HOST
echo $TYPESENSE_API_KEY
```

#### Frontend Issues
```bash
# Clear Next.js cache
rm -rf apps/web/.next
pnpm dev:web

# Check for TypeScript errors
pnpm type-check
```

### Getting Help
1. **Check** existing issues on GitHub
2. **Search** the documentation
3. **Ask** in the community forum
4. **Create** a new issue with detailed information

---

*For deployment information, see the [Deployment Guide](./deployment.md).*
