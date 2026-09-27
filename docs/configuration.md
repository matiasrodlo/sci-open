# Configuration

## Environment Variables

The API reads every setting once, at startup, in `apps/api/src/config.ts`, and
one rule holds for all of them: unset or empty means the default, and a value
that does not parse or is out of range also means the default — or the nearest
value in range, where there is a ceiling — with a warning logged before the
server starts listening. A mistyped setting costs that setting, never the
service, and never silently.

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
RATE_LIMIT_DOWNLOAD_MAX=20
RATE_LIMIT_NEW_SEARCH_MAX=30
TRUST_PROXY=
```

`RATE_LIMIT_MAX` covers every route but one. `/api/papers/:id/pdf` has its own
bucket, `RATE_LIMIT_DOWNLOAD_MAX`, because the two requests are expensive in
different currencies and one number could only ever be right for one of them: a
search costs a fan-out to ten providers and returns a few kilobytes, spending
other people's API quota, while a download costs one upstream request and
streams up to fifty megabytes, spending bandwidth and holding a connection for
as long as the publisher takes. Sharing a budget meant a reader downloading
papers spent the search allowance and a search loop locked them out of the file
they were reading.

Twenty a minute is more PDFs than a person opens and fewer than a scraper wants.
It is a starting point rather than a measured figure — the worst case is still a
gigabyte a minute per caller — so expect to move it once there is real traffic to
look at. Both limits share `RATE_LIMIT_WINDOW`.

Searches are priced a second time, by `RATE_LIMIT_NEW_SEARCH_MAX`, and only the
ones that cost the sources something. A search that resolves a result set of
its own — a new query, or a new filter on one — is a fan-out to ten providers,
their facet counts, up to two hundred Unpaywall lookups in the rescue and the
page's enrichment: some three hundred upstream requests, against quotas every
reader shares. Paging or re-sorting a set already held, or joining one another
reader is resolving, costs a slice and twenty enrichments. At `RATE_LIMIT_MAX`
alone, one script sending distinct queries could spend tens of thousands of
upstream requests a minute; this caps that at thirty new sets per window, and a
search over it answers `429` with `Retry-After` before anything is asked of a
source. Like the other two, it counts per caller only as far as `TRUST_PROXY`
lets it tell callers apart.

`RATE_LIMIT_WINDOW` is a duration — `30 seconds`, `2m`, `1 hour` — and a bare
number is milliseconds. It is checked at startup like every other setting: one
that does not parse, or comes to less than a second, falls back to a minute and
says so. It used to be handed to the limiter unchecked, and the limiter checks
nothing — `one minute` failed every route but `/health` with a 500, and `60`
was a sixty-millisecond window that limited nobody.

`TRUST_PROXY` decides what the rate limit counts. The limiter keys on
`request.ip`, and with nothing trusted that is the address that opened the
socket — which, because `apps/web` proxies every `/api/*` call server-side, is
the web tier for all traffic. The 120-per-minute default is then one bucket
shared by every visitor rather than one each, roughly two searches a second
before everyone starts seeing `429`. Naming the hops in front of the API
restores the real caller, taken from `X-Forwarded-For`.

Fastify reads that header from the right, starting at the socket. Each address
it trusts lets it read one entry further left, and the first address it does
not trust is the caller. The API's socket is always opened by `apps/web`, so
**the web tier is the hop that must be trusted** — name only the load balancer
and Fastify stops at the socket, `request.ip` stays the web tier, and every
visitor still shares one bucket. Worse, the startup warning goes quiet, because
a proxy is now configured:

```env
TRUST_PROXY=172.18.0.3        # apps/web, by address
TRUST_PROXY=172.18.0.0/16     # or the network it runs on, as a CIDR
TRUST_PROXY=10.0.0.5,172.18.0.3  # plus any proxy whose own address the chain carries
```

**Only behind a proxy that appends the visitor's address.** Trusting the web
tier means believing the entry to its left, and something has to have put the
visitor there. A load balancer, ingress or reverse proxy in front of `apps/web`
does — nginx's `$proxy_add_x_forwarded_for`, and every managed load balancer —
and a visitor who forges the header only adds entries further left, which are
never read. `apps/web` cannot do this for itself: Next fills `X-Forwarded-For`
from the socket only when the request carries none, so a visitor's own header
passes through untouched. Trust the web tier with nothing in front of it and
every caller picks their own rate-limit key, and the limit applies to nobody.
If there is nothing in front of `apps/web`, leave this unset and accept the
shared bucket; it is the safer of the two failures.

With more than one proxy — a CDN in front of the load balancer — each one
behind the first appends the address of the one before it, so name those too.
Never name the outermost proxy's *clients*.

A bare number used to mean "trust this many hops" and no longer does. Fastify 5
answers a hop count by trusting *nothing* — hop-count-only trust cannot check
the immediate peer, so a direct client could spoof `X-Forwarded-*` by supplying
enough hops. Rather than hand the value over to be ignored in silence, the
service refuses it and logs why at startup; a deployment carrying `TRUST_PROXY=1`
would otherwise keep booting, keep looking configured, and quietly return to one
rate-limit bucket for every visitor.

Name the hops and nothing else. `X-Forwarded-For` is a request header, so
trusting an address that is not really a proxy lets any caller choose their
own rate-limit key — a limit that applies to nobody, which is the worse half of
the trade. `true` is only correct when the web tier is the sole thing that can
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
SEARCH_DEPTH=600                # records read from each provider
SEARCH_RESCUE_LIMIT=200         # papers the gate may ask about before dropping them
SEARCH_RESCUE_BUDGET_MS=5000    # how long that whole pass may take
```

**`SEARCH_DEPTH` is how much of a corpus a search sees**, and the setting
behind the header that reads *"2,754 retrieved of 977,761+ matching"*. Those
are two different quantities, not a discrepancy: the second is what the largest
source says matches, and the first is `depth x providers that answered`, less
duplicates and less what the gates below dropped. Six sources answering at a
depth of 600 is a ceiling of 3,600 records however large the corpus is.

Depth is deliberately independent of which page was requested — a window that
grew as the reader paged would change `total` underneath them — so every page
of a search answers from the same read.

It is capped at **2,000**, and a larger value is clamped to that with a warning
rather than refused. The cost is per provider *per page*, so it multiplies in
three directions at once: DOAJ and OpenAIRE serve 100 records a page and pay
`depth / 100` requests each, issued in one burst; OpenAlex serves 200, against a
daily budget that a 22-query sweep can already exhaust at the default; and the
fan-out cache charges bytes, where a provider's answer at 2,000 is roughly
3.6 MB of its 128 MB budget. Non-positive and unparseable values fall back to
600.

**Raise `SEARCH_RESCUE_BUDGET_MS` when you raise it.** Depth multiplies the
candidates the gate below would drop, and the rescue budget does not grow to
match — so depth alone fetches more records and then drops a larger fraction of
them without asking, and the search still reports itself bounded.

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

**`SEARCH_RESCUE_BUDGET_MS` is usually the one to move.** The two settings
cannot both bind, and on a broad query it is never the limit that stops the
pass: 200 candidates at a concurrency of 16 is 12.5 waves, which fits in five
seconds only if the mean Unpaywall lookup comes back under 400ms — against a
per-lookup timeout of 2500ms. So the default limit is rarely reached, and
raising it to rescue more papers changes nothing measurable. Raise the budget
instead, and expect the search to take about that much longer in the worst
case; the limit is then the ceiling on what the extra time can cost you in
requests.

Zero is refused here and falls back to the default, which is the one place this
parses differently from the limit. `SEARCH_RESCUE_LIMIT=0` is a coherent
instruction — do not run the step — while a budget of zero would run it and
abort before the first lookup could return, paying the setup to guarantee
nothing.

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
OPENALEX_API_KEY=
UNPAYWALL_EMAIL=your-email@example.com
```

Keys are optional, and an unset key is not the same as a placeholder one: a
wrong credential is worse than none. DataCite answers a request carrying
`Authorization: Bearer your_datacite_api_key_here` with `401`, where the same
request with no header at all answers `200`. Leave them empty.

**`OPENALEX_API_KEY` is the one worth setting anyway.** OpenAlex meters requests
against a daily budget and an anonymous caller gets a tenth of what a key gets.
Spend it and every request answers `429`; the provider reports that as a failed
read rather than an empty one, so the search is marked incomplete and the
coverage panel names OpenAlex as a source that did not answer — which is what an
unkeyed dev run does on a single query. The key is free: make an account and
copy it from `openalex.org/settings/api`. It is sent as `Authorization: Bearer`
rather than the `api_key` query parameter OpenAlex also accepts, so it stays out
of request URLs, logs and pool metrics. It covers all three roles that call
OpenAlex — the search provider, the `/api/paper/:id` lookup and the DOI
authority — because they share one fetch.

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
HTTP_POOL_KEEP_ALIVE_TIMEOUT=30000
HTTP_POOL_MAX_SOCKETS=50
HTTP_POOL_TIMEOUT=10000
HTTP_POOL_RETRY_ATTEMPTS=3
HTTP_POOL_RETRY_DELAY=1000

# Service-specific pools (JSON), merged over the global settings above.
# One per upstream: arxiv, biorxiv, core, crossref, datacite, doaj, europepmc,
# ncbi, openaire, opencitations, openalex, plos, unpaywall.
OPENALEX_POOL_CONFIG={"maxSockets": 100}
EUROPEPMC_POOL_CONFIG={"maxSockets": 100}
CORE_POOL_CONFIG={"maxSockets": 60}
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
startup. This is deliberate: an ungated operator route should not depend on
nothing else standing in front of it. They are not forwarded by `apps/web`
either, which forwards search and paper details in both versions
(`/api/search`, `/api/paper/:id` and their `/api/v2/` twins) and
`/api/papers/:id/pdf`, and nothing else.

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

- **`ADMIN_API_KEY`** — set it, or `/api/cache/*` and `/api/performance/*` stay
  disabled. They are not served unauthenticated when it is missing; the gate
  fails closed. They are also not on the public edge: `apps/web` forwards only
  `search`, `paper/:id` and a paper's PDF, and compose publishes the API's port
  on loopback only, so an operator reaches them on the API directly.
- **`TRUST_PROXY`** — name **`apps/web`** by address or CIDR, and only once a
  load balancer or reverse proxy in front of it appends the visitor's address.
  Unset, or naming only that load balancer, the rate limit is keyed on the web
  tier: one shared bucket for every visitor. Naming the web tier with nothing
  in front of it lets any caller choose their own key. Do not set it to `true`
  unless nothing but the web tier can open a connection to the port.
- **Redis** — put credentials in `REDIS_URL`
  (`redis://user:password@host:6379`), and do not publish the port. The compose
  file binds it to `127.0.0.1` for this reason.
- **HTTPS** — terminate it at the proxy. Neither service does its own TLS.
- **CORS is not a setting, and does not need to be one.** The API sends no
  cross-origin headers when `NODE_ENV=production`
  (`origin: false`, `apps/api/src/index.ts`), which is correct for the only
  topology this app ships: the browser talks to `apps/web`, and
  `app/api/[...path]/route.ts` forwards to the API server-side, so no
  cross-origin request is ever made. Pointing a browser directly at the API is
  therefore not a supported deployment — it fails with no CORS headers at all,
  and the fix is `API_ORIGIN`, not a CORS allowlist.

## Performance Tuning

### Cache TTLs

Search and paper details are cached differently, and only the paper cache has
levels. Keeping that straight is the difference between "L1" meaning something
and it meaning "the fast one".

**Search is cached in three in-process stages**, each keyed on what decides it:

| Cache | Holds | Keyed on | TTL |
|---|---|---|---|
| Fan-out (`orchestrator/provider-cache.ts`) | what each provider returned | provider, native query, depth | 10 min |
| Result sets (`orchestrator/result-set.ts`) | the set a search resolved to — merged, ranked, gated, rescued, faceted | query and filters, never page or sort | 30 min |
| Authority answers (`orchestrator/authority-cache.ts`) | what Unpaywall, Crossref and the rest said about a DOI | authority and DOI | 1 hour |

Every page and sort of a search is a slice of one held set, which is what keeps
`total` and the page boundaries fixed while a reader pages. They used not to
be: each page resolved the set again, and the rescue — which runs against a
wall-clock budget — reached a different number of papers each time. Presenting
a page is then a sort, a slice and twenty enrichments answered from the
authority cache. A set that reported itself `complete: false` is not held, and
is sent with `no-store`, so a retry reaches the provider that failed.

Search used to have a per-page response cache in Redis as well. It went because
it could not be kept consistent with the sets: a page computed from one set
could outlive it by up to an hour and sit beside pages from the next. So a
restart starts search cold, and two API instances each hold their own sets.

**Paper details** (`apps/api/src/lib/cache-manager.ts`) are cached in two
levels — L1 in memory in front of L2 in Redis — for 10 minutes and 2 hours,
fixed in `STRATEGY_CONFIGS`, deliberately not configurable, because a TTL that
can be set per deployment is a TTL nobody can reason about from the code.

What is tunable is how much may be *held*: `CACHE_MAX_BYTES` for the
paper cache's L1 and `PROVIDER_CACHE_MAX_BYTES` for the fan-out, each counting
serialised bytes. Plus `CACHE_REDIS_COOLDOWN_MS`, which is how long L2 stays
shut after Redis has failed. `POST /api/cache/clear` empties all of them.

### Connection Pools

Increase for high-traffic scenarios:

```env
HTTP_POOL_MAX_SOCKETS=200
```

`HTTP_POOL_MAX_CONNECTIONS` and `HTTP_POOL_ENABLE_HTTP2` are gone. Nothing ever
applied either — `HTTP_POOL_MAX_SOCKETS` is the connection cap, and the
upstream clients speak HTTP/1.1 — and the API says so at startup if one is
still set.

