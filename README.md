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
- **Authority rescue** — a paper is not dropped for want of a copy until the services that would know one have been asked

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

## Configuration

Every setting lives in [`docs/env.example`](./docs/env.example), which the Quick
Start copies, and is explained in
[Configuration](./docs/configuration.md). Three are worth knowing before a
deployment rather than after one.

```bash
# Which hops in front of the API may state the caller's address.
# Unset trusts none of them — and the browser never reaches the API directly,
# so every request arrives from the web tier and the rate limit becomes one
# bucket shared by every visitor rather than one each. Name your proxy by
# address, CIDR or a range like `loopback`; the API warns at startup until you
# do. Do not set it to `true` unless nothing but the proxy can reach the port,
# or any caller can pick their own rate-limit key.
TRUST_PROXY=

# The two in-process caches, in bytes. Defaults are 256 MB of responses and
# 128 MB of provider fan-outs. Both count serialised size, so expect two to
# three times the configured value resident, and give a container memory limit
# room above their sum.
CACHE_MAX_BYTES=
PROVIDER_CACHE_MAX_BYTES=
```

Per-service HTTP pool tuning (`OPENALEX_POOL_CONFIG` and one for each of the
other twelve upstreams) is optional — unset falls back to the global
`HTTP_POOL_*` defaults. Provider API keys are optional too, except
`UNPAYWALL_EMAIL`, which Unpaywall requires and OpenAlex rewards.

## Documentation

Comprehensive documentation is available in the [`/docs`](./docs) directory:

- **[Architecture](./docs/architecture.md)** - System design and components
- **[Platform Workflow](./docs/workflow.md)** - Mermaid diagrams of what happens at runtime
- **[API Reference](./docs/api.md)** - Endpoints and data models
- **[Development](./docs/development.md)** - Setup and development guide
- **[Configuration](./docs/configuration.md)** - Environment variables and settings

## Tech Stack

**Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui  
**Backend:** Fastify, TypeScript, Node.js  
**Search:** in-process orchestrator — capability-based planning, fan-out, merge, rank  
**Cache:** Redis (L2), in-process LRU bounded in bytes (L1), plus a byte-bounded per-provider fan-out cache  
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
