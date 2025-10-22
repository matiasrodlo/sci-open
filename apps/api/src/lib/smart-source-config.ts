import { SmartSourceSelector } from './smart-source-selector';
import { PerformanceMonitor } from './performance-monitor';
import { QueryAnalyzer } from './query-analyzer';
import { SourcePrioritizationConfig } from './source-prioritization';

export interface SmartSourceConfig {
  enabled: boolean;
  adaptiveLearning: boolean;
  performanceMonitoring: boolean;
  maxSources: number;
  timeoutMs: number;
  confidenceThreshold: number;
  fallbackStrategy: 'conservative' | 'aggressive' | 'balanced';
}

export interface TestQuery {
  query: string;
  expectedDomain: string;
  expectedType: string;
  expectedSources: string[];
  description: string;
}

export class SmartSourceConfigManager {
  private config: SmartSourceConfig;
  private selector: SmartSourceSelector;
  private monitor: PerformanceMonitor;
  private analyzer: QueryAnalyzer;
  private sourceConfig: SourcePrioritizationConfig;

  constructor(config: Partial<SmartSourceConfig> = {}) {
    this.config = {
      enabled: true,
      adaptiveLearning: true,
      performanceMonitoring: true,
      maxSources: 4,
      timeoutMs: 8000,
      confidenceThreshold: 0.6,
      fallbackStrategy: 'balanced',
      ...config
    };

    this.selector = new SmartSourceSelector();
    this.monitor = new PerformanceMonitor({
      enabled: this.config.performanceMonitoring,
      learningRate: 0.1,
      minSamples: 10,
      decayFactor: 0.95,
      performanceThreshold: 0.7
    });
    this.analyzer = new QueryAnalyzer();
    this.sourceConfig = new SourcePrioritizationConfig();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SmartSourceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update components
    this.selector.setAdaptiveLearning(this.config.adaptiveLearning);
    this.monitor = new PerformanceMonitor({
      enabled: this.config.performanceMonitoring,
      learningRate: 0.1,
      minSamples: 10,
      decayFactor: 0.95,
      performanceThreshold: 0.7
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): SmartSourceConfig {
    return { ...this.config };
  }

  /**
   * Test smart source selection with sample queries
   */
  async runTests(): Promise<{
    passed: number;
    failed: number;
    results: TestResult[];
  }> {
    const testQueries = this.getTestQueries();
    const results: TestResult[] = [];

    for (const testQuery of testQueries) {
      try {
        const analysis = this.analyzer.analyzeQuery({ q: testQuery.query });
        const selection = this.selector.selectSources({ q: testQuery.query });
        
        const result: TestResult = {
          query: testQuery.query,
          description: testQuery.description,
          expectedDomain: testQuery.expectedDomain,
          expectedType: testQuery.expectedType,
          expectedSources: testQuery.expectedSources,
          actualDomain: analysis.domain,
          actualType: analysis.type,
          actualSources: selection.selectedSources,
          confidence: selection.confidence,
          reasoning: selection.reasoning,
          passed: this.evaluateTestResult(testQuery, analysis, selection)
        };

        results.push(result);
      } catch (error) {
        results.push({
          query: testQuery.query,
          description: testQuery.description,
          expectedDomain: testQuery.expectedDomain,
          expectedType: testQuery.expectedType,
          expectedSources: testQuery.expectedSources,
          actualDomain: 'unknown',
          actualType: 'unknown',
          actualSources: [],
          confidence: 0,
          reasoning: `Error: ${error}`,
          passed: false
        });
      }
    }

    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;

    return { passed, failed, results };
  }

  /**
   * Get performance recommendations
   */
  getRecommendations(): {
    recommendations: string[];
    priority: 'high' | 'medium' | 'low';
    sourceMetrics: Record<string, any>;
  } {
    const monitorRecommendations = this.monitor.getOptimizationRecommendations();
    const sourceMetrics = this.monitor.getAllSourceMetrics();
    
    return {
      recommendations: monitorRecommendations.recommendations,
      priority: monitorRecommendations.priority,
      sourceMetrics: Object.fromEntries(sourceMetrics)
    };
  }

  /**
   * Export configuration and performance data
   */
  exportData(): {
    config: SmartSourceConfig;
    performance: any;
    recommendations: any;
  } {
    return {
      config: this.getConfig(),
      performance: this.monitor.exportPerformanceData(),
      recommendations: this.getRecommendations()
    };
  }

  private getTestQueries(): TestQuery[] {
    return [
      {
        query: '10.1038/nature12373',
        expectedDomain: 'general',
        expectedType: 'doi',
        expectedSources: ['crossref', 'openalex'],
        description: 'DOI lookup test'
      },
      {
        query: 'machine learning neural networks',
        expectedDomain: 'computerScience',
        expectedType: 'keywords',
        expectedSources: ['openalex', 'arxiv'],
        description: 'Computer science keyword search'
      },
      {
        query: 'cancer treatment immunotherapy',
        expectedDomain: 'biomedical',
        expectedType: 'keywords',
        expectedSources: ['europepmc', 'ncbi', 'openalex'],
        description: 'Biomedical keyword search'
      },
      {
        query: 'quantum mechanics entanglement',
        expectedDomain: 'physics',
        expectedType: 'keywords',
        expectedSources: ['arxiv', 'openalex'],
        description: 'Physics keyword search'
      },
      {
        query: 'Smith, J. and Johnson, A.',
        expectedDomain: 'general',
        expectedType: 'author',
        expectedSources: ['openalex', 'crossref'],
        description: 'Author search test'
      },
      {
        query: 'A novel approach to machine learning',
        expectedDomain: 'computerScience',
        expectedType: 'title',
        expectedSources: ['openalex', 'crossref'],
        description: 'Title search test'
      }
    ];
  }

  private evaluateTestResult(
    testQuery: TestQuery,
    analysis: any,
    selection: any
  ): boolean {
    // Check domain classification
    const domainMatch = analysis.domain === testQuery.expectedDomain;
    
    // Check query type classification
    const typeMatch = analysis.type === testQuery.expectedType;
    
    // Check source selection (at least one expected source should be selected)
    const sourceMatch = testQuery.expectedSources.some(expectedSource =>
      selection.selectedSources.includes(expectedSource)
    );
    
    // Check confidence threshold
    const confidenceMatch = selection.confidence >= this.config.confidenceThreshold;
    
    return domainMatch && typeMatch && sourceMatch && confidenceMatch;
  }
}

export interface TestResult {
  query: string;
  description: string;
  expectedDomain: string;
  expectedType: string;
  expectedSources: string[];
  actualDomain: string;
  actualType: string;
  actualSources: string[];
  confidence: number;
  reasoning: string;
  passed: boolean;
}
