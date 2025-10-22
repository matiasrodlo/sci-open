# Deployment Guide

This guide covers deploying the Open Access Explorer platform to production environments, including frontend, backend API, and search infrastructure.

## 🏗️ Deployment Architecture

### Production Stack
```
┌─────────────────────────────────────────────────────────────┐
│                    CDN (Cloudflare)                         │
│              • Global content delivery                      │
│              • DDoS protection                              │
│              • SSL termination                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (Vercel)                        │
│              • Next.js static generation                   │
│              • Automatic deployments                       │
│              • Edge functions                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    API (Railway/Render)                     │
│              • Fastify API server                          │
│              • Auto-scaling containers                      │
│              • Health monitoring                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Search Backend                            │
│              • Typesense Cloud                              │
│              • Managed infrastructure                       │
│              • Automatic backups                           │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 Frontend Deployment (Vercel)

### Prerequisites
- Vercel account
- GitHub repository connected to Vercel
- Environment variables configured

### Step 1: Connect Repository
1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "New Project"
3. Import your GitHub repository
4. Select the repository containing the Open Access Explorer

### Step 2: Configure Build Settings
```json
{
  "buildCommand": "pnpm build --filter=web",
  "outputDirectory": "apps/web/.next",
  "installCommand": "pnpm install",
  "framework": "nextjs"
}
```

### Step 3: Environment Variables
Set the following environment variables in Vercel dashboard:

```bash
# API Configuration
NEXT_PUBLIC_API_BASE=https://your-api-domain.com
NEXT_PUBLIC_SEARCH_BACKEND=typesense

# Optional: Analytics
NEXT_PUBLIC_GA_ID=your-google-analytics-id
```

### Step 4: Deploy
1. Vercel will automatically deploy on every push to main branch
2. Preview deployments are created for pull requests
3. Custom domains can be configured in project settings

### Step 5: Custom Domain (Optional)
1. Go to Project Settings → Domains
2. Add your custom domain (e.g., `openaccessexplorer.com`)
3. Configure DNS records as instructed by Vercel
4. SSL certificates are automatically provisioned

## 🔧 API Deployment (Railway)

### Prerequisites
- Railway account
- GitHub repository
- Environment variables

### Step 1: Create New Project
1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose your repository

### Step 2: Configure Service
```yaml
# railway.json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "pnpm start --filter=api",
    "healthcheckPath": "/health"
  }
}
```

### Step 3: Environment Variables
Set in Railway dashboard:

```bash
# Server Configuration
NODE_ENV=production
PORT=4000

# Search Backend
SEARCH_BACKEND=typesense
TYPESENSE_HOST=your-typesense-host
TYPESENSE_PORT=443
TYPESENSE_PROTOCOL=https
TYPESENSE_API_KEY=your-typesense-api-key

# Optional: Enhanced APIs
CORE_API_KEY=your-core-api-key
NCBI_API_KEY=your-ncbi-api-key
UNPAYWALL_EMAIL=your-email@example.com
```

### Step 4: Deploy
1. Railway automatically builds and deploys on git push
2. Monitor deployment logs in Railway dashboard
3. Configure custom domain in project settings

### Alternative: Render Deployment
```yaml
# render.yaml
services:
  - type: web
    name: open-access-explorer-api
    env: node
    buildCommand: pnpm build --filter=api
    startCommand: pnpm start --filter=api
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 4000
```

## 🔍 Search Backend Deployment

### Typesense Cloud (Recommended)

#### Step 1: Create Typesense Cloud Account
1. Go to [Typesense Cloud](https://cloud.typesense.org)
2. Sign up for a free account
3. Create a new cluster

#### Step 2: Configure Cluster
```bash
# Cluster Settings
Region: us-east-1 (or closest to your users)
Instance: 1GB RAM, 1 CPU (sufficient for development)
Storage: 10GB (expandable)
```

#### Step 3: Get Connection Details
```bash
# From Typesense Cloud Dashboard
TYPESENSE_HOST=your-cluster.typesense.net
TYPESENSE_PORT=443
TYPESENSE_PROTOCOL=https
TYPESENSE_API_KEY=your-api-key
```

#### Step 4: Create Collection Schema
```typescript
// Collection schema for oa_records
const schema = {
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
    { name: 'createdAt', type: 'string' }
  ],
  default_sorting_field: 'createdAt'
};
```

### Self-Hosted Typesense (Alternative)

#### Docker Deployment
```yaml
# docker-compose.yml
version: '3.8'
services:
  typesense:
    image: typesense/typesense:0.25.1
    ports:
      - "8108:8108"
    volumes:
      - typesense-data:/data
    command: '--data-dir /data --api-key=xyz --listen-port 8108 --enable-cors'
    environment:
      - TYPESENSE_DATA_DIR=/data

volumes:
  typesense-data:
```

#### Kubernetes Deployment
```yaml
# typesense-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: typesense
spec:
  replicas: 1
  selector:
    matchLabels:
      app: typesense
  template:
    metadata:
      labels:
        app: typesense
    spec:
      containers:
      - name: typesense
        image: typesense/typesense:0.25.1
        ports:
        - containerPort: 8108
        env:
        - name: TYPESENSE_DATA_DIR
          value: "/data"
        command: ["--data-dir", "/data", "--api-key", "xyz", "--listen-port", "8108", "--enable-cors"]
        volumeMounts:
        - name: typesense-storage
          mountPath: /data
      volumes:
      - name: typesense-storage
        persistentVolumeClaim:
          claimName: typesense-pvc
