import { HttpPoolMetrics } from './http-client-factory';

export interface PerformanceMetrics {
  timestamp: Date;
  service: string;
  totalRequests: number;
  reusedConnections: number;
  newConnections: number;
  connectionReuseRate: number;
  averageResponseTime: number;
  errorRate: number;
  throughput: number; // requests per second
}

export interface PerformanceComparison {
  before: PerformanceMetrics;
  after: PerformanceMetrics;
  improvement: {
    connectionReuseRate: number;
    responseTimeImprovement: number;
    errorRateReduction: number;
    throughputImprovement: number;
  };
}

export class HttpPerformanceMonitor {
  private static instance: HttpPerformanceMonitor;
  private metrics: Map<string, PerformanceMetrics[]> = new Map();
  private baselineMetrics: Map<string, PerformanceMetrics> = new Map();
  private isMonitoring: boolean = false;
  private monitoringInterval?: NodeJS.Timeout;

  static getInstance(): HttpPerformanceMonitor {
    if (!HttpPerformanceMonitor.instance) {
      HttpPerformanceMonitor.instance = new HttpPerformanceMonitor();
    }
    return HttpPerformanceMonitor.instance;
  }

  /**
   * Start monitoring HTTP performance
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      console.log('HTTP performance monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);

    console.log(`HTTP performance monitoring started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring HTTP performance
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    console.log('HTTP performance monitoring stopped');
  }

  /**
   * Collect current metrics from HTTP client factory
   */
  private collectMetrics(): void {
    const { httpClientFactory } = require('./http-client-factory');
    const allMetrics = httpClientFactory.getMetrics();

    if (allMetrics instanceof Map) {
      for (const [service, metrics] of allMetrics) {
        const performanceMetric: PerformanceMetrics = {
          timestamp: new Date(),
          service,
          totalRequests: metrics.totalRequests,
          reusedConnections: metrics.reusedConnections,
          newConnections: metrics.newConnections,
          connectionReuseRate: metrics.totalRequests > 0 ? metrics.reusedConnections / metrics.totalRequests : 0,
          averageResponseTime: metrics.averageResponseTime,
          errorRate: metrics.errorRate,
          throughput: this.calculateThroughput(service, metrics.totalRequests)
        };

        this.recordMetric(service, performanceMetric);
      }
    }
  }

  /**
   * Calculate throughput for a service
   */
  private calculateThroughput(service: string, totalRequests: number): number {
    const serviceMetrics = this.metrics.get(service) || [];
    if (serviceMetrics.length < 2) return 0;

    const latest = serviceMetrics[serviceMetrics.length - 1];
    const previous = serviceMetrics[serviceMetrics.length - 2];
    
    const timeDiff = latest.timestamp.getTime() - previous.timestamp.getTime();
    const requestDiff = latest.totalRequests - previous.totalRequests;
    
    return timeDiff > 0 ? (requestDiff / timeDiff) * 1000 : 0; // requests per second
  }

  /**
   * Record a performance metric
   */
  recordMetric(service: string, metric: PerformanceMetrics): void {
    if (!this.metrics.has(service)) {
      this.metrics.set(service, []);
    }
    
    const serviceMetrics = this.metrics.get(service)!;
    serviceMetrics.push(metric);
    
    // Keep only last 100 metrics per service
    if (serviceMetrics.length > 100) {
      serviceMetrics.shift();
    }
  }

  /**
   * Set baseline metrics for comparison
   */
  setBaseline(service: string, metric: PerformanceMetrics): void {
    this.baselineMetrics.set(service, metric);
    console.log(`Baseline metrics set for ${service}:`, {
      connectionReuseRate: metric.connectionReuseRate,
      averageResponseTime: metric.averageResponseTime,
      errorRate: metric.errorRate,
      throughput: metric.throughput
    });
  }

  /**
   * Get current metrics for a service
   */
  getCurrentMetrics(service: string): PerformanceMetrics | null {
    const serviceMetrics = this.metrics.get(service);
    if (!serviceMetrics || serviceMetrics.length === 0) return null;
    
    return serviceMetrics[serviceMetrics.length - 1];
  }

