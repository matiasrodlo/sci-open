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

Quoted text is a phrase — the same words, adjacent and in order. `*` stands for
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
arXiv's negation is a different shape, and no two index the same text under
"title". So each source is sent as much of the query as it can express — and
where it cannot express something, it is sent a **wider** query rather than a
narrower one. The full query is then applied to the merged records.

That last step only ever removes records, and it removes only the ones it can
positively rule out. A record whose abstract this service never received is not
excluded by an `AB=` clause it cannot be tested against, and a topic word absent
from the stored title and abstract is not taken as proof — the source matched it
against indexes, like MeSH headings and full text, that are not reproduced here.

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
- `X-Cache-Hit`: `true` | `false` | `coalesced`
- `X-Response-Time`: milliseconds
- `Cache-Control`: `public, max-age=300`

---

### Paper Details

**GET** `/api/paper/:id`

Get detailed information about a specific paper.

**Parameters:**
- `id`: the identifier a search result carries, `source:nativeId` — the same
  string as `OARecord.id`. A bare arXiv identifier is also accepted.

The id names the one provider that owns the record, and it is the only one
asked. Which request that becomes depends on that provider's API: OpenAlex,
DOAJ, OpenAIRE and CORE have a by-id endpoint; the rest are asked through their
search, which for bioRxiv, DataCite and PLOS is a DOI lookup because their
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

**404** when the provider has no such record. **500** when the provider could
not be asked — a slow provider is not a missing paper, and the two are not
reported the same way.

---

### PDF Download

**POST** `/api/download-pdf`

Streams a PDF through the API and returns it as an attachment. Publishers
rarely allow a cross-origin fetch from the browser, which is the reason this
proxy exists rather than the client fetching the file directly.

**Request:**
```json
{
  "pdfUrl": "https://example.org/article.pdf",
  "paperId": "openalex:W2741809807"
}
```

`pdfUrl` is required and must be `http` or `https`. `paperId` is optional and
used only for logging.

**Response:** the PDF bytes, with `Content-Type: application/pdf` and
`Content-Disposition: attachment`.

The URL is resolved and checked before anything is fetched, so this endpoint
cannot be used to reach the internal network:

| | |
|---|---|
| **400** | Not a valid URL, or the host would not resolve |
| **403** | Resolves to a non-public address, a redirect left http/https, or the publisher refused the request |
| **404** | The publisher has no PDF at that URL |
| **413** | Larger than the download limit |
| **415** | Upstream served something that is not a PDF |
| **502** | Upstream could not be fetched, or answered with anything else |

The check is applied again to each redirect, not only to the URL supplied.

`403` and `404` are the two upstream answers reported as themselves, because
they are the two a caller acts on differently: `404` says the record's
`bestPdfUrl` is wrong and the file is not there, `403` says the file is there
and this proxy is not allowed to fetch it — bot protection, which the reader's
own browser may well get past. Every other upstream status is a `502`,
including an upstream `429`: this endpoint answers with `429` when *the caller*
has asked too often, and only that one is fixed by the caller waiting.

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
> [Configuration](./configuration.md#administrative-access).


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

Aggregate HTTP client metrics across all provider services.

**GET** `/api/performance/metrics/:service`

Metrics for one service.

**GET** `/api/performance/report`

A rendered summary of the above.

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

