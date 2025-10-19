import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { SearchParams, SearchResponse, PaperResponse } from '@open-access-explorer/shared';
import { TypesenseAdapter, MeilisearchAdapter, AlgoliaAdapter } from '@open-access-explorer/search';
import { ArxivConnector } from './sources/arxiv';
import { CoreConnector } from './sources/core';
import { EuropePMCConnector } from './sources/europepmc';
import { NCBIConnector } from './sources/ncbi';
import { resolveBestPdf } from './lib/pdf';
import { getSearchCache, getPaperCache, generateCacheKey } from './lib/cache';

const fastify = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
  }
});

// Register plugins
fastify.register(cors, {
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
});

fastify.register(helmet);

// Initialize search adapter
let searchAdapter: any;
const searchBackend = process.env.SEARCH_BACKEND || 'typesense';

switch (searchBackend) {
  case 'typesense':
    searchAdapter = new TypesenseAdapter({
      host: process.env.TYPESENSE_HOST || 'localhost',
      port: parseInt(process.env.TYPESENSE_PORT || '8108'),
      protocol: process.env.TYPESENSE_PROTOCOL || 'http',
      apiKey: process.env.TYPESENSE_API_KEY || 'xyz'
    });
    break;
  case 'meili':
    searchAdapter = new MeilisearchAdapter({
      host: process.env.MEILI_HOST || 'http://localhost:7700',
      apiKey: process.env.MEILI_MASTER_KEY || 'xyz'
    });
    break;
  case 'algolia':
    searchAdapter = new AlgoliaAdapter({
      appId: process.env.ALGOLIA_APP_ID || '',
      apiKey: process.env.ALGOLIA_API_KEY || ''
    });
    break;
  default:
    throw new Error(`Unsupported search backend: ${searchBackend}`);
}

// Initialize source connectors
const arxivConnector = new ArxivConnector(process.env.ARXIV_BASE);
const coreConnector = new CoreConnector(process.env.CORE_BASE, process.env.CORE_API_KEY || '');
const europepmcConnector = new EuropePMCConnector(process.env.EUROPE_PMC_BASE);
const ncbiConnector = new NCBIConnector(process.env.NCBI_EUTILS_BASE, process.env.NCBI_API_KEY);

// Ensure search index exists
searchAdapter.ensureIndex().catch(console.error);

// Search endpoint
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  try {
    const params = request.body;
    const cacheKey = generateCacheKey('search', params);
    const searchCache = getSearchCache();
    
    // Check cache first
    const cached = searchCache.get<SearchResponse>(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=300');
      return cached;
    }

    // Perform search
    const searchResult = await searchAdapter.search({
      q: params.q,
      filters: params.filters,
      page: params.page || 1,
      pageSize: params.pageSize || 20,
      sort: params.sort || 'relevance'
    });

    // If low recall and we have a query, try remote sources
    if (searchResult.hits.length < 10 && (params.q || params.doi)) {
      const remoteResults = await Promise.allSettled([
        arxivConnector.search(params),
        coreConnector.search(params),
        europepmcConnector.search(params),
        ncbiConnector.search(params)
      ]);

      const allRemoteResults = remoteResults
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => (result as PromiseFulfilledResult<any>).value);

      // Deduplicate by DOI and title
      const seen = new Set<string>();
      const uniqueResults = allRemoteResults.filter(record => {
        const key = record.doi || record.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Add to search index asynchronously
      if (uniqueResults.length > 0) {
        searchAdapter.upsertMany(uniqueResults).catch(console.error);
      }

      // Merge results
      searchResult.hits = [...searchResult.hits, ...uniqueResults].slice(0, params.pageSize || 20);
      searchResult.total = Math.max(searchResult.total, searchResult.hits.length);
    }

    const response: SearchResponse = {
      hits: searchResult.hits,
      facets: searchResult.facets,
      page: params.page || 1,
      total: searchResult.total,
      pageSize: params.pageSize || 20
    };

    // Cache the result
    searchCache.set(cacheKey, response);

    reply.header('Cache-Control', 'public, max-age=300');
    return response;
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return { error: 'Internal server error' };
  }
});

// Paper endpoint
fastify.get<{ Params: { id: string } }>('/api/paper/:id', async (request, reply) => {
  try {
    const { id } = request.params;
    const cacheKey = generateCacheKey('paper', { id });
    const paperCache = getPaperCache();
    
    // Check cache first
    const cached = paperCache.get<PaperResponse>(cacheKey);
    if (cached) {
      reply.header('Cache-Control', 'public, max-age=600');
      return cached;
    }

    // Try to find the record in search index first
    let record;
    try {
      const searchResult = await searchAdapter.search({
        q: `id:${id}`,
        pageSize: 1
      });
      record = searchResult.hits[0];
    } catch (error) {
      // If not found in index, try to reconstruct from source
      const [source, sourceId] = id.split(':');
      if (source && sourceId) {
        // This is a simplified approach - in production you might want to store more metadata
        record = {
          id,
          source,
          sourceId,
          title: 'Unknown',
          authors: [],
          createdAt: new Date().toISOString()
        };
      }
    }

    if (!record) {
      reply.code(404);
      return { error: 'Paper not found' };
    }

    // Resolve PDF URL
    const pdfUrl = await resolveBestPdf(record);
    
    const response: PaperResponse = {
      record,
      pdf: {
        url: pdfUrl || undefined,
        status: pdfUrl ? 'ok' : 'not_found'
      }
    };

    // Cache the result
    paperCache.set(cacheKey, response);

    reply.header('Cache-Control', 'public, max-age=600');
    return response;
  } catch (error) {
    fastify.log.error(error);
    reply.code(500);
    return { error: 'Internal server error' };
  }
});

// Health check
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