  /**
   * Get performance comparison for a service
   */
  getPerformanceComparison(service: string): PerformanceComparison | null {
    const baseline = this.baselineMetrics.get(service);
    const current = this.getCurrentMetrics(service);
    
    if (!baseline || !current) return null;

    return {
      before: baseline,
      after: current,
      improvement: {
        connectionReuseRate: current.connectionReuseRate - baseline.connectionReuseRate,
        responseTimeImprovement: baseline.averageResponseTime - current.averageResponseTime,
        errorRateReduction: baseline.errorRate - current.errorRate,
        throughputImprovement: current.throughput - baseline.throughput
      }
    };
  }

  /**
   * Get overall performance summary
   */
  getOverallPerformance(): {
    totalServices: number;
    averageConnectionReuse: number;
    averageResponseTime: number;
    averageErrorRate: number;
    totalThroughput: number;
    services: Array<{
      service: string;
      connectionReuseRate: number;
      averageResponseTime: number;
      errorRate: number;
      throughput: number;
    }>;
  } {
    const services: Array<{
      service: string;
      connectionReuseRate: number;
      averageResponseTime: number;
      errorRate: number;
      throughput: number;
    }> = [];

    let totalConnectionReuse = 0;
    let totalResponseTime = 0;
    let totalErrorRate = 0;
    let totalThroughput = 0;
    let serviceCount = 0;

    for (const [service, metrics] of this.metrics) {
      const latest = metrics[metrics.length - 1];
      if (latest) {
        services.push({
          service,
          connectionReuseRate: latest.connectionReuseRate,
          averageResponseTime: latest.averageResponseTime,
          errorRate: latest.errorRate,
          throughput: latest.throughput
        });

        totalConnectionReuse += latest.connectionReuseRate;
        totalResponseTime += latest.averageResponseTime;
        totalErrorRate += latest.errorRate;
        totalThroughput += latest.throughput;
        serviceCount++;
      }
    }

    return {
      totalServices: serviceCount,
      averageConnectionReuse: serviceCount > 0 ? totalConnectionReuse / serviceCount : 0,
      averageResponseTime: serviceCount > 0 ? totalResponseTime / serviceCount : 0,
      averageErrorRate: serviceCount > 0 ? totalErrorRate / serviceCount : 0,
      totalThroughput,
      services
    };
  }

  /**
   * Generate performance report
   */
  generateReport(): string {
    const overall = this.getOverallPerformance();
    const report = [
      '=== HTTP Connection Pooling Performance Report ===',
      `Timestamp: ${new Date().toISOString()}`,
      `Total Services: ${overall.totalServices}`,
      `Average Connection Reuse Rate: ${(overall.averageConnectionReuse * 100).toFixed(2)}%`,
      `Average Response Time: ${overall.averageResponseTime.toFixed(2)}ms`,
      `Average Error Rate: ${(overall.averageErrorRate * 100).toFixed(2)}%`,
      `Total Throughput: ${overall.totalThroughput.toFixed(2)} req/s`,
      '',
      'Service Details:',
      '================'
    ];

    for (const service of overall.services) {
      report.push(
        `${service.service}:`,
        `  Connection Reuse: ${(service.connectionReuseRate * 100).toFixed(2)}%`,
        `  Response Time: ${service.averageResponseTime.toFixed(2)}ms`,
        `  Error Rate: ${(service.errorRate * 100).toFixed(2)}%`,
        `  Throughput: ${service.throughput.toFixed(2)} req/s`,
        ''
      );
    }

    return report.join('\n');
  }

  /**
   * Export metrics to JSON
   */
  exportMetrics(): {
    timestamp: string;
    overall: ReturnType<HttpPerformanceMonitor['getOverallPerformance']>;
    services: Record<string, PerformanceMetrics[]>;
    baselines: Record<string, PerformanceMetrics>;
  } {
    const services: Record<string, PerformanceMetrics[]> = {};
    for (const [service, metrics] of this.metrics) {
      services[service] = metrics;
    }

    const baselines: Record<string, PerformanceMetrics> = {};
    for (const [service, baseline] of this.baselineMetrics) {
      baselines[service] = baseline;
    }

    return {
      timestamp: new Date().toISOString(),
      overall: this.getOverallPerformance(),
      services,
      baselines
    };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(): void {
    this.metrics.clear();
    this.baselineMetrics.clear();
    console.log('All HTTP performance metrics cleared');
  }
}

// Export singleton instance
export const httpPerformanceMonitor = HttpPerformanceMonitor.getInstance();
