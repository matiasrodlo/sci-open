# API Reference

## Base URL

```
Development: http://localhost:4000
Production: https://api.yourdomain.com
```

## Endpoints

### Search

**POST** `/api/search`

Search for papers across multiple sources.

#### Query syntax

`q` takes the Web of Science grammar. A plain search still works — `crispr gene
editing` means all three words — and a query copied out of Web of Science means
here what it meant there.

| Tag | Searches |
|---|---|
| `TS=` | Topic: title, abstract and keywords. The default for an untagged word. |
| `TI=` | Title |
| `AB=` | Abstract |
| `AU=` | Author |
| `SO=` | Publication name |
| `PU=` | Publisher |
| `PY=` | Year, as `2020` or a range `2020-2024`, `2020-`, `-2024` |
| `DO=` | DOI |
| `ALL=` | Every field |

`AND`, `OR` and `NOT` combine clauses, brackets group them, and a tagged group
passes its tag to its members. Precedence is Web of Science's: `OR` loosest,
then `AND`, then `NOT`, then brackets. Two clauses with nothing between them
mean `AND`.

```
TS=(crispr OR cas9) NOT AU=Doudna
AU=(Doudna OR Charpentier) AND PY=2020-2024
TI="gene editing" AND SO=Nature
```

Quoted text is a phrase — the same words, adjacent and in order — except after
`AU=`, where it is a name and its order does not matter (see below). `*` stands for
the rest of a word and `?` for one character, both within a single word:
`gen*` matches "genome", `gen?` matches "gene" but not "genome".

`NEAR` and `SAME` are **rejected**, with a message saying so. They are proximity
operators, no source here can express one, and no record retains the token
positions that would be needed to apply one locally — so accepting them would
mean running a query other than the one written.

A tag this list does not name is an ordinary word, which is what keeps a pasted
URL or a term like `BRCA1:c.68` searchable rather than a syntax error.

#### Search history and set combining (`#1 AND #2`)

The web app numbers every search of a session and lets you combine the numbers,
as Web of Science does. It is a *query* algebra rather than a set algebra:
`#1 AND #2` means "the query that was #1, and the query that was #2", not "the
records each returned, intersected".

**This endpoint never sees a `#N`.** There are no accounts here and no store to
keep a history in, so it lives in the browser, and the reference is expanded
before the request is made — `#1 AND #2` arrives as
`q=(AU=Doudna) AND (TS=cas9)`. That is deliberate rather than incidental: a URL
carrying `#1` would mean something different to every reader who opened it and
nothing at all once the session ended, so a shared link to a search would
quietly become a different search.

A caller using this API directly therefore composes queries by writing them out,
which is what the expansion produces anyway. Each substitution is bracketed,
because `#1` standing for `a OR b` has to mean `(a OR b) AND …`.

#### How the query is applied

Worth knowing, because it explains a result count that looks generous.

No source can run this grammar as written: OpenAIRE has no query language,
OpenAlex has no filter key for `SO=` or `PU=`, arXiv's negation is a different
shape, and no two index the same text under "title". So each source is sent as
much of the query as it can express — and where it cannot express something, it
is sent a **wider** query rather than a narrower one. The full query is then
applied to the merged records.

A source that can express *nothing* of a query is not asked, and the response
says so rather than reporting it as having matched nothing — `AU=Doudna` goes
to the five sources with an author index and skips OpenAIRE, which has none.

That last step only ever removes records, and it removes only the ones it can
positively rule out. A record whose abstract this service never received is not
excluded by an `AB=` clause it cannot be tested against, and a topic word absent
from the stored title and abstract is not taken as proof — the source matched it
against indexes, like MeSH headings and full text, that are not reproduced here.

An author is matched whichever order and punctuation a source wrote the name
in. A quoted author — `AU="Doudna, Jennifer"`, which is how a Web of Science
author search is written, and how the web app links a name — is a name rather
than a run of words: each of its words has to be in one author's name, in any
order, or where the record gives it only as an initial, that initial, so
"Doudna JA" matches. Initials in the query are used only where no forename is
given — `AU="Doudna J"` needs a forename or initial beginning with J — because
sources disagree on them more than on anything else. Unquoted,
`AU=Jennifer AND AU=Doudna` asks for the two words anywhere in the author list,
which two co-authors can satisfy between them.

