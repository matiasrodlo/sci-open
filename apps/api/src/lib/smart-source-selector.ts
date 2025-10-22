import { SearchParams } from '@open-access-explorer/shared';
import { QueryAnalyzer, QueryAnalysis } from './query-analyzer';
import { SourcePrioritizationConfig, SourceSelectionStrategy, SourceCharacteristics } from './source-prioritization';

export interface SourceSelectionResult {
  selectedSources: string[];
  strategy: SourceSelectionStrategy;
  reasoning: string;
  estimatedLatency: number;
  confidence: number;
}

export interface SourcePerformanceMetrics {
  source: string;
  averageLatency: number;
  successRate: number;
  resultQuality: number;
  lastUpdated: Date;
}

export class SmartSourceSelector {
  private queryAnalyzer: QueryAnalyzer;
  private sourceConfig: SourcePrioritizationConfig;
  private performanceMetrics: Map<string, SourcePerformanceMetrics> = new Map();
  private adaptiveLearning: boolean = true;

  constructor() {
    this.queryAnalyzer = new QueryAnalyzer();
    this.sourceConfig = new SourcePrioritizationConfig();
    this.initializePerformanceMetrics();
  }

  /**
   * Select optimal sources based on query analysis
   */
  selectSources(params: SearchParams): SourceSelectionResult {
    const queryAnalysis = this.queryAnalyzer.analyzeQuery(params);
    const strategy = this.sourceConfig.getQueryStrategy(queryAnalysis);
    
    // Apply adaptive learning if enabled
    const optimizedStrategy = this.adaptiveLearning 
      ? this.optimizeStrategyWithLearning(strategy, queryAnalysis)
      : strategy;

    // Select sources based on strategy and performance
    const selectedSources = this.selectOptimalSources(optimizedStrategy, queryAnalysis);
    
    // Calculate estimated latency
    const estimatedLatency = this.calculateEstimatedLatency(selectedSources);
    
    // Generate reasoning
    const reasoning = this.generateReasoning(queryAnalysis, selectedSources, optimizedStrategy);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(queryAnalysis, selectedSources);

    return {
      selectedSources,
      strategy: optimizedStrategy,
      reasoning,
      estimatedLatency,
      confidence
    };
  }

  /**
   * Update performance metrics for a source
   */
  updateSourcePerformance(
    source: string, 
    latency: number, 
    success: boolean, 
    resultCount: number
  ): void {
    const current = this.performanceMetrics.get(source);
    if (!current) return;

    // Update metrics with exponential moving average
    const alpha = 0.1; // Learning rate
    const newLatency = current.averageLatency * (1 - alpha) + latency * alpha;
    const newSuccessRate = current.successRate * (1 - alpha) + (success ? 1 : 0) * alpha;
    const newResultQuality = current.resultQuality * (1 - alpha) + Math.min(resultCount / 10, 1) * alpha;

    this.performanceMetrics.set(source, {
      source,
      averageLatency: newLatency,
      successRate: newSuccessRate,
      resultQuality: newResultQuality,
      lastUpdated: new Date()
    });
  }

  /**
   * Get current performance metrics for all sources
   */
  getPerformanceMetrics(): Map<string, SourcePerformanceMetrics> {
    return new Map(this.performanceMetrics);
  }

  /**
   * Enable or disable adaptive learning
   */
  setAdaptiveLearning(enabled: boolean): void {
    this.adaptiveLearning = enabled;
  }

  private initializePerformanceMetrics(): void {
    const allSources = this.sourceConfig.getAllSources();
    
    allSources.forEach(source => {
      const characteristics = this.sourceConfig.getSourceCharacteristics(source);
      if (characteristics) {
        this.performanceMetrics.set(source, {
          source,
          averageLatency: characteristics.averageLatency,
          successRate: characteristics.reliability,
          resultQuality: 0.5, // Start with neutral quality
          lastUpdated: new Date()
        });
      }
    });
  }

  private optimizeStrategyWithLearning(
    baseStrategy: SourceSelectionStrategy, 
    queryAnalysis: QueryAnalysis
  ): SourceSelectionStrategy {
    if (!this.adaptiveLearning) {
      return baseStrategy;
    }

    // Create optimized strategy based on performance metrics
    const optimizedSources = this.rankSourcesByPerformance(baseStrategy.primary);
    const optimizedSecondary = this.rankSourcesByPerformance(baseStrategy.secondary);
    const optimizedFallback = this.rankSourcesByPerformance(baseStrategy.fallback);

    return {
      primary: optimizedSources.slice(0, Math.min(2, baseStrategy.primary.length)),
      secondary: optimizedSecondary.slice(0, Math.min(2, baseStrategy.secondary.length)),
      fallback: optimizedFallback,
      maxSources: baseStrategy.maxSources,
      timeoutMs: baseStrategy.timeoutMs
    };
  }

