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
- `X-Cache-Hit`: `true` | `similar` | `false`
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
| **403** | Resolves to a non-public address, or a redirect left http/https |
| **413** | Larger than the download limit |
| **415** | Upstream served something that is not a PDF |
| **502** | Upstream could not be fetched |

The check is applied again to each redirect, not only to the URL supplied.

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
  total: number;                  // Total results
  pageSize: number;               // Page size
}
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message"
}
```

**Status Codes:**
- `200` - Success
- `400` - Bad Request
- `500` - Internal Server Error