To the sources, each name is sent in whatever form their index finds people
by. Europe PMC and PubMed keep authors as names and match a lone word only as
a surname, so they are sent the words as one name; OpenAlex, DOAJ, PLOS and
HAL keep them word by word, so they are sent the words of a quoted name. Either is
added beside what was asked rather than put in its place: two co-authors
searched as `AU=Doudna AND AU=Charpentier` still find the papers they wrote
together.

**Request:**
```json
{
  "q": "machine learning",
  "filters": {
    "source": ["arxiv", "core"],
    "yearFrom": 2020,
    "yearTo": 2024,
    "oaStatus": ["published"]
  },
  "page": 1,
  "pageSize": 20,
  "sort": "relevance"
}
```

**Response:**
```json
{
  "hits": [
    {
      "id": "arxiv:2301.12345",
      "title": "Paper Title",
      "authors": ["Author One", "Author Two"],
      "year": 2023,
      "doi": "10.1234/example",
      "source": "arxiv",
      "abstract": "...",
      "bestPdfUrl": "https://...",
      "citationCount": 42
    }
  ],
  "facets": {
    "source": {
      "arxiv": 150,
      "core": 89
    },
    "year": {
      "2023": 120,
      "2024": 119
    }
  },
  "page": 1,
  "total": 239,
  "pageSize": 20
}
```

**Headers:**
- `X-Cache-Hit`: `true` when the search's result set was held, so this page
  is a slice of the set earlier pages came from; `false` when it was resolved
  for this request; `coalesced` when an identical request was already running
- `X-Response-Time`: milliseconds
- `Cache-Control`: `public, max-age=300`

**429** comes from either of two budgets, both per window and per caller:
`RATE_LIMIT_MAX` for every request, and `RATE_LIMIT_NEW_SEARCH_MAX` for a
search that resolves a result set of its own — a new query or a new filter,
where paging, re-sorting or joining an identical search already running does
not count. The second answers with `Retry-After` and an `error` beginning "Too
many new searches". See `docs/configuration.md`.

---

### Search, version 2

**POST** `/api/v2/search`

The same request body as `/api/search`, answered with the papers as the
pipeline holds them rather than flattened to `OARecord`. Version 1 keeps one
source of the several that returned a paper, reports the publication stage
under the name `oaStatus`, reduces a copy to a URL, and cuts each provider's
report down to two counts; version 2 returns the `Paper` itself — every
source, the access route and the stage separately, whether a copy was
confirmed, which source supplied each field — and the reports whole.

Both versions are answered from one run, joined under one key and sliced from
one held result set, so a v1 and a v2 request for the same search share the
work and cannot disagree. `X-Cache-Hit` means the same thing on both.

The web app reads this version. Version 1 stays for other clients.

**Response:**
```typescript
{
  papers: Paper[];                // see packages/shared/src/paper.ts
  total: number;                  // the same for every page of a search
  page: number;
  pageSize: number;
  sort: SearchSort;
  filters?: SearchFilters;        // echoed when the request set them
  facets: Record<string, Array<{ value: string | number; count: number; from?: ProviderId }>>;
  complete: boolean;              // false when a provider failed or timed out
  bounded: boolean;               // true when the rescue pass was cut short
  countsFromSources: boolean;
  providers: ProviderReport[];    // status, retrieved, totalHits, latency, error, refused, skipReason, facetError
  authorities: AuthorityReport[]; // asked, answered, applied — for this page
  duration: number;
}
```

A `Paper`'s `oaStatus` is the access route in Unpaywall's vocabulary — `gold`,
`green`, `hybrid`, `bronze`, `closed` or `unknown` — and `stage` is which
version it is. In version 1 the field called `oaStatus` holds the stage.

### Paper Details

**GET** `/api/paper/:id`

Get detailed information about a specific paper.

**Parameters:**
- `id`: the identifier a search result carries, `source:nativeId` — the same
  string as `OARecord.id`. A bare arXiv identifier is also accepted.

The id names the one provider that owns the record, and it is the only one
asked. Which request that becomes depends on that provider's API: OpenAlex,
DOAJ, OpenAIRE and CORE have a by-id endpoint, and HAL is asked for the id on
its own field; the rest are asked through their search, which for bioRxiv, DataCite and PLOS is a DOI lookup because their
native ids *are* DOIs. A record that comes back under a different id is not the
one that was asked for, and the answer is 404 rather than that record.

