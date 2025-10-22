# Configuration Guide

This guide covers all configuration options for the Open Access Explorer platform, including environment variables, service settings, and performance tuning.

## 🔧 Environment Variables

### Frontend Configuration (Next.js)

#### Required Variables
```bash
# API Configuration
NEXT_PUBLIC_API_BASE=http://localhost:4000
NEXT_PUBLIC_SEARCH_BACKEND=typesense
```

#### Optional Variables
```bash
# Analytics
NEXT_PUBLIC_GA_ID=your-google-analytics-id
NEXT_PUBLIC_GTM_ID=your-google-tag-manager-id

# Feature Flags
NEXT_PUBLIC_ENABLE_CITATIONS=true
NEXT_PUBLIC_ENABLE_EXPORT=true
NEXT_PUBLIC_ENABLE_ADVANCED_SEARCH=true

# UI Configuration
NEXT_PUBLIC_DEFAULT_PAGE_SIZE=20
NEXT_PUBLIC_MAX_PAGE_SIZE=100
NEXT_PUBLIC_ENABLE_INFINITE_SCROLL=false
```

### API Configuration (Fastify)

#### Server Settings
```bash
# Basic Configuration
NODE_ENV=production
PORT=4000
HOST=0.0.0.0

# CORS Settings
CORS_ORIGIN=https://your-frontend-domain.com
CORS_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_SKIP_SUCCESSFUL_REQUESTS=false
```

#### Search Backend Configuration
```bash
# Search Backend Selection
SEARCH_BACKEND=typesense

# Typesense Configuration
TYPESENSE_HOST=localhost
TYPESENSE_PORT=8108
TYPESENSE_PROTOCOL=http
TYPESENSE_API_KEY=xyz
TYPESENSE_COLLECTION=oa_records

# Meilisearch Configuration (Alternative)
MEILI_HOST=http://localhost:7700
MEILI_MASTER_KEY=xyz
MEILI_INDEX=oa_records

# Algolia Configuration (Alternative)
ALGOLIA_APP_ID=your_app_id
ALGOLIA_API_KEY=your_api_key
ALGOLIA_INDEX=oa_records
```

#### Data Source Configuration
```bash
# Core API
CORE_API_KEY=your_core_api_key
CORE_BASE_URL=https://core.ac.uk/api-v2

# NCBI API
NCBI_API_KEY=your_ncbi_api_key
NCBI_BASE_URL=https://eutils.ncbi.nlm.nih.gov/entrez/eutils

# Europe PMC API
EUROPE_PMC_BASE_URL=https://www.ebi.ac.uk/europepmc/webservices/rest

# arXiv API
ARXIV_BASE_URL=http://export.arxiv.org/api/query

# Unpaywall API
UNPAYWALL_EMAIL=your-email@example.com
UNPAYWALL_BASE_URL=https://api.unpaywall.org/v2

# Crossref API
CROSSREF_BASE_URL=https://api.crossref.org
```

#### Caching Configuration
```bash
# Cache Settings
CACHE_TTL_SEARCH=300000
CACHE_TTL_PAPER=600000
CACHE_TTL_PDF=3600000
CACHE_MAX_SIZE=1000
CACHE_CLEANUP_INTERVAL=3600000
```

#### Performance Settings
```bash
# Request Timeouts
REQUEST_TIMEOUT=30000
SEARCH_TIMEOUT=10000
PDF_RESOLUTION_TIMEOUT=5000

# Concurrency Limits
MAX_CONCURRENT_REQUESTS=10
MAX_CONCURRENT_SEARCHES=5
MAX_CONCURRENT_PDF_RESOLUTIONS=3

# Batch Processing
BATCH_SIZE=10
BATCH_DELAY=100
```

## 🔍 Search Backend Configuration

### Typesense Configuration

#### Collection Schema
```typescript
const collectionSchema = {
  name: 'oa_records',
  fields: [
    { name: 'id', type: 'string' },
    { name: 'title', type: 'string' },
    { name: 'authors', type: 'string[]' },
    { name: 'abstract', type: 'string' },
    { name: 'year', type: 'int32', facet: true },
    { name: 'venue', type: 'string', facet: true },
    { name: 'source', type: 'string', facet: true },
    { name: 'oaStatus', type: 'string', facet: true },
    { name: 'topics', type: 'string[]' },
    { name: 'doi', type: 'string' },
    { name: 'bestPdfUrl', type: 'string' },
    { name: 'publisher', type: 'string' },
    { name: 'citationCount', type: 'int32' },
    { name: 'license', type: 'string' },
    { name: 'language', type: 'string', facet: true },
    { name: 'createdAt', type: 'string' }
  ],
  default_sorting_field: 'createdAt',
  enable_nested_fields: true
};
```

