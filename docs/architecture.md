# System Architecture

Open Access Explorer is built as a modern, scalable web application with a clear separation of concerns between frontend, backend, and data layers.

## 🏗️ High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                       │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │   Search    │ │   Results   │ │   Paper Details    │   │
│  │   Interface │ │   Display   │ │   & Citations      │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP/REST API
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (Fastify)                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │   Search    │ │   Paper     │ │   Citation          │   │
│  │   Pipeline  │ │   Details   │ │   Generation        │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Data Sources
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Sources                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│  │  arXiv  │ │  CORE   │ │ Europe  │ │  NCBI   │ │  PLOS   │ │
│  │         │ │         │ │   PMC   │ │         │ │         │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Search Backend
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Search Engine                              │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Typesense  │ │ Meilisearch │ │      Algolia        │   │
│  │ (Recommended)│ │             │ │    (Optional)      │   │
│  └─────────────┘ └─────────────┘ └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🎯 Core Components

### Frontend Layer (Next.js 14)

#### Application Structure
```
apps/web/
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout with providers
│   ├── page.tsx           # Homepage with search interface
│   ├── results/           # Search results page
│   └── paper/[id]/        # Individual paper details
├── components/            # React components
│   ├── ui/               # shadcn/ui base components
│   ├── SearchBar.tsx     # Main search interface
│   ├── ResultCard.tsx    # Paper result display
│   └── paper/            # Paper-specific components
└── lib/                  # Utilities and helpers
    ├── fetcher.ts        # API client
    ├── citations.ts      # Citation generation
    └── utils.ts          # Common utilities
```

#### Key Frontend Features
- **App Router**: Modern Next.js routing with server components
- **TypeScript**: Full type safety with shared types package
- **Responsive Design**: Mobile-first approach with Tailwind CSS
- **Component Library**: shadcn/ui for consistent, accessible components
- **State Management**: React hooks and URL-based state persistence
- **Caching**: Intelligent client-side caching for performance

### Backend Layer (Fastify API)

#### API Structure
```
apps/api/
├── src/
│   ├── index.ts          # Main API server
│   ├── lib/              # Core business logic
│   │   ├── search-pipeline.ts    # Multi-source search orchestration
│   │   ├── aggregators.ts        # Data source aggregation
│   │   ├── cache.ts              # Caching layer
│   │   └── pdf.ts                # PDF resolution logic
│   └── sources/          # Data source connectors
│       ├── arxiv.ts      # arXiv API integration
│       ├── core.ts       # CORE API integration
│       ├── europepmc.ts  # Europe PMC integration
│       └── ncbi.ts       # NCBI/PubMed integration
└── dist/                 # Compiled JavaScript
```

#### API Endpoints
- **POST /api/search**: Multi-source paper search
- **GET /api/paper/:id**: Individual paper details with PDF resolution
- **GET /health**: Health check endpoint
- **GET /debug/sources**: Source connectivity testing

### Data Layer

#### Search Pipeline Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    Search Pipeline                           │
│                                                             │
│  1. Query Processing                                        │
│     • Parse search parameters                               │
│     • Validate filters and options                          │
│     • Generate cache keys                                  │
│                                                             │
│  2. Multi-Source Aggregation                               │
│     • Parallel API calls to all sources                    │
│     • Timeout handling (3s per source)                     │
│     • Error handling and fallbacks                          │
│                                                             │
│  3. Data Normalization                                      │
│     • Convert to unified OARecord format                   │
│     • Standardize field names and types                    │
│     • Handle missing or malformed data                     │
│                                                             │
│  4. Deduplication                                           │
│     • DOI-based deduplication (primary)                     │
│     • Title similarity matching (fallback)                │
│     • Source preference ranking                            │
│                                                             │
│  5. Enrichment Pipeline                                     │
│     • Unpaywall PDF resolution                              │
│     • Crossref metadata enhancement                         │
│     • Citation count and publisher info                    │
│                                                             │
│  6. Filtering & Sorting                                     │
│     • Apply user-specified filters                         │
│     • Sort by relevance, date, citations                    │
│     • Pagination and result limiting                        │
│                                                             │
│  7. Caching & Response                                      │
│     • Cache results for 5 minutes                          │
│     • Return formatted response                            │
│     • Log performance metrics                              │
└─────────────────────────────────────────────────────────────┘
```

## 🔄 Data Flow

### Search Request Flow
```
User Query → Frontend → API Gateway → Search Pipeline
     ↓
