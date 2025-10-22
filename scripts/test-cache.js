#!/usr/bin/env node

/**
 * Cache Performance Test Script
 * 
 * This script tests the advanced caching implementation to verify
 * the 75% performance improvement (2s → <500ms) is achieved.
 */

const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';
const TEST_QUERIES = [
  'machine learning',
  'artificial intelligence',
  'deep learning',
  'neural networks',
  'computer vision',
  'natural language processing',
  'data science',
  'statistics',
  'mathematics',
  'physics'
];

const TEST_PAPERS = [
  '10.1038/nature14539',
  '10.1126/science.aaa8415',
  '10.1038/nature14236',
  '10.1126/science.1259855',
  '10.1038/nature14486'
];

async function testSearchPerformance() {
  console.log('🔍 Testing Search Performance...\n');
  
  const results = [];
  
  for (const query of TEST_QUERIES) {
    console.log(`Testing query: "${query}"`);
    
    // First request (cache miss)
    const start1 = Date.now();
    const response1 = await axios.post(`${API_BASE}/api/search`, {
      q: query,
      page: 1,
      pageSize: 20
    });
    const time1 = Date.now() - start1;
    const cacheHit1 = response1.headers['x-cache-hit'];
    
    // Second request (cache hit)
    const start2 = Date.now();
    const response2 = await axios.post(`${API_BASE}/api/search`, {
      q: query,
      page: 1,
      pageSize: 20
    });
    const time2 = Date.now() - start2;
    const cacheHit2 = response2.headers['x-cache-hit'];
    
    const improvement = ((time1 - time2) / time1) * 100;
    
    results.push({
      query,
      firstRequest: { time: time1, cacheHit: cacheHit1 },
      secondRequest: { time: time2, cacheHit: cacheHit2 },
      improvement: improvement
    });
    
    console.log(`  First request: ${time1}ms (${cacheHit1})`);
    console.log(`  Second request: ${time2}ms (${cacheHit2})`);
    console.log(`  Improvement: ${improvement.toFixed(1)}%\n`);
  }
  
  return results;
}

async function testPaperPerformance() {
  console.log('📄 Testing Paper Performance...\n');
  
  const results = [];
  
  for (const paperId of TEST_PAPERS) {
    console.log(`Testing paper: "${paperId}"`);
    
    // First request (cache miss)
    const start1 = Date.now();
    const response1 = await axios.get(`${API_BASE}/api/paper/${paperId}`);
    const time1 = Date.now() - start1;
    const cacheHit1 = response1.headers['x-cache-hit'];
    
    // Second request (cache hit)
    const start2 = Date.now();
    const response2 = await axios.get(`${API_BASE}/api/paper/${paperId}`);
    const time2 = Date.now() - start2;
    const cacheHit2 = response2.headers['x-cache-hit'];
    
    const improvement = ((time1 - time2) / time1) * 100;
    
    results.push({
      paperId,
      firstRequest: { time: time1, cacheHit: cacheHit1 },
      secondRequest: { time: time2, cacheHit: cacheHit2 },
      improvement: improvement
    });
    
    console.log(`  First request: ${time1}ms (${cacheHit1})`);
    console.log(`  Second request: ${time2}ms (${cacheHit2})`);
    console.log(`  Improvement: ${improvement.toFixed(1)}%\n`);
  }
  
  return results;
}

async function getCacheMetrics() {
  console.log('📊 Fetching Cache Metrics...\n');
  
  try {
    const response = await axios.get(`${API_BASE}/api/cache/metrics`);
    const metrics = response.data;
    
    console.log('Cache Performance:');
    console.log(`  Total Hits: ${metrics.cache.hits}`);
    console.log(`  Total Misses: ${metrics.cache.misses}`);
    console.log(`  Hit Rate: ${((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(1)}%`);
    console.log(`  L1 Hits: ${metrics.cache.l1Hits}`);
    console.log(`  L2 Hits: ${metrics.cache.l2Hits}`);
    console.log(`  L3 Hits: ${metrics.cache.l3Hits}`);
    console.log(`  Avg Response Time: ${metrics.cache.avgResponseTime.toFixed(0)}ms`);
    console.log(`  Cache Size: ${metrics.cache.cacheSize}`);
    
    console.log('\nCache Warming:');
    console.log(`  Popular Queries: ${metrics.warming.popularQueries}`);
    console.log(`  Trending Papers: ${metrics.warming.trendingPapers}`);
    console.log(`  Warming in Progress: ${metrics.warming.warmingInProgress}`);
    
    return metrics;
  } catch (error) {
    console.error('Failed to fetch cache metrics:', error.message);
    return null;
  }
}