```

## 📊 Data Seeding

### Initial Data Population
```bash
# Seed the search index with initial data
pnpm seed

# Or with specific options
pnpm seed --sources=arxiv,core --limit=10000
```

### Automated Data Updates
```yaml
# GitHub Actions workflow for data updates
name: Update Search Index
on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm seed
        env:
          TYPESENSE_HOST: ${{ secrets.TYPESENSE_HOST }}
          TYPESENSE_API_KEY: ${{ secrets.TYPESENSE_API_KEY }}
```

## 🔒 Security Configuration

### SSL/TLS Certificates
- **Vercel**: Automatic SSL via Let's Encrypt
- **Railway**: Automatic SSL via Railway's infrastructure
- **Typesense Cloud**: Automatic SSL via cloud provider

### Environment Security
```bash
# Production environment variables
NODE_ENV=production
PORT=4000

# API Keys (store securely)
TYPESENSE_API_KEY=your-secure-api-key
CORE_API_KEY=your-core-api-key
NCBI_API_KEY=your-ncbi-api-key

# Email for polite API usage
UNPAYWALL_EMAIL=your-email@example.com
```

### Rate Limiting
```typescript
// API rate limiting configuration
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
};
```

### CORS Configuration
```typescript
// CORS settings for production
const corsOptions = {
  origin: [
    'https://your-frontend-domain.com',
    'https://www.your-frontend-domain.com'
  ],
  credentials: true,
  optionsSuccessStatus: 200
};
```

## 📈 Monitoring and Observability

### Health Checks
```typescript
// Comprehensive health monitoring
app.get('/health', async (request, reply) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      search: await checkSearchBackend(),
      sources: await checkDataSources(),
      cache: await checkCache()
    },
    metrics: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.env.npm_package_version
    }
  };
  
  return health;
});
```

### Logging Configuration
```typescript
// Production logging
const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard'
    }
  }
});
```

### Error Tracking
```typescript
// Sentry integration for error tracking
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV
});
```

## 🔄 CI/CD Pipeline

### GitHub Actions Workflow
```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm build --filter=web
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v20
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}

  deploy-api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: pnpm install
      - run: pnpm build --filter=api
      - name: Deploy to Railway
        uses: railway-app/railway-deploy@v1
        with:
          railway-token: ${{ secrets.RAILWAY_TOKEN }}
```

## 🚀 Performance Optimization

### Frontend Optimization
```javascript
// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true
  },
  images: {
    domains: ['example.com'],
    formats: ['image/webp', 'image/avif']
  },
  compress: true,
  poweredByHeader: false,
  generateEtags: false
};

module.exports = nextConfig;
```

### API Optimization
```typescript
// Caching configuration
const cacheConfig = {
  search: {
    ttl: 300000, // 5 minutes
    maxSize: 1000
  },
  paper: {
    ttl: 600000, // 10 minutes
    maxSize: 5000
  }
};
```

### Database Optimization
```typescript
// Typesense collection optimization
const collectionConfig = {
  name: 'oa_records',
  fields: [
    { name: 'title', type: 'string', facet: false },
    { name: 'authors', type: 'string[]', facet: true },
    { name: 'year', type: 'int32', facet: true },
    { name: 'venue', type: 'string', facet: true }
  ],
  default_sorting_field: 'createdAt',
  enable_nested_fields: true
};
```

## 🔧 Troubleshooting

### Common Issues

#### Frontend Build Failures
```bash
# Clear Next.js cache
rm -rf apps/web/.next
pnpm build --filter=web
```

#### API Connection Issues
```bash
# Check API health
curl https://your-api-domain.com/health

# Check search backend
curl https://your-api-domain.com/debug/sources
```

#### Search Backend Issues
```bash
# Test Typesense connection
curl -H "X-TYPESENSE-API-KEY: your-api-key" \
  https://your-typesense-host/collections/oa_records/documents/search?q=test
```

### Performance Issues

#### Slow Search Responses
1. Check search backend health
2. Verify network connectivity
3. Review query complexity
4. Check cache hit rates

#### High Memory Usage
1. Monitor memory usage in production
2. Implement connection pooling
3. Optimize data structures
4. Add memory limits

### Monitoring Setup

#### Uptime Monitoring
```yaml
# Uptime monitoring with UptimeRobot
monitors:
  - name: "Open Access Explorer API"
    url: "https://your-api-domain.com/health"
    interval: 5
    timeout: 30
  - name: "Open Access Explorer Frontend"
    url: "https://your-frontend-domain.com"
    interval: 5
    timeout: 30
```

#### Error Alerting
```typescript
// Error alerting configuration
const alertingConfig = {
  webhook: process.env.ALERT_WEBHOOK_URL,
  channels: ['#alerts'],
  thresholds: {
    errorRate: 0.05, // 5% error rate
    responseTime: 5000 // 5 seconds
  }
};
```

## 📋 Deployment Checklist

### Pre-Deployment
- [ ] Environment variables configured
- [ ] SSL certificates provisioned
- [ ] Domain DNS configured
- [ ] Search backend accessible
- [ ] API keys secured

### Deployment
- [ ] Frontend deployed
- [ ] API deployed and healthy
- [ ] Search backend configured
- [ ] Data seeded
- [ ] Health checks passing

### Post-Deployment
- [ ] End-to-end testing
- [ ] Performance monitoring
- [ ] Error tracking configured
- [ ] Backup procedures in place
- [ ] Documentation updated

---

*For development setup, see the [Development Guide](./development.md).*
