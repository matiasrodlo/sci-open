# Open Access Explorer

A modern search interface for discovering open-access research papers across multiple academic sources.

Open Access Explorer aggregates and searches research papers from arXiv, CORE, Europe PMC, NCBI, and other open-access repositories. Built with Next.js and Fastify, it provides a clean, Web of Science-style interface with intelligent caching, smart source selection, and real-time faceting.

<img width="2988" height="2344" alt="image" src="https://github.com/user-attachments/assets/cf31d2c6-b26b-4f0e-bbaf-1604ff630384" />

## Features

- **Multi-source search** across academic repositories
- **Smart PDF resolution** with automatic fallback chains
- **Intelligent caching** with Redis and in-memory layers
- **Adaptive source selection** based on query patterns
- **Real-time faceting** by source, year, venue, and more
- **Performance monitoring** and optimization

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy environment file
cp docs/env.example .env

# Start services (Redis, Typesense)
docker-compose up -d

# Start development servers
pnpm dev
```

Visit `http://localhost:3000`

## Documentation

Comprehensive documentation is available in the [`/docs`](./docs) directory:

- **[Overview](./docs/README.md)** - Project overview and quick start
- **[Architecture](./docs/architecture.md)** - System design and components
- **[API Reference](./docs/api.md)** - Endpoints and data models
- **[Development](./docs/development.md)** - Setup and development guide
- **[Configuration](./docs/configuration.md)** - Environment variables and settings

## Tech Stack

**Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui  
**Backend:** Fastify, TypeScript, Node.js  
**Search:** Typesense, Meilisearch, Algolia  
**Cache:** Redis, NodeCache  
**Data Sources:** arXiv, CORE, Europe PMC, NCBI, OpenAIRE, and more

## Project Structure

```
sci-open/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # Fastify API server
├── packages/
│   ├── shared/       # Shared types
│   └── search/       # Search adapters
└── docs/             # Documentation
```

## Prerequisites

- Node.js 18+
- pnpm 8+
- Docker (for local services)

## Environment Setup

Minimum required environment variables:

```env
NEXT_PUBLIC_API_BASE=http://localhost:4000
PORT=4000
REDIS_URL=redis://localhost:6379
```

See [Configuration](./docs/configuration.md) for complete environment setup.

## Development

```bash
# Start both API and web
pnpm dev

# Or separately
pnpm dev:api    # API on :4000
pnpm dev:web    # Web on :3000

# Build
pnpm build

# Lint
pnpm lint
```

See [Development Guide](./docs/development.md) for detailed instructions.

## License

MIT License
