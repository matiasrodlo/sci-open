import { SearchParams } from '@open-access-explorer/shared';

export interface QueryAnalysis {
  type: 'doi' | 'title' | 'keywords' | 'author' | 'citation' | 'mixed';
  domain: 'biomedical' | 'computerScience' | 'physics' | 'chemistry' | 'mathematics' | 'general';
  complexity: 'simple' | 'complex';
  expectedResults: 'low' | 'medium' | 'high';
  timeSensitivity: 'low' | 'medium' | 'high';
}

export class QueryAnalyzer {
  private biomedicalKeywords = [
    'medicine', 'medical', 'clinical', 'patient', 'disease', 'treatment', 'therapy',
    'drug', 'pharmaceutical', 'biomedical', 'health', 'cancer', 'tumor', 'gene',
    'protein', 'dna', 'rna', 'cell', 'tissue', 'organ', 'surgery', 'diagnosis',
    'symptom', 'pathology', 'immunology', 'neurology', 'cardiology', 'oncology',
    'epidemiology', 'pharmacology', 'anatomy', 'physiology', 'biochemistry',
    'microbiology', 'virology', 'bacteriology', 'pathogen', 'infection'
  ];

  private computerScienceKeywords = [
    'algorithm', 'software', 'programming', 'computer', 'computing', 'data',
    'machine learning', 'artificial intelligence', 'ai', 'neural network',
    'deep learning', 'database', 'system', 'network', 'security', 'cryptography',
    'blockchain', 'distributed', 'parallel', 'optimization', 'complexity',
    'computational', 'cyber', 'digital', 'information', 'technology', 'tech',
    'programming', 'code', 'software engineering', 'computer vision', 'nlp',
    'natural language processing', 'robotics', 'automation'
  ];

  private physicsKeywords = [
    'physics', 'quantum', 'relativity', 'thermodynamics', 'mechanics',
    'electromagnetic', 'optics', 'particle', 'nuclear', 'atomic', 'molecular',
    'energy', 'force', 'momentum', 'wave', 'frequency', 'wavelength',
    'photon', 'electron', 'proton', 'neutron', 'field', 'magnetic',
    'electric', 'gravitational', 'cosmology', 'astrophysics', 'plasma',
    'solid state', 'condensed matter', 'statistical mechanics'
  ];

  private chemistryKeywords = [
    'chemistry', 'chemical', 'molecule', 'compound', 'reaction', 'synthesis',
    'catalyst', 'organic', 'inorganic', 'analytical', 'physical chemistry',
    'biochemistry', 'polymer', 'crystal', 'crystallography', 'spectroscopy',
    'chromatography', 'electrochemistry', 'thermochemistry', 'kinetics',
    'equilibrium', 'acid', 'base', 'ph', 'oxidation', 'reduction'
  ];

  private mathematicsKeywords = [
    'mathematics', 'math', 'mathematical', 'algebra', 'geometry', 'calculus',
    'statistics', 'probability', 'analysis', 'topology', 'number theory',
    'differential', 'integral', 'equation', 'function', 'theorem', 'proof',
    'optimization', 'linear', 'nonlinear', 'discrete', 'continuous',
    'algorithm', 'computation', 'numerical', 'approximation'
  ];

