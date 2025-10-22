# Enhanced Citation Export System

This document describes the new Web of Science (WoS) level citation export functionality that has been added to the Open Access Explorer.

## Features

### 🎯 Multiple Citation Formats
- **BibTeX** - LaTeX bibliography format
- **EndNote** - EndNote reference format  
- **RIS** - Research Information Systems format
- **Web of Science** - WoS export format
- **APA Style** - American Psychological Association
- **MLA Style** - Modern Language Association
- **Chicago Style** - Chicago Manual of Style
- **Harvard Style** - Harvard referencing
- **Vancouver Style** - Medical journal format
- **Plain Text** - Simple text format

### 🔧 Enhanced Metadata
- Publisher information
- Volume, issue, and page numbers
- ISSN/ISBN identifiers
- Research areas and keywords
- Open access status
- Citation counts
- Language information
- Document type classification

### 📊 Export Options
- Include/exclude abstract
- Include/exclude keywords
- Include/exclude DOI
- Include/exclude URL
- Configurable author limits
- Batch export for multiple papers

## Usage

### Individual Paper Citations

```typescript
import { generateCitation, CitationOptions } from '@/lib/citations';

const options: CitationOptions = {
  format: 'apa',
  includeAbstract: true,
  includeKeywords: true,
  includeDOI: true,
  includeURL: true,
  maxAuthors: 20,
};

const citation = generateCitation(paper, options);
```

### Batch Export

```typescript
import { generateCitationsBatch } from '@/lib/citations';

const citations = generateCitationsBatch(papers, options);
```

### Download Citations

```typescript
import { downloadCitation, getFileExtension } from '@/lib/citations';

const filename = `references.${getFileExtension('bibtex')}`;
downloadCitation(citations, filename, 'bibtex');
```

## Components

### EnhancedExportButton
- Replaces the basic BibTeX export button
- Supports all citation formats
- Configurable export options
- Batch export capabilities

### EnhancedPaperActions
- Enhanced citation popover for individual papers
- Real-time citation preview
- Format selection and options
- Copy and download functionality

## File Structure

```
apps/web/lib/
├── citations.ts          # Main citation library
├── bibtex.ts            # Updated BibTeX wrapper

apps/web/components/
├── EnhancedExportButton.tsx      # Enhanced export component
└── paper/
    └── EnhancedPaperActions.tsx  # Enhanced paper actions
```

## Citation Format Examples

### APA Style
```
Smith, J., Johnson, A., & Brown, K. (2023). Machine Learning in Healthcare: A Comprehensive Review. Journal of Medical AI, 15(3), 123-145. https://doi.org/10.1234/example
```

### BibTeX
```bibtex
@article{Smith2023,
  title = {Machine Learning in Healthcare: A Comprehensive Review},
  author = {Smith, John and Johnson, Alice and Brown, Kevin},
  journal = {Journal of Medical AI},
  volume = {15},
  number = {3},
  pages = {123--145},
  year = {2023},
  doi = {10.1234/example},
  publisher = {Medical AI Press}
}
```

### EndNote
```
%0 Journal Article
%T Machine Learning in Healthcare: A Comprehensive Review
%A Smith, John
%A Johnson, Alice
%A Brown, Kevin
%J Journal of Medical AI
%V 15
%N 3
%P 123-145
%D 2023
%R 10.1234/example
%I Medical AI Press
```

### Web of Science
```
PT Journal Article
TI Machine Learning in Healthcare: A Comprehensive Review
AU Smith, John
AU Johnson, Alice
AU Brown, Kevin
SO Journal of Medical AI
VL 15
IS 3
BP 123-145
PY 2023
DI 10.1234/example
PU Medical AI Press
ER
```

## Integration

To use the enhanced citation system in your components:

1. Import the citation functions:
```typescript
import { generateCitation, CitationFormat } from '@/lib/citations';
```

2. Use the enhanced components:
```typescript
import { EnhancedExportButton } from '@/components/EnhancedExportButton';
import { EnhancedPaperActions } from '@/components/paper/EnhancedPaperActions';
```

3. Configure citation options as needed for your use case.

## Benefits

- **Academic Standards**: Supports all major citation formats used in academic publishing
- **Reference Manager Compatibility**: Works with EndNote, Zotero, Mendeley, and other tools
- **Flexible Export**: Choose what metadata to include in exports
- **Batch Processing**: Export multiple papers at once
- **User-Friendly**: Intuitive interface with real-time previews
- **Extensible**: Easy to add new citation formats or metadata fields

This enhanced system brings the citation export functionality to Web of Science level, providing researchers with professional-grade citation management capabilities.
