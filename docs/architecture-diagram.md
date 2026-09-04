# Architecture Diagram

Mermaid diagrams of the whole application. The fenced blocks below render
directly in GitHub, VS Code, and most Markdown viewers.

Standalone SVG renders live in [`diagrams/`](./diagrams):

| Diagram | SVG |
| --- | --- |
| System map | [`diagrams/system-map.svg`](./diagrams/system-map.svg) |
| Search request flow | [`diagrams/search-flow.svg`](./diagrams/search-flow.svg) |
| Paper detail and PDF download | [`diagrams/paper-pdf-flow.svg`](./diagrams/paper-pdf-flow.svg) |
| Repository layout | [`diagrams/repo-layout.svg`](./diagrams/repo-layout.svg) |

Regenerate them after editing a block below:

```bash
npx -p @mermaid-js/mermaid-cli mmdc -i docs/architecture-diagram.md -o docs/diagrams/out.svg -b white
```

## 1. System map

```mermaid
flowchart TB
  USER(["User's browser"])

  %% ============ FRONTEND ============
  subgraph WEB["apps/web — Next.js 14 · port 3000"]
    direction TB

    subgraph PAGES["App Router"]
      HOME["/ — HomePage<br/>hero + search entry"]
      RESULTS["/results — search results<br/>server component"]
      PAPERPG["/paper/:id — paper detail"]
      PROXY["/api/:path* — route handler<br/>resolves API_ORIGIN per request"]
      LAYOUT["layout.tsx — shell + Tailwind"]
    end

    subgraph COMPS["Components"]
      SBAR["AdvancedSearchBar — the query box"]
      FACET["FacetPanel → FacetGroup · SortBar · Pagination"]
      RLIST["PaginatedResults · ResultCard<br/>LoadingSkeleton · EmptyState"]
      COVER["ProviderCoverage<br/>per-provider status · degradation notice"]
      EXPORTUI["ExportButton · WoSExportDialog"]
      PDETAIL["PaperHeader · PaperAbstract · PaperMetadata<br/>PaperActions · PaperCitations · RelatedPapers"]
      UIKIT["ui/ — shadcn primitives"]
    end

    subgraph WEBLIB["lib/"]
      FETCH["fetcher.ts — the only place an API origin is decided"]
      PCACHE["paper-cache.ts — client-side cache"]
      CITE["bibtex.ts · citations.ts — BibTeX and RIS"]
      SPARAMS["search-params.ts — repeated params, not comma-joined"]
    end
  end

  %% ============ API ============
  subgraph API["apps/api — Fastify · port 4000"]
    direction TB

    PLUGINS["@fastify/cors · @fastify/helmet · @fastify/rate-limit"]

    subgraph ROUTES["Routes — src/index.ts, registered as a plugin"]
      direction TB
      subgraph PUBROUTES["Public"]
        R_SEARCH["POST /api/search"]
        R_PAPER["GET /api/paper/:id"]
        R_PDF["POST /api/download-pdf"]
        R_HEALTH["GET /health"]
      end
      GATE{{"adminOnly<br/>Bearer ADMIN_API_KEY<br/>fails closed when unset"}}
      subgraph ADMROUTES["Administrative"]
        R_CACHE["/api/cache/metrics · /clear"]
        R_PERF["/api/performance/*"]
      end
      GATE --> ADMROUTES
    end

    subgraph ORCH["Orchestrator — src/orchestrator/"]
      direction TB
      O1["parseQuery → Query AST"]
      O2["plan<br/>capabilities decide who is asked"]
      O3["fanOut<br/>parallel · per-provider timeout · ProviderReport"]
      O4["mergePapers<br/>dedupe by DOI, then identity key"]
      O5["rank<br/>rank fusion over each provider's order"]
      O6["applyPolicy → sortPapers → generateFacets → paginate"]
      O7["enrichPage<br/>the page only, because authorities are per-DOI"]
      O8["toSearchResponse<br/>Paper[] → the wire contract"]
      LOOKUP["lookupPaper<br/>one record, by the id results carry"]
    end

    PCACHE2["ProviderCache<br/>what each provider returned, across requests"]
    FLIGHT["SingleFlight<br/>concurrent identical searches share one fan-out"]
    PDFPROXY["pdf-proxy.ts<br/>SSRF guard + stream"]
    PERFMON["httpPerformanceMonitor<br/>read by the admin routes only"]
    HTTPF["http-client-factory<br/>keep-alive pooling · http-pool-config"]
  end

  %% ============ CACHE ============
  subgraph CACHE["Cache — src/lib/cache*"]
    direction TB
    CM["CacheManager<br/>key: namespace:hash(subject):hash(variant)"]
    L1[("L1 · MemoryCache<br/>bounded in bytes, LRU")]
    L2[("L2 · Redis<br/>ioredis, walked with SCAN")]
    SCM["SearchCacheManager<br/>one key per request<br/>a degraded answer is not stored"]
    PCM["PaperCacheManager<br/>by id and by DOI"]
  end

  %% ============ SHARED PACKAGES ============
  subgraph PKGS["packages/"]
    SHARED["shared — Paper · Query · ProviderCapabilities<br/>ProviderReport · OARecord adapters"]
  end

  %% ============ EXTERNAL ============
  subgraph PROVIDERS["Providers — src/providers/ · sources of results"]
    direction LR
    S_ARXIV["arXiv"]
    S_EPMC["Europe PMC"]
    S_NCBI["PubMed"]
    S_DOAJ["DOAJ"]
    S_PLOS["PLOS"]
    S_OPENAIRE["OpenAIRE"]
    S_CORE["CORE"]
    S_BIO["bioRxiv / medRxiv"]
    S_DATACITE["DataCite"]
    S_OPENALEX["OpenAlex"]
  end

  subgraph AUTHORITIES["Authorities — src/authorities/ · asked about a record"]
    direction LR
    A_CR["Crossref"]
    A_UP["Unpaywall"]
    A_OA["OpenAlex"]
    A_OC["OpenCitations"]
  end

  subgraph INFRA["Infrastructure — docker-compose.yml"]
    REDIS[("Redis 7")]
  end

  PUBLISHERS[["Publisher / repository PDF hosts"]]

  %% ---- edges: user → web ----
  USER --> HOME
  USER --> RESULTS
  USER --> PAPERPG

  HOME --> SBAR
  RESULTS --> SBAR
  RESULTS --> FACET
  RESULTS --> RLIST
  RESULTS --> COVER
  RESULTS --> EXPORTUI
  PAPERPG --> PDETAIL
  RLIST -.-> UIKIT
  FACET -.-> UIKIT
  FACET --> SPARAMS

  SBAR --> FETCH
  RLIST --> FETCH
  PDETAIL --> FETCH
  PAPERPG --> PCACHE
  PCACHE --> FETCH
  EXPORTUI --> CITE

  FETCH -->|"relative in the browser"| PROXY
  PROXY ==>|HTTP| ROUTES

  %% ---- edges: routes → internals ----
  PLUGINS -.-> ROUTES
  R_SEARCH --> SCM
  R_SEARCH --> FLIGHT
  FLIGHT --> O1
  R_PAPER --> PCM
  R_PAPER --> LOOKUP
  R_PDF --> PDFPROXY
  R_CACHE --> CM
  R_PERF --> PERFMON

  %% ---- orchestrator internal order ----
  O1 --> O2 --> O3 --> O4 --> O5 --> O6 --> O7 --> O8

  O3 --> PCACHE2
  O3 --> PROVIDERS
  O7 --> AUTHORITIES
  LOOKUP -->|"by-id endpoint, or the provider's search"| PROVIDERS

  PROVIDERS --> HTTPF
  AUTHORITIES --> HTTPF
  HTTPF --> PERFMON
  PDFPROXY --> PUBLISHERS

  %% ---- cache wiring ----
  SCM --> CM
  PCM --> CM
  CM --> L1
  CM --> L2
  L2 --- REDIS

  %% ---- packages / infra ----
  SHARED -.->|types| WEB
  SHARED -.->|types| API

  %% ---- styling (stroke only, so it reads in light and dark) ----
  classDef page stroke:#2563eb,stroke-width:2px
  classDef store stroke:#7c3aed,stroke-width:2px
  classDef core stroke:#dc2626,stroke-width:2px
  class HOME,RESULTS,PAPERPG page
  class L1,L2,REDIS store
  class O4,O5,O7 core
```