async function startCacheWarming() {
  console.log('🔥 Starting Cache Warming...\n');
  
  try {
    const response = await axios.post(`${API_BASE}/api/cache/warm`);
    console.log('Cache warming started successfully');
    return true;
  } catch (error) {
    console.error('Failed to start cache warming:', error.message);
    return false;
  }
}

async function generateReport(searchResults, paperResults, metrics) {
  console.log('\n' + '='.repeat(60));
  console.log('📈 PERFORMANCE TEST REPORT');
  console.log('='.repeat(60));
  
  // Search performance analysis
  const searchImprovements = searchResults.map(r => r.improvement);
  const avgSearchImprovement = searchImprovements.reduce((a, b) => a + b, 0) / searchImprovements.length;
  const maxSearchImprovement = Math.max(...searchImprovements);
  const minSearchImprovement = Math.min(...searchImprovements);
  
  console.log('\n🔍 SEARCH PERFORMANCE:');
  console.log(`  Average Improvement: ${avgSearchImprovement.toFixed(1)}%`);
  console.log(`  Best Improvement: ${maxSearchImprovement.toFixed(1)}%`);
  console.log(`  Worst Improvement: ${minSearchImprovement.toFixed(1)}%`);
  
  // Paper performance analysis
  const paperImprovements = paperResults.map(r => r.improvement);
  const avgPaperImprovement = paperImprovements.reduce((a, b) => a + b, 0) / paperImprovements.length;
  const maxPaperImprovement = Math.max(...paperImprovements);
  const minPaperImprovement = Math.min(...paperImprovements);
  
  console.log('\n📄 PAPER PERFORMANCE:');
  console.log(`  Average Improvement: ${avgPaperImprovement.toFixed(1)}%`);
  console.log(`  Best Improvement: ${maxPaperImprovement.toFixed(1)}%`);
  console.log(`  Worst Improvement: ${minPaperImprovement.toFixed(1)}%`);
  
  // Overall performance
  const overallImprovement = (avgSearchImprovement + avgPaperImprovement) / 2;
  
  console.log('\n🎯 OVERALL PERFORMANCE:');
  console.log(`  Overall Improvement: ${overallImprovement.toFixed(1)}%`);
  
  if (overallImprovement >= 75) {
    console.log('  ✅ TARGET ACHIEVED: 75%+ improvement reached!');
  } else if (overallImprovement >= 50) {
    console.log('  ⚠️  PARTIAL SUCCESS: 50%+ improvement achieved');
  } else {
    console.log('  ❌ TARGET NOT MET: Less than 50% improvement');
  }
  
  // Cache metrics analysis
  if (metrics) {
    const hitRate = (metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100;
    
    console.log('\n📊 CACHE METRICS:');
    console.log(`  Hit Rate: ${hitRate.toFixed(1)}%`);
    console.log(`  Avg Response Time: ${metrics.cache.avgResponseTime.toFixed(0)}ms`);
    console.log(`  Cache Size: ${metrics.cache.cacheSize}`);
    
    if (hitRate >= 85) {
      console.log('  ✅ Excellent cache hit rate!');
    } else if (hitRate >= 70) {
      console.log('  ⚠️  Good cache hit rate, room for improvement');
    } else {
      console.log('  ❌ Low cache hit rate, needs optimization');
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

async function main() {
  console.log('🚀 Advanced Cache Performance Test');
  console.log('=====================================\n');
  
  try {
    // Test API connectivity
    console.log('🔌 Testing API connectivity...');
    await axios.get(`${API_BASE}/health`);
    console.log('✅ API is accessible\n');
    
    // Start cache warming
    await startCacheWarming();
    
    // Wait a bit for warming to start
    console.log('⏳ Waiting for cache warming to initialize...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test search performance
    const searchResults = await testSearchPerformance();
    
    // Test paper performance
    const paperResults = await testPaperPerformance();
    
    // Get cache metrics
    const metrics = await getCacheMetrics();
    
    // Generate report
    await generateReport(searchResults, paperResults, metrics);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run the test
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testSearchPerformance,
  testPaperPerformance,
  getCacheMetrics,
  startCacheWarming,
  generateReport
};
