# Development Guide

## Prerequisites

- Node.js 18+
- pnpm 8+
- Docker (for local services)

## Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Environment Configuration

Copy the example environment file:

```bash
cp env.example .env
```

Edit `.env` with your settings. Minimum required:

```env
NEXT_PUBLIC_API_BASE=http://localhost:4000
PORT=4000
REDIS_URL=redis://localhost:6379
```

### 3. Start Services

```bash
# Start Redis, Typesense, Meilisearch
docker-compose up -d
```

### 4. Run Development Servers

```bash
# Start both API and web
pnpm dev

# Or separately
pnpm dev:api    # API on :4000
pnpm dev:web    # Web on :3000
```

## Project Structure

```
apps/
├── web/                    # Next.js frontend
│   ├── app/               # App Router pages
│   │   ├── page.tsx      # Home page
│   │   ├── results/      # Search results
│   │   └── paper/[id]/   # Paper detail page
│   ├── components/        # React components
│   └── lib/              # Utilities
│
└── api/                   # Fastify API
    ├── src/
    │   ├── index.ts       # Main server
    │   ├── sources/       # Data source connectors
    │   └── lib/          # Core libraries
    │       ├── search-pipeline.ts
    │       ├── enhanced-search-pipeline.ts
    │       ├── cache.ts
    │       └── ...
    └── seed.ts            # Data seeding script

packages/
├── shared/                # Shared TypeScript types
└── search/                # Search backend adapters
```

## Adding a Data Source

1. **Create Connector**

Create `apps/api/src/sources/newsource.ts`:

```typescript
import { SourceConnector, OARecord } from '@open-access-explorer/shared';

export class NewSourceConnector implements SourceConnector {
  constructor(private baseUrl: string) {}

  async search(params: {
    doi?: string;
    titleOrKeywords?: string;
    yearFrom?: number;
    yearTo?: number;
  }): Promise<OARecord[]> {
    // Implement search logic
    return [];
  }
}
```

2. **Add to Aggregator**

Update `apps/api/src/lib/aggregators.ts` to include the new source.

3. **Update Types**

Add source identifier to `packages/shared/src/types.ts` if needed.

## Adding a Search Backend

1. **Create Adapter**

Create `packages/search/src/newsource.ts`:

```typescript
import { SearchAdapter, OARecord } from '@open-access-explorer/shared';

export class NewSearchAdapter implements SearchAdapter {
  async ensureIndex(): Promise<void> {}
  async upsertMany(records: OARecord[]): Promise<void> {}
  async search(params: any): Promise<any> {
    return { hits: [], total: 0, facets: {} };
  }
}
```

2. **Export**

Add to `packages/search/src/index.ts`.

3. **Configure**

Update API server to support the new backend.

## Testing

```bash
# Run linting
pnpm lint

# Type checking
pnpm build
```

## Debugging

### API Logs

The API server uses structured logging. Set log level:

```env
NODE_ENV=development  # Debug logs
NODE_ENV=production   # Info logs only
```

### Cache Inspection

```bash
# Check Redis
redis-cli
> KEYS *
> GET cache:search:...

# Clear cache via API
curl -X POST http://localhost:4000/api/cache/clear
```

### Performance Monitoring

```bash
# Get performance stats
curl http://localhost:4000/api/performance/monitor

# Run performance test
curl -X POST http://localhost:4000/api/performance/test \
  -H "Content-Type: application/json" \
  -d '{"service": "openalex", "baseUrl": "https://api.openalex.org", "endpoint": "/works"}'
```

## Common Tasks

### Seed Search Index

```bash
pnpm seed
```

### Clear Build Artifacts

```bash
pnpm clean
```

### Rebuild Packages

```bash
pnpm build
```

## Code Style

- **TypeScript**: Strict mode enabled
- **Formatting**: Prettier (if configured)
- **Linting**: ESLint with Next.js config
- **Imports**: Absolute paths preferred

## Troubleshooting

### Port Already in Use

```bash
# Find process using port
lsof -i :4000
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Redis Connection Issues

```bash
# Check Redis is running
redis-cli ping

# Restart Redis
docker-compose restart redis
```

### Cache Not Working

1. Verify Redis connection
2. Check cache configuration in `.env`
3. Review cache manager logs
4. Clear cache and retry

