# API Reference

The Open Access Explorer API provides comprehensive search and paper access functionality through a RESTful interface built with Fastify.

## 🌐 Base URL

```
Development: http://localhost:4000
Production: https://api.openaccessexplorer.com
```

## 🔐 Authentication

Currently, the API is open and does not require authentication. Rate limiting is applied per IP address (100 requests per minute).

## 📋 Content Types

All requests and responses use `application/json` content type.

## 🔍 Search Endpoints

### POST /api/search

Search for papers across multiple academic databases.

#### Request Body

```typescript
interface SearchRequest {
  q: string;                    // Search query (required)
  page?: number;               // Page number (default: 1)
  pageSize?: number;          // Results per page (default: 20, max: 100)
  sort?: SortOption;          // Sort order (default: 'relevance')
  filters?: SearchFilters;     // Filter options
}

interface SearchFilters {
  sources?: string[];         // Data sources: ['arxiv', 'core', 'europepmc', 'ncbi', 'doaj']
  yearFrom?: number;         // Start year (e.g., 2020)
  yearTo?: number;           // End year (e.g., 2024)
  venue?: string[];          // Venue/journal names
  oaStatus?: string[];       // Open access status: ['preprint', 'accepted', 'published']
  language?: string[];        // Paper languages: ['en', 'es', 'fr', 'de']
  exactPhrase?: boolean;     // Exact phrase matching
}

type SortOption = 
  | 'relevance'      // Default: relevance scoring
  | 'date'          // Newest first
  | 'date_asc'      // Oldest first
  | 'citations'     // Most cited first
  | 'citations_asc' // Least cited first
  | 'author'        // Author name A-Z
  | 'author_desc'   // Author name Z-A
  | 'venue'         // Venue name A-Z
  | 'venue_desc'    // Venue name Z-A
  | 'title'         // Title A-Z
  | 'title_desc';   // Title Z-A
```

#### Example Request

```json
{
  "q": "machine learning healthcare",
  "page": 1,
  "pageSize": 20,
  "sort": "date",
  "filters": {
    "sources": ["arxiv", "core", "europepmc"],
    "yearFrom": 2020,
    "yearTo": 2024,
    "oaStatus": ["published"]
  }
}
```

#### Response

```typescript
interface SearchResponse {
  hits: OARecord[];           // Array of paper records
  total: number;              // Total number of results
  page: number;               // Current page number
  pageSize: number;           // Results per page
  facets: SearchFacets;       // Facet counts for filtering
  query: string;              // Original search query
  took: number;               // Search time in milliseconds
}

interface OARecord {
  id: string;                 // Unique identifier (source:sourceId)
  doi?: string;               // Digital Object Identifier
  title: string;              // Paper title
  authors: string[];          // Author names
  year?: number;              // Publication year
  venue?: string;             // Journal/conference name
  abstract?: string;          // Paper abstract
  source: string;             // Data source: 'arxiv', 'core', 'europepmc', 'ncbi', etc.
  sourceId: string;           // Source-specific identifier
  oaStatus?: string;          // Open access status
  bestPdfUrl?: string;        // Direct PDF link
  landingPage?: string;        // Canonical paper page
  topics?: string[];          // Subject keywords
  language?: string;          // Paper language
  publisher?: string;         // Publisher name
  citationCount?: number;     // Number of citations
  license?: string;           // License URL
  createdAt: string;          // Record creation timestamp
  updatedAt?: string;         // Last update timestamp
}

interface SearchFacets {
  sources: { [key: string]: number };    // Count by source
  years: { [key: string]: number };     // Count by year
  venues: { [key: string]: number }; // Count by venue
  oaStatus: { [key: string]: number };   // Count by OA status
  languages: { [key: string]: number }; // Count by language
}
```

#### Example Response

```json
{
  "hits": [
    {
      "id": "arxiv:2301.12345",
      "doi": "10.48550/arXiv.2301.12345",
      "title": "Deep Learning for Medical Diagnosis: A Comprehensive Review",
      "authors": ["Alice Smith", "Bob Johnson", "Carol Williams"],
      "year": 2023,
      "venue": "arXiv preprint",
      "abstract": "This paper presents a comprehensive review of deep learning applications in medical diagnosis...",
      "source": "arxiv",
      "sourceId": "2301.12345",
      "oaStatus": "preprint",
      "bestPdfUrl": "https://arxiv.org/pdf/2301.12345.pdf",
      "landingPage": "https://arxiv.org/abs/2301.12345",
      "topics": ["machine learning", "medical diagnosis", "deep learning"],
      "language": "en",
      "publisher": "Cornell University",
      "citationCount": 15,
      "license": "http://arxiv.org/licenses",
      "createdAt": "2023-01-15T10:30:00Z"
    }
  ],
  "total": 1247,
  "page": 1,
  "pageSize": 20,
  "facets": {
    "sources": {
      "arxiv": 450,
      "core": 320,
      "europepmc": 280,
      "ncbi": 197
    },
    "years": {
      "2023": 180,
      "2022": 165,
      "2021": 142
    },
    "venues": {
      "arXiv preprint": 450,
      "Nature": 25,
      "PLOS ONE": 18
    },
    "oaStatus": {
      "preprint": 450,
      "published": 320,
      "accepted": 15
    }
  },
  "query": "machine learning healthcare",
  "took": 1247
}
```