Multi-Source Aggregation → Data Normalization → Deduplication
     ↓
Enrichment (Unpaywall + Crossref) → Filtering → Sorting
     ↓
Caching → Response → Frontend Display
```

### Paper Details Flow
```
Paper ID → API Lookup → Source-Specific Fetch → PDF Resolution
     ↓
Metadata Enrichment → Citation Generation → Response
```

## 🗄️ Data Models

### Core Data Types

#### OARecord (Open Access Record)
```typescript
interface OARecord {
  id: string;                 // Unique identifier (source:sourceId)
  doi?: string;               // Digital Object Identifier
  title: string;             // Paper title
  authors: string[];         // Author names
  year?: number;             // Publication year
  venue?: string;            // Journal/conference name
  abstract?: string;         // Paper abstract
  source: DataSource;        // Original data source
  sourceId: string;          // Source-specific identifier
  oaStatus?: OAStatus;       // Open access status
  bestPdfUrl?: string;       // Direct PDF link
  landingPage?: string;      // Canonical paper page
  topics?: string[];         // Subject keywords
  language?: string;         // Paper language
  publisher?: string;        // Publisher name
  citationCount?: number;     // Number of citations
  license?: string;          // License URL
  createdAt: string;         // Record creation timestamp
  updatedAt?: string;        // Last update timestamp
}
```

#### Search Parameters
```typescript
interface SearchParams {
  q: string;                 // Search query
  page?: number;             // Page number (default: 1)
  pageSize?: number;         // Results per page (default: 20)
  sort?: SortOption;        // Sort order
  filters?: SearchFilters;  // Filter options
}

interface SearchFilters {
  sources?: string[];        // Data sources to search
  yearFrom?: number;        // Start year filter
  yearTo?: number;          // End year filter
  venue?: string[];         // Venue/journal filter
  oaStatus?: string[];      // Open access status filter
  language?: string[];       // Language filter
}
```

#### Search Response
```typescript
interface SearchResponse {
  hits: OARecord[];          // Search results
  total: number;             // Total number of results
  page: number;              // Current page
  pageSize: number;          // Results per page
  facets: SearchFacets;     // Facet counts for filtering
  query: string;            // Original search query
  took: number;              // Search time in milliseconds
}
```

## 🔧 Search Backend Integration

### Typesense (Recommended)
```typescript
// Configuration
const typesenseConfig = {
  host: process.env.TYPESENSE_HOST,
  port: process.env.TYPESENSE_PORT,
  protocol: process.env.TYPESENSE_PROTOCOL,
  apiKey: process.env.TYPESENSE_API_KEY,
  collection: 'oa_records'
};

// Search implementation
async search(params: SearchParams): Promise<SearchResponse> {
  const searchParams = {
    q: params.q,
    query_by: 'title,authors,abstract,topics',
    filter_by: this.buildFilters(params.filters),
    sort_by: this.buildSort(params.sort),
    per_page: params.pageSize,
    page: params.page
  };
  
  return await this.client.collections('oa_records')
    .documents()
    .search(searchParams);
}
```

### Meilisearch (Alternative)
```typescript
// Configuration
const meilisearchConfig = {
  host: process.env.MEILI_HOST,
  apiKey: process.env.MEILI_MASTER_KEY,
  index: 'oa_records'
};

