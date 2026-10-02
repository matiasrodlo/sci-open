import * as z from 'zod';
import type { Paper } from '@open-access-explorer/shared';
import { parseQuery } from '@open-access-explorer/core';
import pLimit from '../p-limit';
import { defineTool, type ToolDeps } from '../framework/define-tool';
import { toToolError } from '../errors';
import { parseReference, type ParsedReference } from '../references/parse';
import { judge, titleOverlap, tokens, type Judgement } from '../references/match';
import { shapePaper, paperSchema } from '../shape/paper';
import { fenceUntrusted } from '../safety/untrusted';
import { sanitizeText } from '../safety/sanitize';

const VERDICTS = ['verified', 'likely', 'ambiguous', 'mismatch', 'not_found', 'not_checked'] as const;

const resultSchema = z.object({
  input: z.string(),
  verdict: z.enum(VERDICTS),
  matched: paperSchema.optional(),
  evidence: z.object({
    matched_on: z.enum(['doi', 'arxiv', 'pmid', 'title', 'none']),
    title_precision: z.number().optional(),
    year_consistent: z.boolean().optional(),
    author_consistent: z.boolean().optional(),
    corroborated_by: z.array(z.string())
  }),
  issues: z.array(z.string())
});
type Result = z.infer<typeof resultSchema>;

export const verifyReferences = defineTool({
  name: 'verify_references',
  title: 'Verify references',
  toolset: 'core',
  description:
    'Check up to 25 references (free-text citations, DOIs, arXiv ids or PMIDs) and grade each: verified, likely, ambiguous, ' +
    'mismatch (the DOI is wrong: it belongs to a different paper, or does not exist while the rest names a real one), not_found, ' +
    'or not_checked (the search budget ran out or a lookup failed; send those again later). ' +
    'Use it to catch fabricated or garbled citations and to fill in missing DOIs. Closed papers count as existing.',
  input: z.object({
    references: z.array(z.string().min(3).max(800)).min(1).max(25)
  }),
  output: z.object({
    summary: z.object({
      verified: z.number().int(), likely: z.number().int(), ambiguous: z.number().int(),
      mismatch: z.number().int(), not_found: z.number().int(), not_checked: z.number().int()
    }),
    results: z.array(resultSchema)
  }),
  async run(args, deps) {
    const limit = pLimit(3); // be polite: three references in flight at once
    const results = await Promise.all(args.references.map(r => limit(() => checkOne(r, deps))));
    const summary = { verified: 0, likely: 0, ambiguous: 0, mismatch: 0, not_found: 0, not_checked: 0 };
    for (const r of results) summary[r.verdict]++;
    const rows = results.map((r, i) =>
      `${i + 1}. **${r.verdict}**${r.matched ? ` — ${r.matched.title} (${r.matched.year ?? 'n.d.'})${r.matched.doi ? ` doi:${r.matched.doi}` : ''}` : ''}` +
      `${r.issues.length ? ` — ${r.issues.join('; ')}` : ''}`);
    const text = [
      `# Checked ${args.references.length} reference${args.references.length === 1 ? '' : 's'}`,
      `verified ${summary.verified} · likely ${summary.likely} · ambiguous ${summary.ambiguous} · mismatch ${summary.mismatch} · not found ${summary.not_found}` +
        (summary.not_checked ? ` · not checked ${summary.not_checked} (send those again later)` : ''),
      '',
      fenceUntrusted('matched records', rows.join('\n'))
    ].join('\n');
    return { structured: { summary, results }, text, provenance: { negativeResult: summary.not_found === results.length } };
  }
});

/** One reference. A refused admission or a failed lookup is this reference's
 * outcome, not the batch's: the verdicts already reached are kept. */
async function checkOne(raw: string, deps: ToolDeps): Promise<Result> {
  try {
    return await verifyOne(parseReference(raw), deps);
  } catch (caught) {
    const error = toToolError(caught);
    return {
      input: sanitizeText(raw),
      verdict: 'not_checked',
      evidence: { matched_on: 'none', corroborated_by: [] },
      issues: [error.code === 'rate_limited' ? `rate_limited: retry in ${error.retryAfterSeconds ?? 60} s` : `lookup_failed: ${error.code}`]
    };
  }
}

/**
 * Cheapest and most certain first: the DOI, then an arXiv id or PMID, then the
 * title. A real DOI attached to a different paper is the commonest shape of a
 * fabricated citation, so a DOI that resolves is still checked against the
 * cited title. A DOI no source holds is asked of the DOI system itself before
 * it is called invented: the registry answers for every agency.
 */
