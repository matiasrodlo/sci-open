import { describe, it, expect } from 'vitest';
import { AUTHORITIES } from '../registry';
import { paper } from '../../orchestrator/__tests__/helpers';

describe('which DOIs each authority is asked about', () => {
  const wants = (id: string, doi: string) => {
    const authority = AUTHORITIES.find(a => a.id === id)!;
    return authority.wants ? authority.wants(paper({ doi, citationCount: undefined, fullText: undefined })) : true;
  };

  it('asks neither Crossref nor Unpaywall about an arXiv DOI, which only DataCite holds', () => {
    expect(wants('crossref', '10.48550/arXiv.1706.03762')).toBe(false);
    expect(wants('unpaywall', '10.48550/arxiv.1706.03762')).toBe(false);
    expect(wants('crossref', '10.1038/171737a0')).toBe(true);
    expect(wants('unpaywall', '10.1038/171737a0')).toBe(true);
  });

  it('still asks OpenCitations, which counts the citations of arXiv DOIs', () => {
    expect(wants('opencitations', '10.48550/arXiv.1706.03762')).toBe(true);
  });
});