## 📄 Paper Details Endpoints

### GET /api/paper/:id

Get detailed information about a specific paper, including PDF resolution and enhanced metadata.

#### Parameters

- `id` (string, required): Paper identifier in format `source:sourceId` or just `sourceId`

#### Example Request

```bash
GET /api/paper/arxiv:2301.12345
GET /api/paper/10.1038/s41467-018-08158-x
```

#### Response

```typescript
interface PaperResponse {
  record: OARecord;           // Complete paper record
  pdf: PDFInfo;              // PDF access information
  citations?: CitationInfo;   // Citation data (if available)
  related?: OARecord[];      // Related papers (if available)
}

interface PDFInfo {
  url?: string;               // Direct PDF URL
  status: 'ok' | 'not_found' | 'restricted' | 'error';
  source: string;            // PDF source: 'direct', 'unpaywall', 'repository'
  size?: number;             // File size in bytes
  lastChecked: string;       // Last PDF check timestamp
}

interface CitationInfo {
  count: number;             // Total citation count
  sources: string[];         // Citation sources
  lastUpdated: string;       // Last citation update
}
```

#### Example Response

```json
{
  "record": {
    "id": "arxiv:2301.12345",
    "doi": "10.48550/arXiv.2301.12345",
    "title": "Deep Learning for Medical Diagnosis: A Comprehensive Review",
    "authors": ["Alice Smith", "Bob Johnson", "Carol Williams"],
    "year": 2023,
    "venue": "arXiv preprint",
    "abstract": "This paper presents a comprehensive review...",
    "source": "arxiv",
    "sourceId": "2301.12345",
    "oaStatus": "preprint",
    "bestPdfUrl": "https://arxiv.org/pdf/2301.12345.pdf",
    "landingPage": "https://arxiv.org/abs/2301.12345",
    "topics": ["machine learning", "medical diagnosis"],
    "language": "en",
    "publisher": "Cornell University",
    "citationCount": 15,
    "license": "http://arxiv.org/licenses",
    "createdAt": "2023-01-15T10:30:00Z"
  },
  "pdf": {
    "url": "https://arxiv.org/pdf/2301.12345.pdf",
    "status": "ok",
    "source": "direct",
    "size": 2048576,
    "lastChecked": "2023-12-01T15:30:00Z"
  },
  "citations": {
    "count": 15,
    "sources": ["crossref", "semantic_scholar"],
    "lastUpdated": "2023-12-01T15:30:00Z"
  }
}
```

## 📚 Citation Endpoints

### GET /api/paper/:id/citations

Get citation information for a specific paper in multiple formats.

#### Parameters

- `id` (string, required): Paper identifier
- `format` (string, optional): Citation format (default: 'bibtex')

#### Supported Formats

- `bibtex` - BibTeX format
- `endnote` - EndNote format
- `ris` - Research Information Systems format
- `wos` - Web of Science format
- `apa` - APA style
- `mla` - MLA style
- `chicago` - Chicago style
- `harvard` - Harvard style
- `vancouver` - Vancouver style
- `plain` - Plain text

#### Example Request

```bash
GET /api/paper/arxiv:2301.12345/citations?format=apa
```

#### Response

```json
{
  "format": "apa",
  "citation": "Smith, A., Johnson, B., & Williams, C. (2023). Deep Learning for Medical Diagnosis: A Comprehensive Review. arXiv preprint arXiv:2301.12345.",
  "metadata": {
    "title": "Deep Learning for Medical Diagnosis: A Comprehensive Review",
    "authors": ["Alice Smith", "Bob Johnson", "Carol Williams"],
    "year": 2023,
    "venue": "arXiv preprint",
    "doi": "10.48550/arXiv.2301.12345"
  }
}
```

### POST /api/citations/batch

Generate citations for multiple papers in batch.

#### Request Body

```typescript
interface BatchCitationRequest {
  papers: string[];          // Array of paper IDs
  format: string;            // Citation format
  options?: CitationOptions; // Citation options
}

interface CitationOptions {
  includeAbstract?: boolean;  // Include abstract in citation
  includeKeywords?: boolean;   // Include keywords
  includeDOI?: boolean;       // Include DOI
  includeURL?: boolean;        // Include URL
  maxAuthors?: number;         // Maximum number of authors to include
}
```

#### Example Request

```json
{
  "papers": ["arxiv:2301.12345", "core:123456", "europepmc:789012"],
  "format": "bibtex",
  "options": {
    "includeAbstract": true,
    "includeDOI": true,
    "maxAuthors": 10
  }
}
```

#### Response

```json
{
  "format": "bibtex",
  "citations": [
    {
      "id": "arxiv:2301.12345",
      "citation": "@article{Smith2023,\n  title = {Deep Learning for Medical Diagnosis: A Comprehensive Review},\n  author = {Smith, Alice and Johnson, Bob and Williams, Carol},\n  journal = {arXiv preprint},\n  year = {2023},\n  doi = {10.48550/arXiv.2301.12345}\n}"
    }
  ],
  "total": 3,
  "generated": "2023-12-01T15:30:00Z"
}
```