async function verifyOne(ref: ParsedReference, deps: ToolDeps): Promise<Result> {
  const input = sanitizeText(ref.raw);
  const done = (
    matched_on: 'doi' | 'arxiv' | 'pmid' | 'title',
    paper: Paper,
    j: Judgement,
    extra: string[] = [],
    verdict: Result['verdict'] = j.verdict
  ): Result => ({
    input,
    verdict,
    matched: shapePaper(paper, 'concise'),
    evidence: {
      matched_on,
      ...(j.title_precision !== undefined ? { title_precision: j.title_precision } : {}),
      ...(j.year_consistent !== undefined ? { year_consistent: j.year_consistent } : {}),
      ...(j.author_consistent !== undefined ? { author_consistent: j.author_consistent } : {}),
      corroborated_by: j.corroborated_by
    },
    issues: [...extra, ...j.issues]
  });
  const unmatched = (verdict: Result['verdict'], matched_on: 'doi' | 'title' | 'none', issues: string[]): Result => ({
    input, verdict, evidence: { matched_on, corroborated_by: [] }, issues
  });

  if (ref.doi) {
    const paper = await deps.engine.lookupDoi(ref.doi, { admit: deps.admit });
    if (paper) {
      const j = judge(ref, paper);
      // A DOI that resolves names a real paper, so a title that does not match
      // it is a wrong DOI, never "not found" — however much the two titles
      // share (PRISMA 2009 cited with the PRISMA 2020 statement's DOI).
      const wrong = ref.title !== undefined && (titleOverlap(ref.title, paper.title).precision < 0.5 || j.verdict === 'not_found');
      return wrong ? done('doi', paper, j, ['doi_points_to_different_work'], 'mismatch') : done('doi', paper, j);
    }
    const registered = await deps.engine.doiRegistered(ref.doi);
    if (registered === true) return unmatched('ambiguous', 'doi', ['doi_registered_but_not_indexed']);
    if (registered === undefined) return unmatched('ambiguous', 'doi', ['doi_unconfirmed: the DOI registry did not answer']);
    // An invented DOI. The rest of the reference may still name a real paper.
    const found = await findByTitle(ref, deps);
    if (!found) {
      return unmatched('not_found', 'doi', ['doi_not_registered', ...(ref.title ? ['no_similar_title_in_any_source'] : [])]);
    }
    const strong = found.j.verdict === 'verified' || found.j.verdict === 'likely';
    return done('title', found.p, found.j, ['doi_not_registered'], strong ? 'mismatch' : 'ambiguous');
  }

  for (const [kind, id] of [['arxiv', ref.arxiv], ['pmid', ref.pmid]] as const) {
    if (!id) continue;
    // An arXiv id keeps its version when the citation gives one; without one
    // the lookup accepts any version.
    const paper = await deps.engine.lookup(kind === 'arxiv' ? `arxiv:${id}` : `ncbi:${id}`);
    if (paper) return done(kind, paper, judge(ref, paper));
  }

  if (!ref.title) return unmatched('not_found', 'none', ['no_title_or_identifier_found']);
  const found = await findByTitle(ref, deps);
  return found ? done('title', found.p, found.j) : unmatched('not_found', 'title', ['no_similar_title_in_any_source']);
}

/** Words the grammar reads as operators in any case; as bare terms they are a syntax error. */
const OPERATOR_WORDS = new Set(['and', 'or', 'not', 'near', 'same']);

/** The exact title first; its content words only when the exact title finds nothing. */
async function findByTitle(ref: ParsedReference, deps: ToolDeps): Promise<{ p: Paper; j: Judgement } | undefined> {
  if (!ref.title) return undefined;
  const clean = ref.title.replace(/["*?]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = tokens(clean).filter(t => !OPERATOR_WORDS.has(t)).slice(0, 12);
  const attempts = [`TI="${clean}"`, ...(words.length ? [`TS=(${words.join(' ')})`] : [])];
  for (const q of attempts) {
    // A title the grammar cannot read is a title to try the other way, not a
    // failed check: the syntax is ours, not the reference's.
    try {
      parseQuery(q);
    } catch {
      continue;
    }
    const { response } = await deps.engine.search(
      { q, filters: { openAccessOnly: false }, page: 1, pageSize: 5 },
      { admit: deps.admit }
    );
    if (response.papers.length === 0) continue;
    const best = response.papers
      .map(p => ({ p, j: judge(ref, p) }))
      .sort((a, b) => b.j.score - a.j.score)[0]!;
    return best.j.verdict === 'not_found' ? undefined : best;
  }
  return undefined;
}
