# Open Access Explorer

A modern search interface for discovering open-access research papers across leading academic sources. Unifies search across arXiv, CORE, Europe PMC, NCBI, OpenAIRE, and other repositories, providing access to more than 90 million papers worldwide.

<img width="2946" height="1972" alt="image" src="https://github.com/user-attachments/assets/2443de09-7920-4f7d-b50a-d6f0edb98278" />

## Features

- **Multi-source search** across ten academic repositories
- **PDF resolution** that rewrites hosts advertising PDFs they do not serve
- **Two-layer caching** — an in-process LRU bounded in bytes over Redis
- **Capability-based source selection** — a provider is asked only what its API can answer
- **Real-time faceting** by source, open-access status, year, venue and publisher
- **Per-provider coverage reporting**, so a degraded search says which sources answered

## Quick Start

**Prerequisites:** Node.js 22+, pnpm 8+, Docker

```bash
# Install dependencies
pnpm install

# Copy environment file
cp docs/env.example .env

# Start Redis. Compose also builds api and web for a production-like
# run; the dev servers below replace them.
docker-compose up -d redis

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
**Search:** in-process orchestrator — capability-based planning, fan-out, merge, rank  
**Cache:** Redis (L2), in-process LRU bounded in bytes (L1)  
**Data Sources:** arXiv, CORE, Europe PMC, NCBI, OpenAIRE, and more

## Project Structure

```
sci-open/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # Fastify API server
├── packages/
│   └── shared/       # Shared types
└── docs/             # Documentation
```

## License

MIT License
