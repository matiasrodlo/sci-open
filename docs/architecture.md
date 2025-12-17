# Architecture

## Overview

Open Access Explorer follows a modular monorepo architecture with clear separation between frontend, backend, and shared packages.

## System Architecture

```
┌─────────────┐
│   Next.js   │  Frontend (Port 3000)
│   Frontend  │
└──────┬──────┘
       │ HTTP
       ▼
┌─────────────┐
│   Fastify   │  API Server (Port 4000)
│     API     │
└──────┬──────┘
       │
       ├──► Enhanced Search Pipeline
       │    ├── Smart Source Selector
       │    ├── Query Analyzer
       │    └── Record Merger
       │
       ├──► Data Sources
       │    ├── arXiv
       │    ├── CORE
       │    ├── Europe PMC
       │    ├── NCBI
       │    └── Others...
       │
       ├──► Enrichment Services
       │    ├── OpenAlex
       │    ├── Crossref
       │    └── Unpaywall
       │
       └──► Cache Layer
            ├── Redis (L2)
            └── NodeCache (L1)
```

## Core Components

### Search Pipeline

The `EnhancedSearchPipeline` orchestrates search across multiple sources:

1. **Query Analysis** - Normalizes and analyzes search queries
2. **Smart Source Selection** - Chooses optimal sources based on query patterns
3. **Parallel Aggregation** - Searches selected sources concurrently
4. **Record Merging** - Deduplicates and merges results
5. **Enrichment** - Enhances records with metadata from OpenAlex/Crossref
6. **Faceting** - Generates filter facets from results

### Caching Strategy

Three-tier caching system:

- **L1 (NodeCache)**: In-memory, fast, short TTL (5 min)
- **L2 (Redis)**: Persistent, medium TTL (1 hour)
- **L3 (Long-term)**: Extended TTL (24 hours)

Cache warming pre-populates frequently accessed queries.

### Source Connectors

Each data source implements the `SourceConnector` interface:

```typescript
interface SourceConnector {
  search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]>;
}
```

### Smart Source Selection

Adaptive algorithm that:
- Analyzes query characteristics
- Monitors source performance
- Selects optimal sources per query
- Learns from historical patterns

## Data Flow

### Search Request

```
1. Client → API: POST /api/search
2. API checks cache (L1 → L2 → L3)
3. If miss: Query Analyzer processes query
4. Smart Source Selector chooses sources
5. Parallel search across selected sources
6. Record Merger deduplicates results
7. Enrichment services enhance metadata
8. Results cached and returned
```

### Paper Details

```
1. Client → API: GET /api/paper/:id
2. Parse ID (source:sourceId or DOI)
3. Check cache
4. Fetch from appropriate source
5. Resolve PDF URL
6. Cache and return
```

## Performance Optimizations

- **HTTP Connection Pooling** - Reuses connections to external APIs
- **Request Batching** - Groups similar requests
- **Timeout Management** - Prevents slow sources from blocking
- **Fallback Chains** - Graceful degradation on failures
- **Adaptive Learning** - Improves source selection over time

## Scalability

- **Horizontal Scaling**: Stateless API servers
- **Cache Distribution**: Redis cluster support
- **Search Backend**: Typesense/Meilisearch for large-scale indexing
- **Load Balancing**: Ready for multiple API instances

