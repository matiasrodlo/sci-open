# Open Access Explorer

A modern search interface for discovering open-access research papers across multiple academic sources.

## Overview

Open Access Explorer aggregates and searches research papers from arXiv, CORE, Europe PMC, NCBI, and other open-access repositories. Built with Next.js and Fastify, it provides a clean, Web of Science-style interface with intelligent caching, per-source coverage reporting, and real-time faceting.

## Quick Start

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

- [Architecture](./architecture.md) - System design and components
- [Architecture Diagram](./architecture-diagram.md) - Mermaid diagrams of the whole app
- [Platform Workflow](./workflow.md) - Mermaid diagrams of what happens at runtime
- [API Reference](./api.md) - Endpoints and data models
- [Development](./development.md) - Setup and development guide
- [Configuration](./configuration.md) - Environment variables and settings

## Features

- **Multi-source search** across ten academic repositories
- **PDF resolution** that rewrites hosts advertising PDFs they do not serve
- **Two-layer caching** — an in-process LRU bounded in bytes over Redis
- **Capability-based source selection** — a provider is asked only what its API can answer
- **Real-time faceting** by source, open-access status, year, venue and publisher
- **Per-provider coverage reporting**, so a degraded search says which sources answered

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

