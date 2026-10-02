import type { Paper, ProviderId, SourceRef } from '@open-access-explorer/shared';

export const AT = '2026-08-29T00:00:00.000Z';

export function ref(provider: ProviderId, over: Partial<SourceRef> = {}): SourceRef {
  return { provider, nativeId: `${provider}-1`, rank: 0, retrievedAt: AT, ...over };
}

export function paper(over: Partial<Paper> = {}): Paper {
  return {
    id: 'europepmc:1',
    title: 'A study of things',
    authors: ['Lovelace, Ada'],
    topics: [],
    oaStatus: 'unknown',
    stage: 'published',
    sources: [ref('europepmc')],
    fieldSources: {},
    retrievedAt: AT,
    fullText: { url: 'https://example.org/p.pdf', kind: 'pdf', verified: false },
    ...over
  };
}
