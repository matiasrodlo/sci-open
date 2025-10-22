import { SourcePerformanceMetrics } from './smart-source-selector';

export interface PerformanceReport {
  timestamp: Date;
  queryType: string;
  domain: string;
  selectedSources: string[];
  totalLatency: number;
  resultCount: number;
  successRate: number;
  sourceBreakdown: SourceBreakdown[];
}

export interface SourceBreakdown {
  source: string;
  latency: number;
  resultCount: number;
  success: boolean;
  error?: string;
}

export interface AdaptiveLearningConfig {
  enabled: boolean;
  learningRate: number;
  minSamples: number;
  decayFactor: number;
  performanceThreshold: number;
}

export class PerformanceMonitor {
  private performanceHistory: PerformanceReport[] = [];
  private sourceMetrics: Map<string, SourcePerformanceMetrics> = new Map();
  private adaptiveConfig: AdaptiveLearningConfig;
  private maxHistorySize: number = 1000;

  constructor(config: AdaptiveLearningConfig) {
    this.adaptiveConfig = {
      ...config
    };
  }

  /**
   * Record performance data for a search operation
   */
  recordPerformance(report: PerformanceReport): void {
    // Add to history
    this.performanceHistory.push(report);
    
    // Maintain history size limit
    if (this.performanceHistory.length > this.maxHistorySize) {
      this.performanceHistory = this.performanceHistory.slice(-this.maxHistorySize);
    }

    // Update source metrics
    this.updateSourceMetrics(report);

    // Apply adaptive learning if enabled
    if (this.adaptiveConfig.enabled) {
      this.applyAdaptiveLearning();
    }
  }

  /**
   * Get performance metrics for a specific source
   */
  getSourceMetrics(source: string): SourcePerformanceMetrics | undefined {
    return this.sourceMetrics.get(source);
  }

  /**
   * Get all source metrics
   */
  getAllSourceMetrics(): Map<string, SourcePerformanceMetrics> {
    return new Map(this.sourceMetrics);
  }

  /**
   * Get performance trends for analysis
   */
  getPerformanceTrends(days: number = 7): {
    averageLatency: number;
    successRate: number;
    topPerformingSources: string[];
    underperformingSources: string[];
  } {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const recentReports = this.performanceHistory.filter(
      report => report.timestamp >= cutoffDate
    );

    if (recentReports.length === 0) {
      return {
        averageLatency: 0,
        successRate: 0,
        topPerformingSources: [],
        underperformingSources: []
      };
    }

    // Calculate average latency
    const totalLatency = recentReports.reduce((sum, report) => sum + report.totalLatency, 0);
    const averageLatency = totalLatency / recentReports.length;

    // Calculate success rate
    const successfulReports = recentReports.filter(report => report.successRate > 0.5);
    const successRate = successfulReports.length / recentReports.length;

    // Analyze source performance
    const sourcePerformance = new Map<string, { latency: number; success: number; count: number }>();
    
    recentReports.forEach(report => {
      report.sourceBreakdown.forEach(breakdown => {
        const existing = sourcePerformance.get(breakdown.source) || { latency: 0, success: 0, count: 0 };
        sourcePerformance.set(breakdown.source, {
          latency: existing.latency + breakdown.latency,
          success: existing.success + (breakdown.success ? 1 : 0),
          count: existing.count + 1
        });
      });
    });

    // Calculate source rankings
    const sourceRankings = Array.from(sourcePerformance.entries()).map(([source, metrics]) => ({
      source,
      avgLatency: metrics.latency / metrics.count,
      successRate: metrics.success / metrics.count,
      score: (metrics.success / metrics.count) * (1 - Math.min(metrics.latency / metrics.count / 3000, 1))
    }));

    const topPerformingSources = sourceRankings
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => s.source);

    const underperformingSources = sourceRankings
      .filter(s => s.score < this.adaptiveConfig.performanceThreshold)
      .map(s => s.source);

