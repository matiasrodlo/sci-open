# Open Access Explorer

A modern search interface for discovering open-access research papers across multiple academic sources.

## Overview

Open Access Explorer aggregates and searches research papers from arXiv, CORE, Europe PMC, NCBI, and other open-access repositories. Built with Next.js and Fastify, it provides a clean, Web of Science-style interface with intelligent caching, smart source selection, and real-time faceting.

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy environment file
cp docs/env.example .env
```

# Start services (Redis, Typesense)
docker-compose up -d

# Start development servers
pnpm dev
```

Visit `http://localhost:3000`

## Documentation

- [Architecture](./architecture.md) - System design and components
- [API Reference](./api.md) - Endpoints and data models
- [Development](./development.md) - Setup and development guide
- [Configuration](./configuration.md) - Environment variables and settings

## Features

- **Multi-source search** across academic repositories
- **Smart PDF resolution** with automatic fallback chains
- **Intelligent caching** with Redis and in-memory layers
- **Adaptive source selection** based on query patterns
- **Real-time faceting** by source, year, venue, and more
- **Performance monitoring** and optimization

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