// Search implementation
async search(params: SearchParams): Promise<SearchResponse> {
  const searchParams = {
    q: params.q,
    attributesToSearchOn: ['title', 'authors', 'abstract', 'topics'],
    filter: this.buildFilters(params.filters),
    sort: this.buildSort(params.sort),
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize
  };
  
  return await this.client.index('oa_records')
    .search(searchParams);
}
```

## 🚀 Performance Optimizations

### Caching Strategy
```typescript
// Multi-level caching
const cacheConfig = {
  search: {
    ttl: 300000,        // 5 minutes
    maxSize: 1000       // 1000 cached searches
  },
  paper: {
    ttl: 600000,        // 10 minutes
    maxSize: 5000       // 5000 cached papers
  },
  pdf: {
    ttl: 3600000,       // 1 hour
    maxSize: 10000      // 10000 cached PDFs
  }
};
```

### Parallel Processing
```typescript
// Concurrent source aggregation
const sourcePromises = sources.map(source => 
  this.fetchFromSource(source, params)
    .timeout(3000)  // 3 second timeout
    .catch(error => {
      console.warn(`Source ${source} failed:`, error);
      return []; // Return empty array on failure
    })
);

const results = await Promise.allSettled(sourcePromises);
```

### Database Indexing
```typescript
// Typesense collection schema
const collectionSchema = {
  name: 'oa_records',
  fields: [
    { name: 'title', type: 'string', facet: false },
    { name: 'authors', type: 'string[]', facet: true },
    { name: 'abstract', type: 'string', facet: false },
    { name: 'year', type: 'int32', facet: true },
    { name: 'venue', type: 'string', facet: true },
    { name: 'source', type: 'string', facet: true },
    { name: 'oaStatus', type: 'string', facet: true }
  ],
  default_sorting_field: 'createdAt'
};
```

## 🔒 Security Considerations

### API Security
- **Rate Limiting**: 100 requests per minute per IP
- **CORS Configuration**: Restricted to frontend domains
- **Input Validation**: Comprehensive parameter validation
- **Error Handling**: No sensitive information in error responses

### Data Privacy
- **No User Tracking**: No personal data collection
- **Search Logging**: Anonymous query logging only
- **GDPR Compliance**: No cookies or user identification
- **Data Retention**: Search results cached for 5 minutes only

### External API Security
- **API Key Management**: Secure storage of external API keys
- **Request Timeouts**: Prevent hanging requests
- **Error Boundaries**: Graceful handling of external failures
- **User-Agent Headers**: Polite API usage with contact information

## 📊 Monitoring and Observability

### Logging Strategy
```typescript
// Structured logging with context
fastify.log.info({
  operation: 'search',
  query: params.q,
  sources: params.filters?.sources,
  results: searchResult.total,
  took: searchResult.took
}, 'Search completed');
```

### Performance Metrics
- **Response Times**: Track API endpoint performance
- **Cache Hit Rates**: Monitor caching effectiveness
- **Error Rates**: Track and alert on failures
- **Source Availability**: Monitor external API health

### Health Checks
```typescript
// Comprehensive health monitoring
app.get('/health', async (request, reply) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      search: await this.checkSearchBackend(),
      sources: await this.checkDataSources(),
      cache: await this.checkCache()
    }
  };
  
  return health;
});
```

## 🔄 Deployment Architecture

### Production Environment
```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer                            │
│                    (Nginx/Cloudflare)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vercel)                        │
│              • Next.js Static Generation                   │
│              • Global CDN Distribution                      │
│              • Automatic Scaling                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API (Railway/Render)                     │
│              • Fastify API Server                          │
│              • Auto-scaling Containers                      │
│              • Health Monitoring                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Search Backend                            │
│              • Typesense Cloud                             │
│              • Managed Infrastructure                       │
│              • Automatic Backups                           │
└─────────────────────────────────────────────────────────────┘
```

### Development Environment
```bash
# Local development with Docker Compose
docker-compose up -d  # Start all services
pnpm dev             # Start development servers
```

This architecture provides a robust, scalable foundation for the Open Access Explorer platform, ensuring high performance, reliability, and maintainability.

---

*For detailed deployment instructions, see the [Deployment Guide](./deployment.md).*