The record is then enriched by the same authorities the search path asks about
its page — Unpaywall, Crossref and OpenCitations — so a paper reached by a
shared link carries the same access route, verified copy and citation count as
one reached by clicking a search result. A record with no DOI is returned as the
provider gave it, since there is nothing to look up; an authority that fails or
runs out of budget costs its own contribution and not the response. Enrichment
runs only on a cache miss.

**Response:** an `OARecord`, and nothing wrapping it.

```json
{
  "id": "arxiv:2301.12345",
  "title": "Paper Title",
  "authors": ["Author One"],
  "year": 2023,
  "doi": "10.1234/example",
  "abstract": "...",
  "source": "arxiv",
  "sourceId": "2301.12345",
  "bestPdfUrl": "https://arxiv.org/pdf/2301.12345.pdf",
  "landingPage": "https://doi.org/10.1234/example"
}
```

`bestPdfUrl` is absent when no copy is known — there is no `pdf` object and no
status field. This response has never had one; the shape documented here until
phase 13 described a `{ record, pdf }` wrapper the endpoint never returned, and
a frontend that believed it crashed on every record without a PDF.

**404** when the provider has no such record. **504** when the provider was
too slow to answer and **502** when it failed — a provider that could not be
asked is not a missing paper, and the two are not reported the same way.
**500** is kept for a fault of this service's own.

### Paper Details, version 2

**GET** `/api/v2/paper/:id`

The same lookup as `/api/paper/:id`, answered with the `Paper` rather than
flattened to an `OARecord` — the shape a version 2 search returns its papers
in, so a result and its detail page are one type. Both versions are answered
from one cached record, so they cannot disagree, and `X-Cache-Hit` means the
same thing on both.

`sources` holds the one provider the id belongs to, since that is the only one
asked: a search result that several providers returned lists them all, and its
detail record lists the one that owns its id.

**Response:** a `Paper`, and nothing wrapping it. Errors as for version 1.

---

### PDF Download

**GET** `/api/papers/:id/pdf`

Streams a paper's PDF through the API and returns it as an attachment.
Publishers rarely allow a cross-origin fetch from the browser, which is the
reason this proxy exists rather than the client fetching the file directly.

`:id` is the paper id, as for `/api/paper/:id`. The address fetched is the
`bestPdfUrl` of the record that route returns — the caller never names a URL.
The download used to be `POST /api/download-pdf` with a `pdfUrl` in the body,
which fetched whatever it was given; it is gone.

**Response:** the PDF bytes, with `Content-Type: application/pdf`,
`Cache-Control: private, max-age=3600`, and a `Content-Disposition: attachment`
named after the paper's title (`filename*` carries the title as written).

The address is resolved and checked before anything is fetched, and again on
each redirect, so a record naming an internal address cannot reach the
internal network:

| | |
|---|---|
| **404** | No paper has that id, or none of the sources knows a copy of it |
| **502 / 504** | The provider holding the paper failed or was too slow, as for `/api/paper/:id` |
| **400** | The record's address is not a valid URL, or its host would not resolve |
| **403** | It resolves to a non-public address, a redirect left http/https, or the publisher refused the request |
| **404** | The publisher has no PDF at that address |
| **413** | Larger than the download limit |
| **415** | Upstream served something that is not a PDF |
| **502** | Upstream could not be fetched, or answered with anything else |

The check is applied again to each redirect, not only to the URL supplied.

`403` and `404` are the two upstream answers reported as themselves, because
they are the two a caller acts on differently: `404` says the record's
address is wrong and the file is not there, `403` says the file is there
and this proxy is not allowed to fetch it — bot protection, which the reader's
own browser may well get past. Every other upstream status is a `502`,
including an upstream `429`: this endpoint answers with `429` when *the caller*
has asked too often, and only that one is fixed by the caller waiting.

**HEAD** answers `405` with `Allow: GET`. There is no way to say whether the
file is there, or how large it is, without fetching it from the publisher, and
Fastify's automatic HEAD route did exactly that: it fetched the whole file and
discarded it, under a rate-limit bucket separate from the download's.