#### Search Configuration
```typescript
const searchConfig = {
  query_by: 'title,authors,abstract,topics',
  query_by_weights: '3,2,1,1',
  sort_by: '_text_match:desc,createdAt:desc',
  facet_by: 'source,year,venue,oaStatus,language',
  max_facet_values: 100,
  per_page: 20,
  page: 1,
  highlight_full_fields: 'title,abstract',
  snippet_threshold: 30,
  num_typos: 2,
  typo_tokens_threshold: 1,
  drop_tokens_threshold: 1,
  pinned_hits: '',
  hidden_hits: '',
  highlight_affix_num_tokens: 4,
  max_candidates: 1000,
  prioritize_exact_match: true,
  prioritize_token_position: true,
  prioritize_num_matching_fields: true
};
```

### Meilisearch Configuration

#### Index Schema
```typescript
const indexSchema = {
  uid: 'oa_records',
  primaryKey: 'id',
  searchableAttributes: [
    'title',
    'authors',
    'abstract',
    'topics'
  ],
  filterableAttributes: [
    'source',
    'year',
    'venue',
    'oaStatus',
    'language'
  ],
  sortableAttributes: [
    'createdAt',
    'year',
    'citationCount'
  ],
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attribute',
    'sort',
    'exactness'
  ],
  stopWords: [],
  synonyms: {},
  distinctAttribute: null,
  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: 4,
    disableOnWords: [],
    disableOnAttributes: []
  }
};
```

### Algolia Configuration

#### Index Settings
```typescript
const indexSettings = {
  searchableAttributes: [
    'title',
    'authors',
    'abstract',
    'topics'
  ],
  attributesForFaceting: [
    'source',
    'year',
    'venue',
    'oaStatus',
    'language'
  ],
  ranking: [
    'typo',
    'geo',
    'words',
    'filters',
    'proximity',
    'attribute',
    'exact',
    'custom'
  ],
  customRanking: [
    'desc(createdAt)',
    'desc(citationCount)'
  ],
  replicas: [
    'oa_records_by_date',
    'oa_records_by_citations'
  ]
};
```

## 📊 Data Source Configuration

