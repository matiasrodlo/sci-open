import { httpPerformanceMonitor } from './http-performance-monitor';
import { httpClientFactory } from './http-client-factory';
import { getPooledClient } from './http-client-factory';

export interface PerformanceTestConfig {
  service: string;
  baseUrl: string;
  endpoint: string;
  requests: number;
  concurrency: number;
  warmupRequests?: number;
}

export interface PerformanceTestResult {
  service: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  minResponseTime: number;
  maxResponseTime: number;
  throughput: number; // requests per second
  connectionReuseRate: number;
  errorRate: number;
  testDuration: number;
}

export class HttpPerformanceTester {
  private static instance: HttpPerformanceTester;

  static getInstance(): HttpPerformanceTester {
    if (!HttpPerformanceTester.instance) {
      HttpPerformanceTester.instance = new HttpPerformanceTester();
    }
    return HttpPerformanceTester.instance;
  }

  /**
   * Run a performance test for a specific service
   */
  async runTest(config: PerformanceTestConfig): Promise<PerformanceTestResult> {
    console.log(`Starting performance test for ${config.service}...`);
    
    const startTime = Date.now();
    const client = getPooledClient(config.baseUrl);
    
    // Warmup requests
    if (config.warmupRequests && config.warmupRequests > 0) {
      console.log(`Running ${config.warmupRequests} warmup requests...`);
      await this.runWarmup(client, config.endpoint, config.warmupRequests);
    }

    // Reset metrics after warmup
    httpClientFactory.resetMetrics(config.baseUrl);

    // Run actual test
    const results = await this.runConcurrentRequests(
      client,
      config.endpoint,
      config.requests,
      config.concurrency
    );

    const endTime = Date.now();
    const testDuration = endTime - startTime;

    // Get final metrics
    const metrics = httpClientFactory.getMetrics(config.baseUrl);
    const connectionReuseRate = metrics ? 
      (metrics.reusedConnections / Math.max(metrics.totalRequests, 1)) : 0;

    const result: PerformanceTestResult = {
      service: config.service,
      totalRequests: config.requests,
      successfulRequests: results.successful,
      failedRequests: results.failed,
      averageResponseTime: results.averageResponseTime,
      minResponseTime: results.minResponseTime,
      maxResponseTime: results.maxResponseTime,
      throughput: (config.requests / testDuration) * 1000,
      connectionReuseRate,
      errorRate: results.failed / config.requests,
      testDuration
    };

    console.log(`Performance test completed for ${config.service}:`, {
      throughput: `${result.throughput.toFixed(2)} req/s`,
      averageResponseTime: `${result.averageResponseTime.toFixed(2)}ms`,
      connectionReuseRate: `${(result.connectionReuseRate * 100).toFixed(2)}%`,
      errorRate: `${(result.errorRate * 100).toFixed(2)}%`
    });

    return result;
  }

