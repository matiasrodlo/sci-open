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
TRUST_PROXY=
```

`TRUST_PROXY` decides what the rate limit counts. The limiter keys on
`request.ip`, and with nothing trusted that is the address that opened the
socket — which, because `apps/web` proxies every `/api/*` call server-side, is
the web tier for all traffic. The 120-per-minute default is then one bucket
shared by every visitor rather than one each, roughly two searches a second
before everyone starts seeing `429`. Naming the proxy here restores the real
caller, taken from `X-Forwarded-For`:

```env
TRUST_PROXY=10.0.1.7          # the web tier, or the load balancer in front of it
TRUST_PROXY=172.16.0.0/12     # a CIDR, or a comma-separated list of either
TRUST_PROXY=loopback          # or a named range
```

A bare number used to mean "trust this many hops" and no longer does. Fastify 5
answers a hop count by trusting *nothing* — hop-count-only trust cannot check
the immediate peer, so a direct client could spoof `X-Forwarded-*` by supplying
enough hops. Rather than hand the value over to be ignored in silence, the
service refuses it and logs why at startup; a deployment carrying `TRUST_PROXY=1`
would otherwise keep booting, keep looking configured, and quietly return to one
rate-limit bucket for every visitor.

Point it at the proxy and nothing else. `X-Forwarded-For` is a request header,
so trusting an address that is not really a proxy lets any caller choose their
own rate-limit key — a limit that applies to nobody, which is the worse half of
the trade. `true` is only correct when the proxy is the sole thing that can
reach the port; note that `docker-compose.yml` publishes `4000` on the host, so
that is not the case under plain compose. The service logs a warning at startup
whenever this is unset.

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
CACHE_MAX_BYTES=268435456           # 256 MB, the L1 response budget
PROVIDER_CACHE_MAX_BYTES=134217728  # 128 MB, the fan-out cache
CACHE_REDIS_COOLDOWN_MS=5000        # how long L2 stays shut after a failure
```

Two levels: L1 in memory and L2 in Redis. `CACHE_MAX_BYTES` bounds L1 in
bytes rather than in entries, because the things counted are pages of search
results — the old 10,000-key cap was roughly 1.6 GB at measured response sizes,
and nothing about the number said so. TTLs are per-namespace and live in
`cache-manager.ts`.

`PROVIDER_CACHE_MAX_BYTES` bounds a different cache: the in-process one holding
what each *provider* returned, which is what lets a page-2 click reuse the
fan-out it was paged from rather than repeating it. It was capped at 500 entries
and had the same defect in a worse form — an entry holds up to `depth` records
and the default depth is 600, so the cap permitted 300,000 papers, about 518 MB
serialised and one to one and a half gigabytes of live heap. It fills over
roughly fifty distinct queries, which is why it would have surfaced as an
out-of-memory rather than as a failing test.

Both numbers count serialised size, so expect two to three times the configured
value resident. The provider cache estimates that size from the text each record
carries rather than serialising to measure it — calibrated against the committed
fixtures to land between 1.01 and 1.14 times the real length, never under. An
entry larger than the whole budget is refused rather than admitted and then
evicting everything else, so a very small value disables the cache instead of
thrashing it.

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

# Service-specific pools (JSON), merged over the global settings above.
# One per upstream: arxiv, biorxiv, core, crossref, datacite, doaj, europepmc,
# ncbi, openaire, opencitations, openalex, plos, unpaywall.
OPENALEX_POOL_CONFIG={"maxConnections": 30, "maxSockets": 100}
EUROPEPMC_POOL_CONFIG={"maxConnections": 30, "maxSockets": 100}
CORE_POOL_CONFIG={"maxConnections": 20, "maxSockets": 60}
```

Every upstream fetches through the pooled client, so every upstream has a knob.
That was not true until recently: five of the thirteen were pooled and the eight
left out were the *search fan-out* — the expensive half. Europe PMC alone reads
up to 600 records per query, and it opened a fresh connection each time, ran
without the retry policy, and reported nothing to the monitor. So the metrics
below described the five cheapest callers and were silent about the ones that
decide how long a search takes.

A name absent from the list falls back to the global defaults rather than
failing, so a missing entry costs per-service tuning and nothing else.

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