### arXiv Configuration
```typescript
const arxivConfig = {
  baseUrl: 'http://export.arxiv.org/api/query',
  maxResults: 100,
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

### CORE Configuration
```typescript
const coreConfig = {
  baseUrl: 'https://core.ac.uk/api-v2',
  apiKey: process.env.CORE_API_KEY,
  maxResults: 100,
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

### Europe PMC Configuration
```typescript
const europePMCConfig = {
  baseUrl: 'https://www.ebi.ac.uk/europepmc/webservices/rest',
  maxResults: 100,
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

### NCBI Configuration
```typescript
const ncbiConfig = {
  baseUrl: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils',
  apiKey: process.env.NCBI_API_KEY,
  maxResults: 100,
  timeout: 10000,
  retries: 3,
  retryDelay: 1000,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

## 🔄 Enrichment Configuration

### Unpaywall Configuration
```typescript
const unpaywallConfig = {
  baseUrl: 'https://api.unpaywall.org/v2',
  email: process.env.UNPAYWALL_EMAIL,
  timeout: 5000,
  retries: 2,
  retryDelay: 1000,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

### Crossref Configuration
```typescript
const crossrefConfig = {
  baseUrl: 'https://api.crossref.org',
  timeout: 5000,
  retries: 2,
  retryDelay: 1000,
  batchSize: 10,
  delayBetweenBatches: 100,
  userAgent: 'OpenAccessExplorer/1.0 (mailto:your-email@example.com)'
};
```

## 🚀 Performance Configuration

### Caching Configuration
```typescript
const cacheConfig = {
  search: {
    ttl: 300000,        // 5 minutes
    maxSize: 1000,      // 1000 cached searches
    cleanupInterval: 3600000 // 1 hour
  },
  paper: {
    ttl: 600000,        // 10 minutes
    maxSize: 5000,      // 5000 cached papers
    cleanupInterval: 3600000 // 1 hour
  },
  pdf: {
    ttl: 3600000,       // 1 hour
    maxSize: 10000,     // 10000 cached PDFs
    cleanupInterval: 3600000 // 1 hour
  }
};
```

### Request Configuration
```typescript
const requestConfig = {
  timeout: 30000,       // 30 seconds
  retries: 3,          // 3 retries
  retryDelay: 1000,    // 1 second delay
  maxConcurrent: 10,   // 10 concurrent requests
  keepAlive: true,     // Keep connections alive
  maxSockets: 10       // 10 sockets per host
};
```

### Search Configuration
```typescript
const searchConfig = {
  maxResults: 100,     // Maximum results per source
  timeout: 10000,      // 10 seconds per source
  retries: 2,         // 2 retries per source
  retryDelay: 1000,   // 1 second delay
  deduplication: true, // Enable deduplication
  enrichment: true,   // Enable metadata enrichment
  pdfResolution: true // Enable PDF resolution
};
```

## 🔒 Security Configuration

### CORS Configuration
```typescript
const corsConfig = {
  origin: [
    'https://your-frontend-domain.com',
    'https://www.your-frontend-domain.com',
    'http://localhost:3000' // Development
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
```

### Rate Limiting Configuration
```typescript
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                 // 100 requests per window
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  skipFailedRequests: false
};
```

### Input Validation Configuration
```typescript
const validationConfig = {
  searchQuery: {
    minLength: 1,
    maxLength: 500,
    pattern: /^[a-zA-Z0-9\s\-_.,!?()]+$/
  },
  pageSize: {
    min: 1,
    max: 100,
    default: 20
  },
  page: {
    min: 1,
    max: 1000,
    default: 1
  }
};
```

## 📈 Monitoring Configuration

### Logging Configuration
```typescript
const loggingConfig = {
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: 'json',
  timestamp: true,
  level: true,
  message: true,
  error: true,
  warn: true,
  info: true,
  debug: true,
  trace: false
};
```

### Metrics Configuration
```typescript
const metricsConfig = {
  enabled: true,
  interval: 60000,     // 1 minute
  retention: 86400000, // 24 hours
  endpoints: {
    health: '/health',
    metrics: '/metrics',
    status: '/status'
  }
};
```

### Health Check Configuration
```typescript
const healthCheckConfig = {
  timeout: 5000,       // 5 seconds
  interval: 30000,    // 30 seconds
  retries: 3,         // 3 retries
  services: {
    search: true,
    sources: true,
    cache: true,
    database: true
  }
};
```

## 🌍 Internationalization Configuration

### Language Support
```typescript
const i18nConfig = {
  defaultLocale: 'en',
  locales: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'zh', 'ja', 'ko'],
  fallbackLocale: 'en',
  messages: {
    en: require('./locales/en.json'),
    es: require('./locales/es.json'),
    fr: require('./locales/fr.json')
  }
};
```

### Date and Time Configuration
```typescript
const dateTimeConfig = {
  timezone: 'UTC',
  format: 'ISO',
  locale: 'en-US',
  displayFormat: 'MMM DD, YYYY',
  timeFormat: 'HH:mm:ss'
};
```

## 🔧 Development Configuration

### Development Environment
```bash
# Development settings
NODE_ENV=development
DEBUG=api:*
LOG_LEVEL=debug
CACHE_ENABLED=false
RATE_LIMIT_ENABLED=false
```

### Testing Configuration
```bash
# Testing settings
NODE_ENV=test
TEST_DATABASE_URL=postgresql://test:test@localhost:5432/test
TEST_REDIS_URL=redis://localhost:6379/1
TEST_TYPESENSE_HOST=localhost
TEST_TYPESENSE_PORT=8108
```

### Staging Configuration
```bash
# Staging settings
NODE_ENV=staging
API_BASE_URL=https://staging-api.openaccessexplorer.com
FRONTEND_BASE_URL=https://staging.openaccessexplorer.com
```

## 📋 Configuration Validation

### Environment Validation
```typescript
import Joi from 'joi';

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().port().default(4000),
  SEARCH_BACKEND: Joi.string().valid('typesense', 'meili', 'algolia').required(),
  TYPESENSE_HOST: Joi.string().when('SEARCH_BACKEND', {
    is: 'typesense',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  TYPESENSE_API_KEY: Joi.string().when('SEARCH_BACKEND', {
    is: 'typesense',
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

const { error, value } = envSchema.validate(process.env);
if (error) {
  throw new Error(`Configuration validation error: ${error.message}`);
}
```

### Configuration Testing
```typescript
// Test configuration on startup
async function validateConfiguration() {
  const checks = [
    validateSearchBackend(),
    validateDataSources(),
    validateCache(),
    validateExternalAPIs()
  ];
  
  const results = await Promise.allSettled(checks);
  const failures = results.filter(r => r.status === 'rejected');
  
  if (failures.length > 0) {
    console.warn('Configuration validation warnings:', failures);
  }
}
```

## 🔄 Configuration Updates

### Hot Reloading
```typescript
// Watch for configuration changes
const configWatcher = chokidar.watch('.env', {
  persistent: true,
  ignoreInitial: true
});

configWatcher.on('change', async (path) => {
  console.log('Configuration file changed, reloading...');
  await reloadConfiguration();
});
```

### Configuration Backup
```bash
# Backup configuration
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Restore configuration
cp .env.backup.20231201_143000 .env
```

---

*For deployment instructions, see the [Deployment Guide](./deployment.md).*
