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
            ├── Search, in process: fan-outs · result sets · authority answers
            └── Paper details: L1 memory, bounded in bytes · L2 Redis
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

Search is cached in process, in three stages — what each provider returned
(`ProviderCache`), the result set each search resolved to (`ResultSetCache`),
and what each authority said about each DOI (`AuthorityFactsCache`). The set is
the one that matters for correctness: every page and sort of a search is a
slice of one held set, so `total` and the page boundaries stay fixed while a
reader pages. See `docs/configuration.md` for their keys and lifetimes.

Paper details are cached in two levels, keyed as
`namespace:hash(subject):hash(variant)`:

- **L1, in memory** — bounded in *bytes* (`CACHE_MAX_BYTES`, 256 MB by
  default), least-recently-used, spending expired entries before live ones. It
  stores serialised values and parses on read, so a caller cannot mutate what
  the next reader gets.
- **L2, Redis** — walked with `SCAN`, never `KEYS`, and every key carries an
  `oae:` prefix, so clearing the cache removes this service's entries and not
  whatever else shares the database.

`invalidate(namespace, subject)` returns how many entries it removed.

## Data Flow

### Search Request

```
1. Client → API: POST /api/v2/search (or /api/search, for OARecords)
2. Identical requests already running are joined (single-flight)
3. The result set for this query and filters: held, or resolved —
   plan → fan out → merge → match → rank → filter → rescue → facet —
   and held if every provider answered
4. One page of it: sort → paginate → enrich
5. Paper[] → SearchResponseV2, or flattened to SearchResponse for version 1
```

Step 3 is where the cache is, and what it holds is the set, not a page. Page
and sort are not part of its key, so every page of a search slices the same
set and reports the same total — which it did not while each page was resolved
on its own, because the rescue in step 3 runs against a wall clock.

It is conditional for the reason the response carries `complete` at all. The
report says what each provider was asked, what it returned, and whether it
failed, timed out or was skipped; `complete` is false when one failed, which
makes `total` a lower bound. A set in that state is returned but not held — a
provider's bad minute is not worth serving for the next half hour, and serving
it is what left the frontend's retry answered from the entry it was trying to
get past.

The exception is a provider that refused the query outright — HTTP 400 or 422,
read from the status its error carries. A retry meets the same refusal, so
declining to hold the set bought nothing and cost a fan-out on every page, with
`total` moving as the reader paged; that set is held, and still reported
`complete: false`. A provider whose translation of the query comes out empty —
a wildcard its API cannot run — is not asked at all, and is reported `skipped`.

### Paper Details

```
1. Client → API: GET /api/v2/paper/:id (or /api/paper/:id, for an OARecord)
2. Check cache, by the id that was asked for
3. lookupPaper: split `source:nativeId`, ask that provider for that record
4. Ask the authorities about that one record
5. Cache the Paper, and return it — flattened for version 1
```

Step 4 is `enrichPage` pointed at a single paper, which is the same step the
search path runs over a page of twenty. A record reached this way came from one
provider and has been through no merge, so it carries only what that provider
said — the endpoint returned a thinner record than the search results it was
opened from.

Step 2 used to read "by id and then by DOI". The DOI probe was gated on
`id.includes('10.')`, which is true of any arXiv id from 2010 on, so ordinary
requests spent a Redis round trip on a key only a bare DOI could match — and a
bare DOI is not resolvable here anyway, because `splitPaperId` finds no provider
prefix. While an entry happened to be cached the URL answered 200, and 404 once
it expired. Asking about a DOI is what `POST /api/search` with `{ doi }` is for.

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