  private doiPattern = /^10\.\d{4,}\/[^\s]+$/i;
  private titlePattern = /^[A-Z][^.!?]*[.!?]?$/;
  private authorPattern = /\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:,\s*[A-Z][a-z]+\s+[A-Z][a-z]+)*\b/;
  private citationPattern = /\b(?:cited|references?|citations?|bibliography)\b/i;

  analyzeQuery(params: SearchParams): QueryAnalysis {
    const query = (params.q || '').toLowerCase().trim();
    
    if (!query) {
      return {
        type: 'mixed',
        domain: 'general',
        complexity: 'simple',
        expectedResults: 'medium',
        timeSensitivity: 'medium'
      };
    }

    // Determine query type
    const queryType = this.determineQueryType(query, params);
    
    // Determine domain
    const domain = this.determineDomain(query);
    
    // Determine complexity
    const complexity = this.determineComplexity(query);
    
    // Determine expected results
    const expectedResults = this.determineExpectedResults(query, domain, queryType);
    
    // Determine time sensitivity
    const timeSensitivity = this.determineTimeSensitivity(params);

    return {
      type: queryType,
      domain,
      complexity,
      expectedResults,
      timeSensitivity
    };
  }

  private determineQueryType(query: string, params: SearchParams): QueryAnalysis['type'] {
    // Check for DOI
    if (this.doiPattern.test(query)) {
      return 'doi';
    }

    // Check for title-like patterns
    if (this.titlePattern.test(query) && query.length > 20) {
      return 'title';
    }

    // Check for author patterns
    if (this.authorPattern.test(query)) {
      return 'author';
    }

    // Check for citation-related terms
    if (this.citationPattern.test(query)) {
      return 'citation';
    }

    // Check for keyword patterns
    const keywordIndicators = ['research', 'study', 'analysis', 'method', 'approach', 'technique'];
    if (keywordIndicators.some(indicator => query.includes(indicator))) {
      return 'keywords';
    }

    return 'mixed';
  }

  private determineDomain(query: string): QueryAnalysis['domain'] {
    const queryLower = query.toLowerCase();
    
    // Count domain-specific keywords
    const domainScores = {
      biomedical: this.countKeywords(queryLower, this.biomedicalKeywords),
      computerScience: this.countKeywords(queryLower, this.computerScienceKeywords),
      physics: this.countKeywords(queryLower, this.physicsKeywords),
      chemistry: this.countKeywords(queryLower, this.chemistryKeywords),
      mathematics: this.countKeywords(queryLower, this.mathematicsKeywords)
    };

    // Find domain with highest score
    const maxScore = Math.max(...Object.values(domainScores));
    
    if (maxScore === 0) {
      return 'general';
    }

    // Return domain with highest score
    for (const [domain, score] of Object.entries(domainScores)) {
      if (score === maxScore) {
        return domain as QueryAnalysis['domain'];
      }
    }

    return 'general';
  }

  private determineComplexity(query: string): QueryAnalysis['complexity'] {
    const complexityIndicators = [
      'complex', 'advanced', 'sophisticated', 'detailed', 'comprehensive',
      'multidisciplinary', 'interdisciplinary',
      'novel', 'innovative', 'cutting-edge', 'state-of-the-art'
    ];

    const hasComplexityIndicators = complexityIndicators.some(indicator => 
      query.toLowerCase().includes(indicator)
    );

    const wordCount = query.split(/\s+/).length;
    const hasMultipleConcepts = query.includes(' and ') || query.includes(' or ') || query.includes(' vs ');

    if (hasComplexityIndicators || wordCount > 10 || hasMultipleConcepts) {
      return 'complex';
    }

    return 'simple';
  }

  private determineExpectedResults(query: string, domain: QueryAnalysis['domain'], queryType: QueryAnalysis['type']): QueryAnalysis['expectedResults'] {
    // DOI queries typically return few results
    if (queryType === 'doi') {
      return 'low';
    }

    // Author queries often return many results
    if (queryType === 'author') {
      return 'high';
    }

    // Domain-specific expectations
    switch (domain) {
      case 'biomedical':
        return 'high'; // Biomedical has extensive literature
      case 'computerScience':
        return 'high'; // CS has rapidly growing literature
      case 'physics':
        return 'medium'; // Physics has substantial but focused literature
      case 'chemistry':
        return 'medium'; // Chemistry has good coverage
      case 'mathematics':
        return 'medium'; // Math has focused literature
      default:
        return 'medium';
    }
  }

  private determineTimeSensitivity(params: SearchParams): QueryAnalysis['timeSensitivity'] {
    // Check for time-sensitive indicators in query
    const timeSensitiveIndicators = [
      'urgent', 'emergency', 'critical', 'immediate', 'real-time',
      'live', 'current', 'recent', 'latest', 'newest'
    ];

    const query = (params.q || '').toLowerCase();
    const hasTimeSensitiveIndicators = timeSensitiveIndicators.some(indicator => 
      query.includes(indicator)
    );

    // Check if user has specified time constraints
    const hasTimeConstraints = params.filters?.yearFrom || params.filters?.yearTo;

    if (hasTimeSensitiveIndicators || hasTimeConstraints) {
      return 'high';
    }

    // Default to medium for most queries
    return 'medium';
  }

  private countKeywords(query: string, keywords: string[]): number {
    return keywords.reduce((count, keyword) => {
      return count + (query.includes(keyword) ? 1 : 0);
    }, 0);
  }

  /**
   * Get query characteristics for logging and monitoring
   */
  getQueryCharacteristics(queryAnalysis: QueryAnalysis): Record<string, any> {
    return {
      type: queryAnalysis.type,
      domain: queryAnalysis.domain,
      complexity: queryAnalysis.complexity,
      expectedResults: queryAnalysis.expectedResults,
      timeSensitivity: queryAnalysis.timeSensitivity,
      timestamp: new Date().toISOString()
    };
  }
}
