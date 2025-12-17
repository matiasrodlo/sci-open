# Open Access Explorer

A modern search interface for discovering open-access research papers across leading academic sources. Unifies search across arXiv, CORE, Europe PMC, NCBI, OpenAIRE, and other repositories, providing access to more than 90 million papers worldwide.

<img width="2946" height="1972" alt="image" src="https://github.com/user-attachments/assets/2443de09-7920-4f7d-b50a-d6f0edb98278" />

## Features

- **Multi-source search** across academic repositories
- **Smart PDF resolution** with automatic fallback chains
- **Intelligent caching** with Redis and in-memory layers
- **Adaptive source selection** based on query patterns
- **Real-time faceting** by source, year, venue, and more
- **Performance monitoring** and optimization

## Quick Start

**Prerequisites:** Node.js 18+, pnpm 8+, Docker

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

## License

MIT License