**Providers and authorities are different kinds of thing**, which is why they
are separate boxes. A provider answers a query with records. An authority is
asked about a record that is already in hand, and never adds one — so an
authority failing leaves the result set whole, while a provider failing makes
`total` a lower bound and the response says so.

`plan` decides who is asked, from declared capabilities rather than from a
score. bioRxiv has no keyword index — its API scans a date window — so it is
skipped for keyword searches and answers DOI lookups in full; the response
lists it under "not searched for this query" rather than as a failure. DataCite
is skipped on the same kind of evidence.

## ## 2. Search request flow

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant N as Next.js /results
    participant F as Fastify POST /api/search
    participant SC as SearchCacheManager
    participant CM as CacheManager L1-L2
    participant SF as SingleFlight
    participant OR as Orchestrator
    participant P as Providers
    participant AU as Authorities

    U->>N: /results?q=...&venue=A&venue=B&page=1
    N->>F: POST /api/search {q, filters, sort, page}
    F->>SC: getCachedSearchResults(q, params)
    SC->>CM: get(key)
    CM-->>SC: hit / miss

    alt cache hit
        SC-->>F: SearchResponse
        F-->>N: 200 · X-Cache-Hit: true
    else cache miss
        F->>SF: run(key, …) — one fan-out however many callers wait
        SF->>OR: runOrchestrator(params)
        OR->>OR: parseQuery → Query AST
        OR->>OR: plan — capabilities decide who is asked
        OR->>P: fanOut, in parallel, per-provider timeout
        P-->>OR: Paper[] + ProviderReport per provider
        OR->>OR: merge → rank → filter → rescue → sort → facet → paginate
        OR->>AU: enrichPage — the returned page only
        AU-->>OR: fields, each attributed in fieldSources
        OR-->>SF: papers, facets, reports, complete
        SF->>SC: cacheSearchResults — stored only when complete
        F-->>N: 200 · X-Cache-Hit: false | coalesced
    end

    N-->>U: results, facets, and provider coverage
