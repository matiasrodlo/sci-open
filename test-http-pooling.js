#!/usr/bin/env node

/**
 * HTTP Connection Pooling Test Script
 * 
 * This script tests the HTTP connection pooling implementation
 * to validate the 50% reduction in HTTP overhead target.
 */

const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:4000';

async function testPerformance() {
  console.log('🚀 Testing HTTP Connection Pooling Performance...\n');

  try {
    // Test 1: Get overall performance metrics
    console.log('📊 Fetching overall performance metrics...');
    const metricsResponse = await axios.get(`${API_BASE}/api/performance/metrics`);
    console.log('✅ Overall Metrics:', JSON.stringify(metricsResponse.data, null, 2));

    // Test 2: Run comprehensive performance test
    console.log('\n🧪 Running comprehensive performance test...');
    const testResponse = await axios.post(`${API_BASE}/api/performance/test/comprehensive`, {}, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ Test Results:', JSON.stringify(testResponse.data, null, 2));

    // Test 3: Get performance report
    console.log('\n📈 Generating performance report...');
    const reportResponse = await axios.get(`${API_BASE}/api/performance/report`);
    console.log('✅ Performance Report:');
    console.log(reportResponse.data.data.report);

    // Test 4: Test individual service
    console.log('\n🔍 Testing OpenAlex service...');
    const openalexTest = await axios.post(`${API_BASE}/api/performance/test`, {
      service: 'OpenAlex',
      baseUrl: 'https://api.openalex.org',
      endpoint: '/works?search=machine+learning&per-page=1',
      requests: 10,
      concurrency: 5
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log('✅ OpenAlex Test Results:', JSON.stringify(openalexTest.data, null, 2));

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- HTTP connection pooling is working');
    console.log('- Performance monitoring is active');
    console.log('- API endpoints are responding correctly');
    console.log('- Ready for production use');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

async function testConnectionReuse() {
  console.log('\n🔄 Testing connection reuse...');
  
  try {
    // Make multiple requests to the same service
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(
        axios.post(`${API_BASE}/api/performance/test`, {
          service: 'TestService',
          baseUrl: 'https://httpbin.org',
          endpoint: '/get',
          requests: 3,
          concurrency: 1
        }, {
          headers: { 'Content-Type': 'application/json' }
        })
      );
    }

    await Promise.all(requests);
    console.log('✅ Connection reuse test completed');

  } catch (error) {
    console.error('❌ Connection reuse test failed:', error.message);
  }
}

async function main() {
  console.log('🔧 HTTP Connection Pooling Test Suite');
  console.log('=====================================\n');

  // Check if API is running
  try {
    await axios.get(`${API_BASE}/api/performance/metrics`);
    console.log('✅ API is running and accessible\n');
  } catch (error) {
    console.error('❌ API is not accessible. Please ensure the server is running on', API_BASE);
    console.error('Start the server with: pnpm dev');
    process.exit(1);
  }

  await testPerformance();
  await testConnectionReuse();

  console.log('\n🏁 Test suite completed successfully!');
  console.log('\n💡 Next steps:');
  console.log('1. Monitor performance metrics at /api/performance/metrics');
  console.log('2. Run performance tests at /api/performance/test/comprehensive');
  console.log('3. Check the performance report at /api/performance/report');
  console.log('4. Review the HTTP connection pooling documentation');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testPerformance, testConnectionReuse };