## 🔧 System Endpoints

### GET /health

Health check endpoint for monitoring system status.

#### Response

```json
{
  "status": "ok",
  "timestamp": "2023-12-01T15:30:00Z",
  "services": {
    "search": "ok",
    "sources": "ok",
    "cache": "ok"
  },
  "version": "1.0.0"
}
```

### GET /debug/sources

Test connectivity to all data sources.

#### Response

```json
{
  "sources": {
    "arxiv": {
      "status": "ok",
      "responseTime": 245,
      "lastChecked": "2023-12-01T15:30:00Z"
    },
    "core": {
      "status": "ok",
      "responseTime": 189,
      "lastChecked": "2023-12-01T15:30:00Z"
    },
    "europepmc": {
      "status": "error",
      "responseTime": 5000,
      "error": "Timeout",
      "lastChecked": "2023-12-01T15:30:00Z"
    }
  },
  "overall": "degraded"
}
```

## 📊 Error Handling

### Error Response Format

```typescript
interface ErrorResponse {
  error: string;             // Error message
  code?: string;             // Error code
  details?: any;             // Additional error details
  timestamp: string;         // Error timestamp
}
```

### HTTP Status Codes

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `404` - Not Found (paper not found)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error
- `503` - Service Unavailable (external API issues)

### Example Error Responses

#### 400 Bad Request
```json
{
  "error": "Invalid search parameters",
  "code": "INVALID_PARAMS",
  "details": {
    "field": "pageSize",
    "message": "Page size must be between 1 and 100"
  },
  "timestamp": "2023-12-01T15:30:00Z"
}
```

#### 404 Not Found
```json
{
  "error": "Paper not found",
  "code": "PAPER_NOT_FOUND",
  "details": {
    "id": "invalid:12345"
  },
  "timestamp": "2023-12-01T15:30:00Z"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Search service temporarily unavailable",
  "code": "SEARCH_ERROR",
  "details": {
    "source": "Typesense connection failed"
  },
  "timestamp": "2023-12-01T15:30:00Z"
}
```

## 🚀 Rate Limiting

### Limits
- **100 requests per minute** per IP address
- **1000 requests per hour** per IP address
- **Burst allowance**: 20 requests in 10 seconds

### Rate Limit Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
```

### Rate Limit Exceeded Response
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 60,
  "timestamp": "2023-12-01T15:30:00Z"
}
```

## 🔄 Caching

### Cache Headers
- **Search Results**: 5 minutes (`Cache-Control: public, max-age=300`)
- **Paper Details**: 10 minutes (`Cache-Control: public, max-age=600`)
- **PDF URLs**: 1 hour (`Cache-Control: public, max-age=3600`)

### Cache Invalidation
- Search results are cached by query parameters
- Paper details are cached by paper ID
- Cache is automatically invalidated when data is updated

## 📝 Usage Examples

### Basic Search
```bash
curl -X POST http://localhost:4000/api/search \
  -H "Content-Type: application/json" \
  -d '{"q": "machine learning", "pageSize": 10}'
```

### Advanced Search with Filters
```bash
curl -X POST http://localhost:4000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "q": "artificial intelligence healthcare",
    "pageSize": 20,
    "sort": "date",
    "filters": {
      "sources": ["arxiv", "core"],
      "yearFrom": 2020,
      "oaStatus": ["published"]
    }
  }'
```

### Get Paper Details
```bash
curl http://localhost:4000/api/paper/arxiv:2301.12345
```

### Generate Citations
```bash
curl http://localhost:4000/api/paper/arxiv:2301.12345/citations?format=apa
```

### Batch Citation Export
```bash
curl -X POST http://localhost:4000/api/citations/batch \
  -H "Content-Type: application/json" \
  -d '{
    "papers": ["arxiv:2301.12345", "core:123456"],
    "format": "bibtex"
  }'
```

## 🔧 SDK and Libraries

### JavaScript/TypeScript
```typescript
import { OpenAccessExplorerAPI } from '@open-access-explorer/api-client';

const api = new OpenAccessExplorerAPI({
  baseURL: 'https://api.openaccessexplorer.com'
});

// Search papers
const results = await api.search({
  q: 'machine learning',
  pageSize: 20,
  filters: {
    sources: ['arxiv', 'core'],
    yearFrom: 2020
  }
});

// Get paper details
const paper = await api.getPaper('arxiv:2301.12345');

// Generate citations
const citation = await api.getCitation('arxiv:2301.12345', 'apa');
```

### Python
```python
import requests

# Search papers
response = requests.post('https://api.openaccessexplorer.com/api/search', 
  json={
    'q': 'machine learning',
    'pageSize': 20,
    'filters': {
      'sources': ['arxiv', 'core'],
      'yearFrom': 2020
    }
  }
)

results = response.json()
```

---

*For deployment and configuration details, see the [Deployment Guide](./deployment.md).*
