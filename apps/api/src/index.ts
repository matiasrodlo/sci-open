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

// Helper function to distribute results across sources
function distributeResultsAcrossSources(results: any[], pageSize: number): any[] {
  // Group results by source
  const bySource = results.reduce((acc, result) => {
    if (!acc[result.source]) acc[result.source] = [];
    acc[result.source].push(result);
    return acc;
  }, {} as Record<string, any[]>);

  const sources = Object.keys(bySource);
  const distributed: any[] = [];
  
  // Round-robin distribution across sources
  let sourceIndex = 0;
  while (distributed.length < pageSize && sources.length > 0) {
    const currentSource = sources[sourceIndex % sources.length];
    const sourceResults = bySource[currentSource];
    
    if (sourceResults.length > 0) {
      distributed.push(sourceResults.shift()!);
    } else {
      // Remove empty sources
      sources.splice(sourceIndex % sources.length, 1);
      if (sources.length === 0) break;
      sourceIndex = sourceIndex % sources.length;
      continue;
    }
    
    sourceIndex++;
  }
  
  return distributed;
}

// Search endpoint
fastify.post<{ Body: SearchParams }>('/api/search', async (request, reply) => {
  try {
    const params = request.body;
    const cacheKey = generateCacheKey('search', params);
    const searchCache = getSearchCache();
    
    // Check cache first
    const cached = searchCache.get<SearchResponse>(cacheKey);
    if (cached) {
      fastify.log.info({ cacheKey, query: params.q }, 'Returning cached search results');
      reply.header('Cache-Control', 'public, max-age=300');
      return cached;
    }
    
    fastify.log.info({ cacheKey, query: params.q }, 'No cache hit, performing fresh search');

    let searchResult: { hits: any[]; facets: Record<string, any>; total: number } = { hits: [], facets: {}, total: 0 };

    // Try search backend first, but gracefully handle failures
    try {
      searchResult = await searchAdapter.search({
        q: params.q,
        filters: params.filters,
        page: params.page || 1,
        pageSize: params.pageSize || 20,
        sort: params.sort || 'relevance'
      });
    } catch (searchError) {
      fastify.log.warn({ error: searchError }, 'Search backend unavailable, falling back to direct source queries');
      // Continue with empty search result - we'll query sources directly
    }

    // Always try remote sources when we have a query (since search backend is not available)
    if (params.q || params.doi) {
      fastify.log.info({ query: params.q || params.doi }, 'Querying remote sources');
      
      const searchParams = {
        titleOrKeywords: params.q,
        doi: params.doi,
        yearFrom: params.filters?.yearFrom,
        yearTo: params.filters?.yearTo
      };

      const remoteResults = await Promise.allSettled([
        arxivConnector.search(searchParams),
        coreConnector.search(searchParams),
        europepmcConnector.search(searchParams),
        ncbiConnector.search(searchParams)
      ]);

      // Debug: log the results from each source
      const sourceNames = ['arxiv', 'core', 'europepmc', 'ncbi'];
      remoteResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          fastify.log.info({ source: sourceNames[index], count: result.value.length }, 'Source results');
        } else {
          fastify.log.warn({ source: sourceNames[index], error: result.reason }, 'Source failed');
        }
      });

      const allRemoteResults = remoteResults
        .filter(result => result.status === 'fulfilled')
        .flatMap(result => (result as PromiseFulfilledResult<any>).value);

      // Deduplicate by DOI first, then by title+source combination
      const seen = new Set<string>();
      const uniqueResults = allRemoteResults.filter(record => {
        let key: string;
        if (record.doi) {
          // Use DOI as primary key for deduplication
          key = `doi:${record.doi}`;
        } else {
          // Use title+source combination for records without DOI
          key = `title:${record.title.toLowerCase()}:${record.source}`;
        }
        
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Add to search index asynchronously (if backend is available)
      if (uniqueResults.length > 0) {
        searchAdapter.upsertMany(uniqueResults).catch((error: any) => {
          fastify.log.warn({ error }, 'Failed to index results');
        });
      }

      // Distribute results across sources for better diversity
      const pageSize = params.pageSize || 20;
      const distributedResults = distributeResultsAcrossSources(uniqueResults, pageSize);
      
      searchResult.hits = distributedResults;
      searchResult.total = uniqueResults.length;
      
      // Generate basic facets from ALL unique results (not just the paginated ones)
      searchResult.facets = {
        source: uniqueResults.reduce((acc, record) => {
          acc[record.source] = (acc[record.source] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        year: uniqueResults.reduce((acc, record) => {
          if (record.year) {
            acc[record.year] = (acc[record.year] || 0) + 1;
          }
          return acc;
        }, {} as Record<string, number>),
        oaStatus: uniqueResults.reduce((acc, record) => {
          if (record.oaStatus) {
            acc[record.oaStatus] = (acc[record.oaStatus] || 0) + 1;
          }
          return acc;
        }, {} as Record<string, number>),
        venue: uniqueResults.reduce((acc, record) => {
          if (record.venue) {
            acc[record.venue] = (acc[record.venue] || 0) + 1;
          }
          return acc;
        }, {} as Record<string, number>)
      };
      
      fastify.log.info({ 
        totalResults: uniqueResults.length,
        facets: searchResult.facets 
      }, 'Generated facets from search results');
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
      // If not found in index, create a record from the ID
      const [source, sourceId] = id.split(':');
      if (source && sourceId) {
        // Create a basic record with known PDF URL for arXiv
        record = {
          id,
          source,
          sourceId,
          title: 'Unknown',
          authors: [],
          createdAt: new Date().toISOString()
        };
        
        // For arXiv, we can construct the PDF URL directly
        if (source === 'arxiv') {
          // arXiv PDF URLs use the full ID including version (e.g., 2409.12922v1)
          record.bestPdfUrl = `https://arxiv.org/pdf/${sourceId}`;
          record.landingPage = `https://arxiv.org/abs/${sourceId}`;
        }
      }
    }

    if (!record) {
      reply.code(404);
      return { error: 'Paper not found' };
    }

    // Resolve PDF URL
    let pdfUrl = await resolveBestPdf(record);
    let pdfStatus: "ok" | "not_found" | "error" = "not_found";
    
    // If we have a bestPdfUrl but resolveBestPdf failed, use it anyway
    if (!pdfUrl && record.bestPdfUrl) {
      pdfUrl = record.bestPdfUrl;
      pdfStatus = 'ok'; // Assume it's valid since it came from the source
    } else if (pdfUrl) {
      pdfStatus = 'ok';
    }
    
    const response: PaperResponse = {
      record,
      pdf: {
        url: pdfUrl || undefined,
        status: pdfStatus
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

// Debug endpoint to test source connectors
fastify.get('/debug/sources', async (request, reply) => {
  try {
    const testParams = { titleOrKeywords: 'ai' };
    
    const results = await Promise.allSettled([
      arxivConnector.search(testParams),
      europepmcConnector.search(testParams),
      coreConnector.search(testParams),
      ncbiConnector.search(testParams)
    ]);

    return {
      arxiv: results[0].status === 'fulfilled' ? results[0].value.length : results[0].reason?.message,
      europepmc: results[1].status === 'fulfilled' ? results[1].value.length : results[1].reason?.message,
      core: results[2].status === 'fulfilled' ? results[2].value.length : results[2].reason?.message,
      ncbi: results[3].status === 'fulfilled' ? results[3].value.length : results[3].reason?.message,
    };
  } catch (error) {
    reply.code(500);
    return { error: error.message };
  }
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