---

### Health Check

**GET** `/health`

Returns server status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

---

### Cache Management

> Requires `Authorization: Bearer $ADMIN_API_KEY`. Returns `401` without a
> valid key, or `503` when `ADMIN_API_KEY` is unset. See
> [Configuration](./configuration.md#administrative-access). Served by the API
> only — the web app does not forward these routes, so call the API directly.


**POST** `/api/cache/clear`

Clear all caches.

**GET** `/api/cache/metrics`

Cache hit/miss counts and response times.

---

### Performance

> Requires `Authorization: Bearer $ADMIN_API_KEY`. Returns `401` without a
> valid key, or `503` when `ADMIN_API_KEY` is unset. See
> [Configuration](./configuration.md#administrative-access).


**GET** `/api/performance/metrics`

Aggregate HTTP client metrics across all upstream hosts, sampled every 30
seconds. Every attempt is counted once, retries included, by how it ended —
succeeded, client error, rate limited (429), server error, failed with no
answer, or aborted by this service's own budget. `errorRate` is the share the
upstream did not serve: rate limits, server errors and failures. Connection
reuse is what Node reports for the socket each answer came on.

**GET** `/api/performance/metrics/:service`

Metrics for one host.

**GET** `/api/performance/sources`

What the pipeline got out of each source, from the reports every search
writes: per provider, how many searches it answered, timed out on, failed or
was skipped for, the p50 and p95 of its recent latencies, and its last error;
per authority, the same plus how many DOIs it was asked about, how many it
answered, and how many fields those answers filled. A provider is counted once
per result set resolved, not once per page served from a held set.

**GET** `/api/performance/report`

A rendered summary of the HTTP metrics.

---

## Data Models

### OARecord

```typescript
{
  id: string;                    // Stable identifier
  doi?: string;                   // Digital Object Identifier
  title: string;                  // Paper title
  authors: string[];              // Author names
  year?: number;                  // Publication year
  venue?: string;                 // Journal/conference
  abstract?: string;              // Abstract text
  source: string;                 // Source identifier
  sourceId: string;               // Source-specific ID
  oaStatus?: "preprint" | "accepted" | "published" | "other";
  bestPdfUrl?: string;            // Direct PDF link
  landingPage?: string;            // Canonical page URL
  topics?: string[];              // Subject keywords
  language?: string;              // Paper language
  citationCount?: number;         // Citation count
  createdAt: string;              // ISO timestamp
  updatedAt?: string;             // ISO timestamp
}
```

### SearchParams

```typescript
{
  q?: string;                     // Query string
  doi?: string;                   // DOI lookup
  filters?: {
    source?: string[];
    yearFrom?: number;
    yearTo?: number;
    oaStatus?: string[];
    venue?: string[];
    topics?: string[];
  };
  page?: number;                  // Page number (default: 1)
  pageSize?: number;             // Results per page (default: 20)
  sort?: "relevance" | "date" | "date_asc" | "citations" | ...;
}
```

### SearchResponse

```typescript
{
  hits: OARecord[];               // Search results
  facets: Record<string, any>;    // Facet counts
  page: number;                   // Current page
  total: number;                  // Size of the filtered set
  pageSize: number;               // Page size
  complete?: boolean;             // False when a provider failed or timed out
  bounded?: boolean;              // True when the rescue pass was cut short
}
```

`total` is an answer only when `complete` is not `false` and `bounded` is not
`true`. They are separate because the causes are: `complete: false` means a
source did not answer, so papers are missing from the hits and the facets;
`bounded: true` means every source answered but the rescue could not ask about
every paper the open-access gate would drop, so some were dropped without being
looked up. Either one makes `total` a lower bound.

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "requestId": "req-42"
}
```

A query the grammar could not parse answers `400` and adds the offset it stopped
at, so a caller can point at the character:

```json
{
  "error": "Unbalanced (",
  "requestId": "req-42",
  "position": 3
}
```

The message is returned in full for this case and for PDF-proxy refusals,
because both describe the request. Everything else answers with a generic
message and the request id, which is what lets an operator find the real error
in the log without publishing it.

**Status Codes:**
- `200` - Success
- `400` - Bad Request, including a query that would not parse
- `500` - Internal Server Error

