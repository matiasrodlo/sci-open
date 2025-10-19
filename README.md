# Open Access Explorer

A Web of Science-style UI for discovering open-access research papers with multi-source search capabilities, built with Next.js, Fastify, and modern search backends.

## Features

- **Multi-Source Search**: Search across arXiv, CORE, Europe PMC, and NCBI simultaneously
- **Smart PDF Resolution**: Automatic PDF access with intelligent fallback chains
- **Modern UI**: Clean, accessible interface built with shadcn/ui and Tailwind CSS
- **Flexible Search Backend**: Support for Typesense, Meilisearch, and Algolia
- **Real-time Faceting**: Filter results by source, year, venue, and open access status
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Architecture

```
open-access-explorer/
├── apps/
│   ├── web/                 # Next.js frontend (App Router)
│   └── api/                 # Fastify API server
├── packages/
│   ├── shared/              # Shared TypeScript types
│   └── search/              # Search backend adapters
└── docker-compose.yml       # Local development setup
```

## Tech Stack

### Frontend
- **Next.js 14** with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **shadcn/ui** for components
- **Lucide React** for icons

### Backend
- **Fastify** API server
- **TypeScript** throughout
- **Node.js** runtime

### Search Backends
- **Typesense** (recommended)
- **Meilisearch**
- **Algolia** (optional)

### Data Sources
- **arXiv** - Preprint repository
- **CORE** - Open access aggregator
- **Europe PMC** - Biomedical literature
- **NCBI** - PubMed/PMC database

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Docker (for local search backends)

### 1. Clone and Install

```bash
git clone <repository-url>
cd open-access-explorer
pnpm install
```

### 2. Environment Setup

Copy the example environment file:

```bash
cp env.example .env
```

Edit `.env` with your configuration:

```env
# Frontend
NEXT_PUBLIC_API_BASE=http://localhost:4000
NEXT_PUBLIC_SEARCH_BACKEND=typesense

# API
PORT=4000
NODE_ENV=development

# Search backends
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz

# Optional: API keys for enhanced access
CORE_API_KEY=your_core_api_key
NCBI_API_KEY=your_ncbi_api_key
```

### 3. Start Search Backend

Choose one of the following options:

#### Option A: Typesense (Recommended)

```bash
docker run -p 8108:8108 -v/tmp/typesense-data:/data typesense/typesense:0.25.1 --data-dir /data --api-key=xyz --listen-port 8108 --enable-cors
```

#### Option B: Meilisearch

```bash
docker run -p 7700:7700 -v/tmp/meilisearch-data:/meili_data getmeili/meilisearch:v1.5
```

#### Option C: Docker Compose (All Services)

```bash
docker-compose up -d
```

### 4. Seed the Search Index

```bash
pnpm seed
```

### 5. Start Development Servers

```bash
# Start API server
pnpm dev:api

# In another terminal, start frontend
pnpm dev:web
```

Visit `http://localhost:3000` to see the application.

## API Endpoints

### POST /api/search

Search for papers across multiple sources.

**Request Body:**
```json
{
  "q": "machine learning",
  "filters": {
    "source": ["arxiv", "core"],
    "yearFrom": 2020,
    "yearTo": 2024
  },
  "page": 1,
  "pageSize": 20,
  "sort": "relevance"
}
```

**Response:**
```json
{
  "hits": [...],
  "facets": {...},
  "page": 1,
  "total": 150,
  "pageSize": 20
}
```

### GET /api/paper/:id

Get detailed information about a specific paper and resolve PDF access.

**Response:**
```json
{
  "record": {...},
  "pdf": {
    "url": "https://example.com/paper.pdf",
    "status": "ok"
  }
}
```

## Data Model

### OARecord

```typescript
interface OARecord {
  id: string;                 // stable identifier
  doi?: string;               // Digital Object Identifier
  title: string;              // paper title
  authors: string[];          // author names
  year?: number;              // publication year
  venue?: string;             // journal/conference
  abstract?: string;          // paper abstract
  source: "arxiv" | "core" | "europepmc" | "ncbi";
  sourceId: string;           // source-specific ID
  oaStatus?: "preprint" | "accepted" | "published" | "other";
  bestPdfUrl?: string;        // direct PDF link
  landingPage?: string;       // canonical page
  topics?: string[];          // subject keywords
  language?: string;          // paper language
  createdAt: string;          // record creation time
  updatedAt?: string;         // last update time
}
```

## Search Backend Configuration

### Typesense

```env
SEARCH_BACKEND=typesense
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz
```

### Meilisearch

```env
SEARCH_BACKEND=meili
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=xyz
```

### Algolia

```env
SEARCH_BACKEND=algolia
ALGOLIA_APP_ID=your_app_id
ALGOLIA_API_KEY=your_api_key
ALGOLIA_INDEX=oa_records
```

## Deployment

### Frontend (Vercel)

1. Connect your repository to Vercel
2. Set environment variables in Vercel dashboard
3. Deploy automatically on push to main

**Environment Variables:**
```
NEXT_PUBLIC_API_BASE=https://your-api-domain.com
NEXT_PUBLIC_SEARCH_BACKEND=typesense
```

### API (Render/Railway)

1. Create a new service
2. Connect your repository
3. Set build command: `pnpm build --filter=api`
4. Set start command: `pnpm start --filter=api`

**Environment Variables:**
```
NODE_ENV=production
PORT=4000
SEARCH_BACKEND=typesense
TYPESENSE_HOST=your-typesense-host
TYPESENSE_API_KEY=your-api-key
```

### Search Backend

#### Typesense Cloud
1. Create account at [Typesense Cloud](https://cloud.typesense.org)
2. Create a cluster
3. Update API configuration with cloud credentials

#### Meilisearch Cloud
1. Create account at [Meilisearch Cloud](https://www.meilisearch.com/cloud)
2. Create a project
3. Update API configuration with cloud credentials

## Development

### Project Structure

```
apps/
├── web/                     # Next.js frontend
│   ├── app/                # App Router pages
│   ├── components/         # React components
│   └── lib/               # Utilities
└── api/                    # Fastify API
    ├── src/
    │   ├── routes/        # API routes
    │   ├── sources/       # Data source connectors
    │   └── lib/          # Utilities
    └── Dockerfile

packages/
├── shared/                 # Shared types
└── search/                # Search adapters
```

### Adding New Data Sources

1. Create a new connector in `apps/api/src/sources/`
2. Implement the `SourceConnector` interface
3. Add the connector to the API server
4. Update the frontend to handle the new source

### Adding New Search Backends

1. Create a new adapter in `packages/search/src/`
2. Implement the `SearchAdapter` interface
3. Add configuration options
4. Update the API server to support the new backend

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and questions:
1. Check the [Issues](https://github.com/your-repo/issues) page
2. Create a new issue with detailed information
3. Join our community discussions

## Acknowledgments

- Built with [Next.js](https://nextjs.org/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Search powered by [Typesense](https://typesense.org/)
- Icons from [Lucide](https://lucide.dev/)
