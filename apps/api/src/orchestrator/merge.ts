import type { FieldSources, Paper, ProvenancedField, ProviderId } from '@open-access-explorer/shared';

/**
 * One work per paper, assembled from everything the providers said about it.
 *
 * Replaces the `canonical*` scheme, in which a field contributed by a second
 * provider was written to `canonicalAbstract`, `canonicalTitle` and so on —
 * four of the five of which were never read back. A paper whose abstract came
 * from a different provider than its title was returned with no abstract at
 * all. `fieldSources` records where a value came from without moving it out of
 * the field consumers read, which makes that failure structurally impossible.
 */

/** Trust order for choosing between two values of the same field. */
const PROVIDER_PRIORITY: Record<ProviderId, number> = {
  crossref: 1,
  openalex: 2,
  unpaywall: 3,
  europepmc: 4,
  core: 5,
  openaire: 6,
  plos: 7,
  arxiv: 8,
  biorxiv: 9,
  medrxiv: 10,
  doaj: 11,
  ncbi: 12,
  datacite: 13,
  opencitations: 14
};

function priorityOf(paper: Paper): number {
  return Math.min(...paper.sources.map(s => PROVIDER_PRIORITY[s.provider] ?? 99));
}

/**
 * Identity. DOI when there is one, else title and year.
 *
 * The title fallback matters more than it looks: 36% of records in a measured
 * result set carried no DOI, almost all of them preprints, and without it the
 * same preprint returned by two providers appears twice.
 *
 * A record with a DOI is never grouped with one without. That is deliberate
 * and it is currently costing us — 83 of 84 surviving duplicates in a
 * 1,500-record sample were a PubMed record with no DOI beside the same paper
 * from Europe PMC with one. The fix is to give PubMed its DOI (phase 08)
 * rather than to match across the two kinds of key, which would merge on title
 * alone and is how unrelated papers with generic titles get combined.
 */
export function identityKey(paper: Paper): string {
  if (paper.doi) return `doi:${normalizeDoi(paper.doi)}`;

  const title = paper.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (title) return `title:${title}|${paper.year ?? ''}`;

  const primary = paper.sources[0];
  return primary ? `src:${primary.provider}:${primary.nativeId}` : `id:${paper.id}`;
}

export function normalizeDoi(doi: string): string {
  return doi.toLowerCase().trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
}

/** Fields chosen between during a merge, in the order they are considered. */
const MERGEABLE: ProvenancedField[] = [
  'title', 'abstract', 'authors', 'year', 'venue', 'publisher',
  'topics', 'language', 'citationCount', 'oaStatus', 'fullText', 'landingPage'
];

function hasValue(paper: Paper, field: ProvenancedField): boolean {
  const value = (paper as any)[field];
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (field === 'oaStatus') return value !== 'unknown';
  return true;
}

/**
 * Merges a group describing one work.
 *
 * The highest-priority record is the base. Every field it is missing is taken
 * from the best record that has it, and `fieldSources` records that provider —
 * but only where the value came from somewhere other than the base, since
 * attributing every field of a single-source paper repeats what `sources`
 * already says.
 */
function mergeGroup(group: Paper[]): Paper {
  const ordered = [...group].sort((a, b) => priorityOf(a) - priorityOf(b));
  const [base, ...rest] = ordered;

  const merged: Paper = {
    ...base,
    topics: [...base.topics],
    sources: [...base.sources],
    fieldSources: { ...base.fieldSources }
  };

  const fieldSources: FieldSources = { ...merged.fieldSources };

  for (const contributor of rest) {
    for (const ref of contributor.sources) {
      if (!merged.sources.some(s => s.provider === ref.provider && s.nativeId === ref.nativeId)) {
        merged.sources.push(ref);
      }
    }

    for (const field of MERGEABLE) {
      if (hasValue(merged, field) || !hasValue(contributor, field)) continue;

      (merged as any)[field] = (contributor as any)[field];
      const from = contributor.fieldSources[field] ?? contributor.sources[0]?.provider;
      if (from) fieldSources[field] = from;
    }

    // Topics are additive rather than chosen: two providers describing the same
    // work with different keyword vocabularies both say something true.
    const newTopics = contributor.topics.filter(t => !merged.topics.includes(t));
    if (newTopics.length > 0) {
      merged.topics.push(...newTopics);
      const from = contributor.fieldSources.topics ?? contributor.sources[0]?.provider;
      if (from && !fieldSources.topics) fieldSources.topics = from;
    }

    if (!merged.doi && contributor.doi) merged.doi = contributor.doi;
  }

  merged.fieldSources = fieldSources;
  merged.sources.sort((a, b) => (PROVIDER_PRIORITY[a.provider] ?? 99) - (PROVIDER_PRIORITY[b.provider] ?? 99));
  return merged;
}

export function mergePapers(papers: readonly Paper[]): Paper[] {
  const groups = new Map<string, Paper[]>();

  for (const paper of papers) {
    const key = identityKey(paper);
    const group = groups.get(key);
    if (group) group.push(paper);
    else groups.set(key, [paper]);
  }

  return [...groups.values()].map(group => (group.length === 1 ? group[0] : mergeGroup(group)));
}
