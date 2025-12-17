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
- `id`: Paper identifier (format: `source:sourceId` or DOI)

**Response:**
```json
{
  "record": {
    "id": "arxiv:2301.12345",
    "title": "Paper Title",
    "authors": ["Author One"],
    "year": 2023,
    "doi": "10.1234/example",
    "abstract": "...",
    "source": "arxiv",
    "sourceId": "2301.12345"
  },
  "pdf": {
    "url": "https://arxiv.org/pdf/2301.12345.pdf",
    "status": "ok"
  }
}
```

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

**POST** `/api/cache/warm`

Start cache warming process.

**POST** `/api/cache/clear`

Clear all caches.

**GET** `/api/cache/stats`

Get cache statistics.

---

### Performance

**POST** `/api/performance/test`

Run HTTP performance test.

**POST** `/api/performance/test/comprehensive`

Run comprehensive performance tests.

**GET** `/api/performance/monitor`

Get performance monitoring data.

---

### Smart Source Selection

**GET** `/api/smart-source/config`

Get smart source selection configuration.

**POST** `/api/smart-source/config`

Update configuration.

**GET** `/api/smart-source/test`

Run source selection tests.

**GET** `/api/smart-source/performance`

Get performance recommendations.

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