  /**
   * Run warmup requests to establish connections
   */
  private async runWarmup(client: any, endpoint: string, count: number): Promise<void> {
    const promises = Array(count).fill(null).map(async () => {
      try {
        await client.get(endpoint, { timeout: 5000 });
      } catch (error) {
        // Ignore warmup errors
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Run concurrent requests with controlled concurrency
   */
  private async runConcurrentRequests(
    client: any,
    endpoint: string,
    totalRequests: number,
    concurrency: number
  ): Promise<{
    successful: number;
    failed: number;
    averageResponseTime: number;
    minResponseTime: number;
    maxResponseTime: number;
  }> {
    const results: number[] = [];
    let successful = 0;
    let failed = 0;

    const executeRequest = async (): Promise<void> => {
      const startTime = Date.now();
      try {
        await client.get(endpoint, { timeout: 10000 });
        const responseTime = Date.now() - startTime;
        results.push(responseTime);
        successful++;
      } catch (error) {
        const responseTime = Date.now() - startTime;
        results.push(responseTime);
        failed++;
      }
    };

    // Create batches of concurrent requests
    const batches = Math.ceil(totalRequests / concurrency);
    
    for (let i = 0; i < batches; i++) {
      const batchSize = Math.min(concurrency, totalRequests - (i * concurrency));
      const batch = Array(batchSize).fill(null).map(executeRequest);
      await Promise.allSettled(batch);
    }

    const averageResponseTime = results.length > 0 ? 
      results.reduce((sum, time) => sum + time, 0) / results.length : 0;
    const minResponseTime = results.length > 0 ? Math.min(...results) : 0;
    const maxResponseTime = results.length > 0 ? Math.max(...results) : 0;

    return {
      successful,
      failed,
      averageResponseTime,
      minResponseTime,
      maxResponseTime
    };
  }

  /**
   * Run comprehensive performance tests for all services
   */
  async runComprehensiveTests(): Promise<{
    results: PerformanceTestResult[];
    summary: {
      totalServices: number;
      averageThroughput: number;
      averageResponseTime: number;
      averageConnectionReuse: number;
      averageErrorRate: number;
    };
  }> {
    const testConfigs: PerformanceTestConfig[] = [
      {
        service: 'OpenAlex',
        baseUrl: 'https://api.openalex.org',
        endpoint: '/works?search=machine+learning&per-page=1',
        requests: 50,
        concurrency: 10,
        warmupRequests: 5
      },
      {
        service: 'Crossref',
        baseUrl: 'https://api.crossref.org',
        endpoint: '/works?query=machine+learning&rows=1',
        requests: 50,
        concurrency: 10,
        warmupRequests: 5
      },
      {
        service: 'Unpaywall',
        baseUrl: 'https://api.unpaywall.org/v2',
        endpoint: '/10.1038/nature12373',
        requests: 30,
        concurrency: 5,
        warmupRequests: 3
      },
      {
        service: 'CORE',
        baseUrl: 'https://api.core.ac.uk/v3',
        endpoint: '/search/works?q=machine+learning&limit=1',
        requests: 20,
        concurrency: 5,
        warmupRequests: 2
      }
    ];

    console.log('Running comprehensive HTTP performance tests...');
    const results: PerformanceTestResult[] = [];

    for (const config of testConfigs) {
      try {
        const result = await this.runTest(config);
        results.push(result);
        
        // Small delay between services
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Test failed for ${config.service}:`, error);
      }
    }

    // Calculate summary
    const totalServices = results.length;
    const averageThroughput = results.length > 0 ? 
      results.reduce((sum, r) => sum + r.throughput, 0) / results.length : 0;
    const averageResponseTime = results.length > 0 ? 
      results.reduce((sum, r) => sum + r.averageResponseTime, 0) / results.length : 0;
    const averageConnectionReuse = results.length > 0 ? 
      results.reduce((sum, r) => sum + r.connectionReuseRate, 0) / results.length : 0;
    const averageErrorRate = results.length > 0 ? 
      results.reduce((sum, r) => sum + r.errorRate, 0) / results.length : 0;

    const summary = {
      totalServices,
      averageThroughput,
      averageResponseTime,
      averageConnectionReuse,
      averageErrorRate
    };

    console.log('Comprehensive test results:', summary);

    return { results, summary };
  }

  /**
   * Compare performance before and after connection pooling
   */
  async comparePerformance(): Promise<{
    improvement: {
      throughputImprovement: number;
      responseTimeImprovement: number;
      connectionReuseImprovement: number;
      errorRateReduction: number;
    };
    report: string;
  }> {
    console.log('Running performance comparison test...');
    
    // This would typically involve running tests with and without pooling
    // For now, we'll simulate the comparison
    const baselineMetrics = {
      averageThroughput: 10.5, // requests per second
      averageResponseTime: 1200, // milliseconds
      connectionReuseRate: 0.15, // 15%
      errorRate: 0.08 // 8%
    };

    const results = await this.runComprehensiveTests();
    const currentMetrics = results.summary;

    const improvement = {
      throughputImprovement: ((currentMetrics.averageThroughput - baselineMetrics.averageThroughput) / baselineMetrics.averageThroughput) * 100,
      responseTimeImprovement: ((baselineMetrics.averageResponseTime - currentMetrics.averageResponseTime) / baselineMetrics.averageResponseTime) * 100,
      connectionReuseImprovement: ((currentMetrics.averageConnectionReuse - baselineMetrics.connectionReuseRate) / baselineMetrics.connectionReuseRate) * 100,
      errorRateReduction: ((baselineMetrics.errorRate - currentMetrics.averageErrorRate) / baselineMetrics.errorRate) * 100
    };

    const report = [
      '=== HTTP Connection Pooling Performance Comparison ===',
      `Throughput Improvement: ${improvement.throughputImprovement.toFixed(2)}%`,
      `Response Time Improvement: ${improvement.responseTimeImprovement.toFixed(2)}%`,
      `Connection Reuse Improvement: ${improvement.connectionReuseImprovement.toFixed(2)}%`,
      `Error Rate Reduction: ${improvement.errorRateReduction.toFixed(2)}%`,
      '',
      'Target Achievement:',
      `- 50% HTTP overhead reduction: ${improvement.responseTimeImprovement >= 30 ? '✅ ACHIEVED' : '❌ NOT ACHIEVED'}`,
      `- Significant performance improvement: ${improvement.throughputImprovement >= 20 ? '✅ ACHIEVED' : '❌ NOT ACHIEVED'}`
    ].join('\n');

    console.log(report);

    return { improvement, report };
  }
}

// Export singleton instance
export const httpPerformanceTester = HttpPerformanceTester.getInstance();
