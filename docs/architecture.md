# Architecture

## Overview

Open Access Explorer is a monorepo: a Next.js frontend, a Fastify API, and a
shared package holding the types both speak.

## System Architecture

```
┌─────────────┐
│   Next.js   │  Frontend (Port 3000)
│   Frontend  │
└──────┬──────┘
       │ HTTP, through app/api/[...path] so the origin is a runtime value
       ▼
┌─────────────┐
│   Fastify   │  API Server (Port 4000)
│     API     │
└──────┬──────┘
       │
       ├──► Orchestrator
       │    plan → fan out → merge → rank → filter → rescue
       │    → facet → paginate → enrich
       │
       ├──► Providers — sources of results
       │    arXiv · bioRxiv · CORE · DataCite · DOAJ
       │    Europe PMC · PubMed · OpenAIRE · OpenAlex · PLOS
       │
       ├──► Authorities — consulted about records, never a source of them
       │    Crossref · OpenAlex · OpenCitations · Unpaywall
       │
       └──► Cache
            ├── L1 memory, bounded in bytes
            └── L2 Redis
```

## Core Components

### Orchestrator

`apps/api/src/orchestrator/` runs every search, in this order:

1. **Plan** — which providers can serve this query, from their declared
   capabilities. A provider that cannot is skipped with a reason, not guessed
   at.
2. **Fan out** — one request per planned provider, in parallel, each with the
   orchestrator's timeout rather than its own.
3. **Merge** — deduplicate by DOI, then by an identity key, keeping every
   provider that saw the paper in `sources`.
4. **Rank** — rank fusion over each provider's own ordering, so no single
   provider owns the page.
5. **Filter** — the user's facet selections, plus the open-access policy.
6. **Rescue** — the policy gate reads `fullText`, `oaStatus` and `stage`, and
   the authorities fill all three, so a paper failing it has been judged on
   what the providers happened to say rather than on what is knowable. The
   papers the gate would drop are asked about first — bounded in number, only
   those carrying a DOI, and only the authorities authoritative on a gated
   field. Those that come back with a copy rejoin the set at the rank they
   already had.
7. **Facet** — computed over the filtered set, so a bucket count is exactly how
   far selecting it narrows the page.
8. **Paginate**, then **enrich** the page — and only the page, because the
   authorities are per-DOI lookups.

The order is load-bearing: ranking after pagination ranks a page, ranking
before dedupe ranks duplicates, and faceting before filtering describes a set
the caller never sees. The rescue sits before faceting for the same reason
faceting sits after filtering — counting a set the caller will not see, or
excluding a paper without asking the question that decides it, are the same
mistake.

### Providers

Each provider is a directory under `apps/api/src/providers/` with four parts,
so that the only impure one is isolated:

| File | Role |
| --- | --- |
| `capabilities.ts` | What this API can do — checkable against its documentation |
| `translate.ts` | `Query` → the provider's native query. Pure. |
| `fetch.ts` | The one piece of I/O |
| `normalize.ts` | Payload → `Paper[]`, plus what it had to skip and why |

`orchestrator/registry.ts` is the list of them and how to drive each one.

### Authorities

`apps/api/src/authorities/` holds the services consulted *about* a record —
Crossref, OpenAlex, OpenCitations and Unpaywall. They are kept apart from
providers because an authority never adds a paper: it fills fields on papers
that were already going to be returned, and every field it supplies is recorded
in `fieldSources`. An authority failing does not make a search incomplete; a
provider failing does.

### Rescue

`apps/api/src/orchestrator/rescue.ts` is the one place enrichment is paid for
before pagination, and it exists because the alternatives are both wrong.
Enriching the whole filtered set is one request per record — a measured set of
2,388 records is 2,388 requests per authority — and enriching only the page
means the gate drops papers nobody ever asked about.

The bound is `SEARCH_RESCUE_LIMIT` candidates, in rank order, independent of
the requested page so `total` does not shift as the reader walks through the
results. Anything past it is dropped exactly as before, and `RescueReport`
says so. The step can only ever add papers back.

Lookups are shared with the page enrichment through `AuthorityCache`, a
per-search memo of `(authority, DOI) → facts`, so a rescued paper that lands on
the visible page is not asked about twice.

### Caching

Two levels, both keyed as `namespace:hash(subject):hash(variant)` so every
page, sort and filter of one query sits under a prefix the query itself
derives:

- **L1, in memory** — bounded in *bytes* (`CACHE_MAX_BYTES`, 256 MB by
  default), least-recently-used, spending expired entries before live ones. It
  stores serialised values and parses on read, so a caller cannot mutate what
  the next reader gets.
- **L2, Redis** — walked with `SCAN`, never `KEYS`.

`invalidate(namespace, subject)` returns how many entries it removed.

## Data Flow

### Search Request

```
1. Client → API: POST /api/search
2. Cache lookup: exact key, then a similar one
3. On a miss, one fan-out per key however many callers are waiting (single-flight)
4. Orchestrator: plan → fan out → merge → rank → filter → rescue → facet →
   paginate → enrich
5. Paper[] → SearchResponse, and the result is cached
```

The response carries a `providers` report — what each one was asked, what it
returned, and whether it failed, timed out or was skipped — and `complete`,
which is false when a provider failed, making `total` a lower bound.

### Paper Details

```
1. Client → API: GET /api/paper/:id
2. Check cache, by id and then by DOI
3. lookupPaper: split `source:nativeId`, ask that provider for that record
4. Cache and return
```

Step 3 is one question with two answers, decided by the provider's API rather
than by preference: a by-id endpoint where there is one (OpenAlex, DOAJ,
OpenAIRE, CORE), and otherwise the provider's search — which for bioRxiv,
DataCite and PLOS is a DOI lookup, because their native ids *are* DOIs.

## Performance

- **HTTP connection pooling** for the providers that get asked most.
- **Single-flight** — concurrent identical searches share one fan-out.
- **Provider cache** — what each provider returned, so a page-2 click reuses
  the fan-out rather than repeating it.
- **Per-provider timeouts**, owned by the orchestrator, so one slow provider
  degrades the result rather than the request.

## Scalability

- **Horizontal scaling**: no in-process state whose mutation changes an answer.
- **Cache distribution**: Redis.
- **Load balancing**: ready for multiple API instances.
