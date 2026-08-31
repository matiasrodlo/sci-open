# Development Guide

## Prerequisites

- Node.js 22+
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
cp docs/env.example .env
```

Edit `.env` with your settings. Minimum required:

```env
API_ORIGIN=http://localhost:4000
PORT=4000
REDIS_URL=redis://localhost:6379
```

### 3. Start Services

```bash
# Redis is the only service the dev servers need. Compose also builds
# api and web for a production-like run; `pnpm dev` replaces them.
docker-compose up -d redis
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
    │   ├── index.ts       # Routes and boot
    │   ├── orchestrator/  # plan, fan out, merge, rank, facet, enrich, lookup
    │   ├── providers/     # One directory per source of results
    │   ├── authorities/   # Services consulted about a record
    │   └── lib/           # Cache, HTTP pooling, PDF proxy, schemas
    └── scripts/           # Developer tools, not shipped in the image

packages/
└── shared/                # Shared TypeScript types
```

## Adding a Data Source

A provider is a directory under `apps/api/src/providers/`, split so that only
one of its four parts does I/O.

1. **`capabilities.ts`** — what this API can actually do. Strictly descriptive:
   every entry should be checkable against the provider's own documentation, so
   that when the orchestrator skips it the reason names a missing capability.

```typescript
import type { ProviderCapabilities } from '@open-access-explorer/shared';

export const capabilities: ProviderCapabilities = {
  keywordSearch: true,
  doiLookup: true,
  fields: ['title', 'authors', 'year', 'venue'],
  yearFilter: true,
  maxPageSize: 100,
  reportsTotal: true,
  suppliesCitations: false
};
```

2. **`translate.ts`** — `Query` to the provider's native query, and nothing
   else. Pure, so it can be tested without the network. This is where a phrase
   stays a phrase and a year bound becomes whatever the provider understands.

3. **`fetch.ts`** — the one impure part. It owns no timeout and swallows no
   error: both belong to the orchestrator, which is what makes a failure
   reportable rather than invisible.

4. **`normalize.ts`** — payload to `Paper[]`, plus a `skipped` entry for every
   record it could not read and why. One bad record costs one record.

Then add an entry to `apps/api/src/orchestrator/registry.ts`, and the source
identifier to `packages/shared/src/types.ts`. Give it a `lookup` in the
registry only if the API has a way to ask for one record by its own id;
without one, `lookupPaper` asks the search endpoint, which is the right
request when the provider's native ids are DOIs or are themselves indexed.

Record one live response into `apps/api/src/__fixtures__/` — see
`scripts/record-fixtures.ts` — and write the `normalize` and `translate` suites
against it, so the tests stay offline.

## Testing

```bash
# Every suite runs offline against the committed fixtures
pnpm test

# Type checking
pnpm typecheck

# Linting
pnpm lint

# Full build
pnpm build
```

CI runs all four on every push and pull request, plus a blocking dependency
audit (`node scripts/audit-gate.mjs`).

## Debugging

### API Logs

The API server uses structured logging. Set log level:

```env
NODE_ENV=development  # Debug logs
NODE_ENV=production   # Info logs only
```

### Cache Inspection

```bash
# Check Redis. Keys are `namespace:hash(subject)` plus a variant hash, over
# the `search`, `facets` and `partial` namespaces. Prefer SCAN to KEYS, which
# blocks the server for the length of the keyspace.
redis-cli
> SCAN 0 MATCH 'search:*' COUNT 100

# Clear cache via API. Administrative routes need a bearer token, and are
# disabled outright when ADMIN_API_KEY is unset — see ./configuration.md.
curl -X POST http://localhost:4000/api/cache/clear \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

### Performance Monitoring

All three are admin-gated on the same bearer token as the cache routes.

```bash
# Across every service
curl http://localhost:4000/api/performance/metrics \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# One service
curl http://localhost:4000/api/performance/metrics/<service> \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Rendered report
curl http://localhost:4000/api/performance/report \
  -H "Authorization: Bearer $ADMIN_API_KEY"
```

There was a fourth, `/api/performance/comparison/<service>`, which returned a
pooled-versus-unpooled comparison. It could only ever answer `404`: the
baseline half was written by a `setBaseline` nothing called, and there was
nothing to call it with, because this service has no unpooled arm to measure.

The monitor is read by these endpoints only. Nothing consults it to decide
which providers are asked — the scoring layer that did was deleted in the
refactor and has not grown back.

## Common Tasks

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
- **Linting**: ESLint — `@typescript-eslint` for the API, the Next config for the web app
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

