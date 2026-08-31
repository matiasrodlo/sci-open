# Configuration

## Environment Variables

### Frontend

```env
API_ORIGIN=http://localhost:4000
```

Where the Next server forwards `/api/*`. A route handler reads it on every
request, so it is a deployment setting and takes effect without a rebuild. It
replaced `NEXT_PUBLIC_API_BASE`, which was inlined at build time and therefore
baked one origin into the bundle.

### API Server

```env
PORT=4000
NODE_ENV=development
LOG_LEVEL=debug
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW=1 minute
```

`LOG_LEVEL` takes any pino level — `trace`, `debug`, `info`, `warn`, `error`,
`fatal` — and defaults to `info` under `NODE_ENV=production`, `debug`
otherwise. Everything the service logs goes through Fastify's logger, so this
one setting governs provider and orchestrator output as well as request
logging.

### Search

```env
SEARCH_RESCUE_LIMIT=200         # papers the gate may ask about before dropping them
```

Every search applies two gates the caller did not ask for — a paper needs a
retrievable copy, and needs to be open — and both read fields the providers
often do not supply. Applying them to whatever the fan-out happened to return
therefore drops papers that were never actually judged: a work whose only PDF
Unpaywall knows about was excluded before Unpaywall was ever consulted, because
enrichment runs on the page and that paper never reached one.

`SEARCH_RESCUE_LIMIT` is how many of those papers are asked about before the
gate drops them, in rank order. The cost is one request per candidate to each
authority that is *authoritative* on a gated field — today Unpaywall alone, so
one request each. Candidates past the limit are dropped exactly as they were
before, and the step reports that it was bounded, which is the case where
`total` remains a lower bound.

Set it to `0` to turn the step off and restore the previous result set. The
limit is deliberately independent of which page was requested: a window that
grew as the reader paged would change `total` underneath them, which is the
same reason `depth` does not grow either.

### Cache

```env
REDIS_URL=redis://localhost:6379
CACHE_MAX_BYTES=268435456       # 256 MB, the L1 budget
CACHE_REDIS_COOLDOWN_MS=5000    # how long L2 stays shut after a failure
```

Two levels: L1 in memory and L2 in Redis. `CACHE_MAX_BYTES` bounds L1 in
bytes rather than in entries, because the things counted are pages of search
results — the old 10,000-key cap was roughly 1.6 GB at measured response sizes,
and nothing about the number said so. TTLs are per-namespace and live in
`cache-manager.ts`.

`CACHE_REDIS_COOLDOWN_MS` is the circuit breaker in front of L2. An
unreachable Redis used to be paid for once per cache operation, and a paper
request makes five or six: measured against a port with nothing listening, two
requests took 9.55s and 29.52s. One failure now holds L2 shut for the cooldown
and everything behind it goes straight to memory, so the same two requests take
0.63s and 0.36s. Any success reopens it, as does the client's `ready` event,
and `/api/cache/metrics` reports the state as `l2Available`. Deletes and
invalidations deliberately ignore the cooldown — skipping a read costs a miss,
while skipping a delete leaves behind an entry a caller asked to remove.

### Data Sources

```env
CORE_API_KEY=
NCBI_API_KEY=
DOAJ_API_KEY=
DATACITE_API_KEY=
UNPAYWALL_EMAIL=your-email@example.com
```

Keys are optional, and an unset key is not the same as a placeholder one: a
wrong credential is worse than none. DataCite answers a request carrying
`Authorization: Bearer your_datacite_api_key_here` with `401`, where the same
request with no header at all answers `200`. Leave them empty.

**Base URLs are not configurable.** Each provider and authority takes its base
URL as a `baseUrl` option that defaults to a module constant, and reads no
environment variable. The `*_BASE` names once listed here — `CORE_BASE`,
`ARXIV_BASE`, `EUROPE_PMC_BASE`, `NCBI_EUTILS_BASE`, `OPENAIRE_BASE` and the
rest — had no effect from the moment the providers were rewritten. The option
exists so a test can aim a fetch at a fixture server, not as a deployment knob.
Point a provider somewhere else by changing its `DEFAULT_BASE_URL`.

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

# Service-specific pools (JSON), merged over the global settings above
OPENALEX_POOL_CONFIG={"maxConnections": 30, "maxSockets": 100}
CROSSREF_POOL_CONFIG={"maxConnections": 25, "maxSockets": 80}
UNPAYWALL_POOL_CONFIG={"maxConnections": 40, "maxSockets": 120}
DATACITE_POOL_CONFIG={"maxConnections": 15, "maxSockets": 40}
NCBI_POOL_CONFIG={"maxConnections": 25, "maxSockets": 70}
```

Those five, and no others, because those five providers are the ones that fetch
through the pooled client. CORE and Europe PMC call axios directly, so a
`CORE_POOL_CONFIG` or `EUROPE_PMC_POOL_CONFIG` is parsed at startup into a map
that nothing then queries.

### Administrative Access

The cache and performance endpoints are operational
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
API_ORIGIN=https://api.yourdomain.com
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