  private rankSourcesByPerformance(sources: string[]): string[] {
    return sources
      .map(source => ({
        source,
        metrics: this.performanceMetrics.get(source)
      }))
      .filter(item => item.metrics)
      .sort((a, b) => {
        if (!a.metrics || !b.metrics) return 0;
        
        // Composite score: success rate (40%) + result quality (30%) + latency (30%)
        const scoreA = a.metrics.successRate * 0.4 + 
                      a.metrics.resultQuality * 0.3 + 
                      (1 - Math.min(a.metrics.averageLatency / 3000, 1)) * 0.3;
        const scoreB = b.metrics.successRate * 0.4 + 
                      b.metrics.resultQuality * 0.3 + 
                      (1 - Math.min(b.metrics.averageLatency / 3000, 1)) * 0.3;
        
        return scoreB - scoreA;
      })
      .map(item => item.source);
  }

  private selectOptimalSources(
    strategy: SourceSelectionStrategy, 
    queryAnalysis: QueryAnalysis
  ): string[] {
    const selectedSources: string[] = [];
    
    // Add primary sources
    for (const source of strategy.primary) {
      if (selectedSources.length >= strategy.maxSources) break;
      if (this.isSourceSuitable(source, queryAnalysis)) {
        selectedSources.push(source);
      }
    }

    // Add secondary sources if needed
    if (selectedSources.length < strategy.maxSources) {
      for (const source of strategy.secondary) {
        if (selectedSources.length >= strategy.maxSources) break;
        if (!selectedSources.includes(source) && this.isSourceSuitable(source, queryAnalysis)) {
          selectedSources.push(source);
        }
      }
    }

    // Add fallback sources if still needed
    if (selectedSources.length < strategy.maxSources) {
      for (const source of strategy.fallback) {
        if (selectedSources.length >= strategy.maxSources) break;
        if (!selectedSources.includes(source) && this.isSourceSuitable(source, queryAnalysis)) {
          selectedSources.push(source);
        }
      }
    }

    return selectedSources;
  }

  private isSourceSuitable(source: string, queryAnalysis: QueryAnalysis): boolean {
    const characteristics = this.sourceConfig.getSourceCharacteristics(source);
    if (!characteristics) return false;

    // Check domain suitability
    const domainScore = characteristics.coverage[queryAnalysis.domain as keyof typeof characteristics.coverage];
    if (domainScore < 0.3) return false;

    // Check query type suitability
    const queryTypeScore = characteristics.queryTypes[queryAnalysis.type as keyof typeof characteristics.queryTypes];
    if (queryTypeScore < 0.5) return false;

    // Check performance metrics if available
    const metrics = this.performanceMetrics.get(source);
    if (metrics && metrics.successRate < 0.5) return false;

    return true;
  }

  private calculateEstimatedLatency(selectedSources: string[]): number {
    if (selectedSources.length === 0) return 0;

    const latencies = selectedSources
      .map(source => {
        const metrics = this.performanceMetrics.get(source);
        const characteristics = this.sourceConfig.getSourceCharacteristics(source);
        
        if (metrics) {
          return metrics.averageLatency;
        } else if (characteristics) {
          return characteristics.averageLatency;
        }
        return 2000; // Default fallback
      })
      .filter(latency => latency > 0);

    if (latencies.length === 0) return 2000;

    // Return the maximum latency since sources run in parallel
    return Math.max(...latencies);
  }

  private generateReasoning(
    queryAnalysis: QueryAnalysis, 
    selectedSources: string[], 
    strategy: SourceSelectionStrategy
  ): string {
    const reasons: string[] = [];

    // Query type reasoning
    switch (queryAnalysis.type) {
      case 'doi':
        reasons.push('DOI query detected - prioritizing DOI authorities');
        break;
      case 'author':
        reasons.push('Author search detected - using comprehensive sources');
        break;
      case 'title':
        reasons.push('Title search detected - using metadata-rich sources');
        break;
      default:
        reasons.push('Keyword search detected - using broad coverage sources');
    }

    // Domain reasoning
    if (queryAnalysis.domain !== 'general') {
      reasons.push(`${queryAnalysis.domain} domain detected - using specialized sources`);
    }

    // Performance reasoning
    if (queryAnalysis.timeSensitivity === 'high') {
      reasons.push('Time-sensitive query - prioritizing fast sources');
    }

    // Source selection reasoning
    if (selectedSources.length < strategy.maxSources) {
      reasons.push(`Limited to ${selectedSources.length} sources based on query characteristics`);
    }

    return reasons.join('; ');
  }

  private calculateConfidence(
    queryAnalysis: QueryAnalysis, 
    selectedSources: string[]
  ): number {
    if (selectedSources.length === 0) return 0;

    let confidence = 0.5; // Base confidence

    // Increase confidence for domain-specific queries
    if (queryAnalysis.domain !== 'general') {
      confidence += 0.2;
    }

    // Increase confidence for clear query types
    if (queryAnalysis.type !== 'mixed') {
      confidence += 0.1;
    }

    // Increase confidence based on source performance
    const avgSuccessRate = selectedSources.reduce((sum, source) => {
      const metrics = this.performanceMetrics.get(source);
      return sum + (metrics?.successRate || 0.5);
    }, 0) / selectedSources.length;

    confidence += avgSuccessRate * 0.3;

    return Math.min(confidence, 1.0);
  }
}
