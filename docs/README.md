# Open Access Explorer Documentation

A comprehensive research discovery platform for open-access academic papers with multi-source search capabilities.

## 📚 Documentation Index

- [**Overview**](./overview.md) - Platform introduction and key features
- [**Architecture**](./architecture.md) - System design and component structure  
- [**API Reference**](./api.md) - REST API endpoints and usage
- [**Deployment**](./deployment.md) - Production deployment guide
- [**Development**](./development.md) - Development setup and guidelines
- [**Configuration**](./configuration.md) - Environment and service configuration
- [**HTTP Connection Pooling**](./http-connection-pooling.md) - Performance optimization with connection pooling

## 🚀 Quick Start

```bash
# Clone and install
git clone <repository-url>
cd sci-open
pnpm install

# Start development environment
pnpm dev
```

Visit `http://localhost:3000` to access the application.

## 🏗️ System Overview

**Open Access Explorer** is a Web of Science-style research discovery platform that aggregates and searches across multiple open-access repositories including arXiv, CORE, Europe PMC, NCBI, and more.

### Key Features

- **Multi-Source Search**: Simultaneous search across 8+ academic databases
- **Smart PDF Resolution**: Automatic PDF access with intelligent fallback chains
- **Advanced Filtering**: Filter by source, year, venue, and open access status
- **Citation Export**: Support for 10+ citation formats (BibTeX, EndNote, APA, etc.)
- **Modern UI**: Clean, responsive interface built with Next.js and Tailwind CSS
- **Flexible Backend**: Support for Typesense, Meilisearch, and Algolia search engines

### Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Fastify API server with TypeScript
- **Search**: Typesense (recommended), Meilisearch, Algolia
- **Data Sources**: arXiv, CORE, Europe PMC, NCBI, bioRxiv, medRxiv, PLOS, OpenAIRE

## 📖 Documentation Structure

This documentation is organized into focused sections:

- **Overview**: Platform introduction, features, and use cases
- **Architecture**: System design, data flow, and component relationships
- **API Reference**: Complete REST API documentation with examples
- **Deployment**: Production deployment for frontend, API, and search backends
- **Development**: Local development setup, contributing guidelines, and project structure
- **Configuration**: Environment variables, service configuration, and tuning

## 🤝 Contributing

We welcome contributions! Please see the [Development Guide](./development.md) for setup instructions and contribution guidelines.

## 📄 License

MIT License - see [LICENSE](../LICENSE) file for details.

---

*Last updated: December 2024*