```

The single flight is around the whole miss, so the two waiters on one key share
the fan-out *and* the cache write. A miss costs tens of seconds across ten
providers, which is a wide window for duplicates.

`complete: false` reaches the page as a notice: a provider that failed makes
the count a lower bound, and one that was skipped is listed separately, because
declining to guess is not a failure.

## ## 3. Paper detail and PDF download

```mermaid
sequenceDiagram
    autonumber
    participant U as Browser
    participant P as /paper/:id
    participant F as Fastify
    participant PC as PaperCacheManager
    participant L as lookupPaper
    participant PR as The one provider that owns the id
    participant H as Publisher PDF host

    U->>P: open paper
    P->>P: lib/paper-cache lookup
    P->>F: GET /api/paper/:id
    F->>PC: getCachedPaper(id) / getCachedPaperByDoi
    alt hit
        PC-->>F: OARecord
    else miss
        F->>L: lookupPaper("source:nativeId")
        L->>L: split the id, find the provider in the registry
        alt the provider has a by-id endpoint
            L->>PR: lookup(nativeId)
        else it does not
            L->>PR: search(parseQuery(nativeId)) — a DOI lookup when the id is one
        end
        PR-->>L: Paper, or nothing
        L-->>F: only the record that was asked for
        F->>PC: cachePaperDetails
    end
    F-->>P: OARecord (or 404)

    U->>P: click Download PDF
    P->>F: POST /api/download-pdf {paperId, pdfUrl}
    F->>F: assertPublicHttpUrl — blocks private/internal targets
    F->>H: GET pdfUrl
    H-->>F: PDF stream
    F-->>U: application/pdf as attachment
```

Opening a paper triggers no search. `RelatedPapers` renders the topics already
on the record as links to the searches they stand for, rather than running a
second full fan-out to produce four of them.

## ## 4. Repository layout

```mermaid
flowchart LR
  ROOT["sci-open<br/>pnpm workspace + turbo"]
  ROOT --> APPS["apps/"]
  ROOT --> PKG["packages/"]
  ROOT --> DOCS["docs/"]
  ROOT --> DC["docker-compose.yml"]

  APPS --> W["web — Next.js<br/>app/ · components/ · lib/ · Dockerfile"]
  APPS --> A["api — Fastify<br/>src/index.ts · orchestrator/ · providers/<br/>authorities/ · lib/ · scripts/ · Dockerfile"]

  PKG --> SH["shared — types contract"]

  W -.->|"@open-access-explorer/shared"| SH
  A -.->|"@open-access-explorer/shared"| SH

  DC --> SVC["redis · api · web"]
```