    return {
      averageLatency,
      successRate,
      topPerformingSources,
      underperformingSources
    };
  }

  /**
   * Get recommendations for source selection optimization
   */
  getOptimizationRecommendations(): {
    recommendations: string[];
    priority: 'high' | 'medium' | 'low';
  } {
    const trends = this.getPerformanceTrends();
    const recommendations: string[] = [];
    let priority: 'high' | 'medium' | 'low' = 'low';

    // Check overall performance
    if (trends.successRate < 0.8) {
      recommendations.push('Overall success rate is below 80%. Consider reviewing source reliability.');
      priority = 'high';
    }

    if (trends.averageLatency > 5000) {
      recommendations.push('Average latency is above 5 seconds. Consider optimizing source selection.');
      priority = priority === 'high' ? 'high' : 'medium';
    }

    // Check underperforming sources
    if (trends.underperformingSources.length > 0) {
      recommendations.push(
        `Consider reducing usage of underperforming sources: ${trends.underperformingSources.join(', ')}`
      );
      priority = priority === 'high' ? 'high' : 'medium';
    }

    // Check for source diversity
    const allSources = new Set<string>();
    this.performanceHistory.forEach(report => {
      report.selectedSources.forEach(source => allSources.add(source));
    });

    if (allSources.size < 3) {
      recommendations.push('Limited source diversity detected. Consider expanding source selection.');
      priority = priority === 'high' ? 'high' : 'low';
    }

    return { recommendations, priority };
  }

  /**
   * Export performance data for analysis
   */
  exportPerformanceData(): {
    reports: PerformanceReport[];
    sourceMetrics: Record<string, SourcePerformanceMetrics>;
    trends: ReturnType<typeof this.getPerformanceTrends>;
    recommendations: ReturnType<typeof this.getOptimizationRecommendations>;
  } {
    return {
      reports: [...this.performanceHistory],
      sourceMetrics: Object.fromEntries(this.sourceMetrics),
      trends: this.getPerformanceTrends(),
      recommendations: this.getOptimizationRecommendations()
    };
  }

  /**
   * Clear performance history
   */
  clearHistory(): void {
    this.performanceHistory = [];
    this.sourceMetrics.clear();
  }

  private updateSourceMetrics(report: PerformanceReport): void {
    report.sourceBreakdown.forEach(breakdown => {
      const existing = this.sourceMetrics.get(breakdown.source);
      const alpha = this.adaptiveConfig.learningRate;
      
      if (existing) {
        // Update with exponential moving average
        const newLatency = existing.averageLatency * (1 - alpha) + breakdown.latency * alpha;
        const newSuccessRate = existing.successRate * (1 - alpha) + (breakdown.success ? 1 : 0) * alpha;
        const newResultQuality = existing.resultQuality * (1 - alpha) + Math.min(breakdown.resultCount / 10, 1) * alpha;

        this.sourceMetrics.set(breakdown.source, {
          source: breakdown.source,
          averageLatency: newLatency,
          successRate: newSuccessRate,
          resultQuality: newResultQuality,
          lastUpdated: new Date()
        });
      } else {
        // Initialize new source
        this.sourceMetrics.set(breakdown.source, {
          source: breakdown.source,
          averageLatency: breakdown.latency,
          successRate: breakdown.success ? 1 : 0,
          resultQuality: Math.min(breakdown.resultCount / 10, 1),
          lastUpdated: new Date()
        });
      }
    });
  }

  private applyAdaptiveLearning(): void {
    // Apply decay to older metrics
    const decayFactor = this.adaptiveConfig.decayFactor;
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

    for (const [source, metrics] of this.sourceMetrics.entries()) {
      if (metrics.lastUpdated < cutoffTime) {
        const updatedMetrics: SourcePerformanceMetrics = {
          ...metrics,
          averageLatency: metrics.averageLatency * decayFactor,
          successRate: Math.max(metrics.successRate * decayFactor, 0.1),
          resultQuality: Math.max(metrics.resultQuality * decayFactor, 0.1)
        };
        this.sourceMetrics.set(source, updatedMetrics);
      }
    }
  }
}
