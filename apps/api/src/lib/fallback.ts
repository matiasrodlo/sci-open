import { OARecord } from '@open-access-explorer/shared';

export interface FallbackOptions {
  maxConcurrency?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  failFast?: boolean;
}

export interface FallbackResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  source: string;
  duration: number;
  attempt: number;
}

export class FallbackManager {
  private options: FallbackOptions;
  private activeRequests = 0;
  private requestQueue: Array<() => Promise<void>> = [];

  constructor(options: FallbackOptions = {}) {
    this.options = {
      maxConcurrency: 12,
      timeoutMs: 10000,
      retryAttempts: 2,
      retryDelayMs: 1000,
      failFast: false,
      ...options
    };
  }

  /**
   * Execute multiple fallback functions in parallel with concurrency control
   */
  async executeFallbacks<T>(
    fallbacks: Array<{
      name: string;
      fn: () => Promise<T>;
      priority?: number;
      timeout?: number;
    }>
  ): Promise<FallbackResult<T>[]> {
    // Sort by priority (lower number = higher priority)
    const sortedFallbacks = fallbacks.sort((a, b) => (a.priority || 100) - (b.priority || 100));

    const results: FallbackResult<T>[] = [];
    const promises: Promise<void>[] = [];

    for (const fallback of sortedFallbacks) {
      const promise = this.executeWithFallback(fallback, results);
      promises.push(promise);

      // If failFast is enabled and we have a successful result, break early
      if (this.options.failFast) {
        // Check if we already have a successful result
        const hasSuccess = results.some(r => r.success);
        if (hasSuccess) {
          break;
        }
      }
    }

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Execute a single fallback function with retry logic
   */
  private async executeWithFallback<T>(
    fallback: {
      name: string;
      fn: () => Promise<T>;
      timeout?: number;
    },
    results: FallbackResult<T>[]
  ): Promise<void> {
    const startTime = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.options.retryAttempts!; attempt++) {
      try {
        const timeout = fallback.timeout || this.options.timeoutMs!;
        const data = await this.withTimeout(fallback.fn(), timeout);
        
        const duration = Date.now() - startTime;
        results.push({
          success: true,
          data,
          source: fallback.name,
          duration,
          attempt
        });
        
        return; // Success, no need to retry
      } catch (error) {
        lastError = error as Error;
        
        // If this is the last attempt, record the failure
        if (attempt === this.options.retryAttempts) {
          const duration = Date.now() - startTime;
          results.push({
            success: false,
            error: lastError,
            source: fallback.name,
            duration,
            attempt
          });
        } else {
          // Wait before retrying
          await this.delay(this.options.retryDelayMs!);
        }
      }
    }
  }

  /**
   * Execute fallbacks in stages (fast sources first, then slower ones)
   */
  async executeInStages<T>(
    stages: Array<{
      name: string;
      fallbacks: Array<{
        name: string;
        fn: () => Promise<T>;
        timeout?: number;
      }>;
      maxResults?: number;
    }>
  ): Promise<FallbackResult<T>[]> {
    const allResults: FallbackResult<T>[] = [];

    for (const stage of stages) {
      const stageResults = await this.executeFallbacks(stage.fallbacks);
      allResults.push(...stageResults);

      // If we have enough results from this stage, we can stop
      if (stage.maxResults && allResults.length >= stage.maxResults) {
        break;
      }
    }

    return allResults;
  }

  /**
   * Add timeout to a promise
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  /**
   * Delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Utility function to create a fallback for a specific source
 */
export function createSourceFallback<T>(
  name: string,
  fn: () => Promise<T>,
  options: {
    priority?: number;
    timeout?: number;
  } = {}
) {
  return {
    name,
    fn,
    priority: options.priority || 100,
    timeout: options.timeout
  };
}

/**
 * Utility function to create staged fallbacks for different source types
 */
export function createStagedFallbacks<T>(
  sources: {
    fast: Array<{ name: string; fn: () => Promise<T>; timeout?: number }>;
    medium: Array<{ name: string; fn: () => Promise<T>; timeout?: number }>;
    slow: Array<{ name: string; fn: () => Promise<T>; timeout?: number }>;
  }
) {
  return [
    {
      name: 'fast-sources',
      fallbacks: sources.fast.map(s => ({ ...s, timeout: s.timeout || 2000 })),
      maxResults: 10
    },
    {
      name: 'medium-sources',
      fallbacks: sources.medium.map(s => ({ ...s, timeout: s.timeout || 5000 })),
      maxResults: 20
    },
    {
      name: 'slow-sources',
      fallbacks: sources.slow.map(s => ({ ...s, timeout: s.timeout || 10000 })),
      maxResults: 30
    }
  ];
}
