# Configuration

## Environment Variables

### Frontend

```env
NEXT_PUBLIC_API_BASE=http://localhost:4000
NEXT_PUBLIC_SEARCH_BACKEND=typesense
```

### API Server

```env
PORT=4000
NODE_ENV=development
```

### Cache

```env
REDIS_URL=redis://localhost:6379
CACHE_L1_TTL=300          # 5 minutes
CACHE_L2_TTL=3600         # 1 hour
CACHE_L3_TTL=86400        # 24 hours
```

### Data Sources

```env
# CORE
CORE_API_KEY=your_core_api_key
CORE_BASE=https://api.core.ac.uk/v3

# arXiv
ARXIV_BASE=https://export.arxiv.org/api/query

# Europe PMC
EUROPE_PMC_BASE=https://www.ebi.ac.uk/europepmc/webservices/rest

# NCBI
NCBI_EUTILS_BASE=https://eutils.ncbi.nlm.nih.gov/entrez/eutils
NCBI_API_KEY=your_ncbi_api_key

# OpenAIRE
OPENAIRE_BASE=https://api.openaire.eu/search

# Unpaywall
UNPAYWALL_EMAIL=your-email@example.com
```

### Search Backends

#### Typesense

```env
SEARCH_BACKEND=typesense
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz
```

#### Meilisearch

```env
SEARCH_BACKEND=meili
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=xyz
```

#### Algolia

```env
SEARCH_BACKEND=algolia
ALGOLIA_APP_ID=your_app_id
ALGOLIA_API_KEY=your_api_key
ALGOLIA_INDEX=oa_records
```

### Performance

```env
# HTTP Connection Pooling
HTTP_POOL_MAX_CONNECTIONS=20
HTTP_POOL_KEEP_ALIVE_TIMEOUT=30000
HTTP_POOL_MAX_SOCKETS=50
HTTP_POOL_TIMEOUT=10000
HTTP_POOL_RETRY_ATTEMPTS=3
HTTP_POOL_RETRY_DELAY=1000
HTTP_POOL_ENABLE_HTTP2=true

# Service-specific pools (JSON)
OPENALEX_POOL_CONFIG={"maxConnections": 30, "maxSockets": 100}
CROSSREF_POOL_CONFIG={"maxConnections": 25, "maxSockets": 80}
UNPAYWALL_POOL_CONFIG={"maxConnections": 40, "maxSockets": 120}
```

### Administrative Access

The cache, performance and debug endpoints are operational
controls rather than part of the public API. They are gated behind a shared key:

```bash
ADMIN_API_KEY=
```

Requests must carry it as `Authorization: Bearer <key>` (or `X-Admin-Key`).

The gate fails closed. With no key configured every one of those routes returns
`503` instead of being served unauthenticated, and the server logs a warning at
startup. This is deliberate: `apps/web/next.config.js` proxies `/api/*` straight
through, so an ungated route is reachable from any browser that can load the
site. `/api/search`, `/api/paper/:id`, `/api/download-pdf` and `/health` stay
public.

## Docker Compose

The `docker-compose.yml` provides local services:

- **Redis** (port 6379) - Cache backend
- **Typesense** (port 8108) - Search backend
- **Meilisearch** (port 7700) - Alternative search backend

Start all services:

```bash
docker-compose up -d
```

Stop services:

```bash
docker-compose down
```

## Production Configuration

### API Server

```env
NODE_ENV=production
PORT=4000
REDIS_URL=redis://your-redis-host:6379
```

### Frontend

```env
NEXT_PUBLIC_API_BASE=https://api.yourdomain.com
NEXT_PUBLIC_SEARCH_BACKEND=typesense
```

### Security

- Use strong API keys
- Enable HTTPS
- Configure CORS properly
- Set secure Redis passwords
- Use environment-specific secrets

## Performance Tuning

### Cache TTLs

Adjust based on data freshness requirements:

- **Short TTL** (5 min): Frequently updated sources
- **Medium TTL** (1 hour): Stable metadata
- **Long TTL** (24 hours): Static content

### Connection Pools

Increase for high-traffic scenarios:

```env
HTTP_POOL_MAX_CONNECTIONS=50
HTTP_POOL_MAX_SOCKETS=200
```

