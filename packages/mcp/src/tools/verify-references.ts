import * as z from 'zod';
import type { Paper } from '@sci-open/shared';
import { parseQuery } from '@sci-open/core';
import pLimit from '../p-limit';
import { defineTool, type ToolDeps } from '../framework/define-tool';
import { reportToolError } from '../errors';
import { parseReference, type ParsedReference } from '../references/parse';
import { judge, titleOverlap, tokens, type Judgement } from '../references/match';
import { shapePaper, paperSchema, listedTitle, retractionWarning } from '../shape/paper';
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
      mismatch: z.number().int(), not_found: z.number().int(), not_checked: z.number().int(),
      /** Matched records a source records as retracted, whatever their verdict. */
      retracted: z.number().int()
    }),
    results: z.array(resultSchema)
  }),
  async run(args, deps) {
    const limit = pLimit(3); // be polite: three references in flight at once
    const results = await Promise.all(args.references.map(r => limit(() => checkOne(r, deps))));
    const summary = { verified: 0, likely: 0, ambiguous: 0, mismatch: 0, not_found: 0, not_checked: 0, retracted: 0 };
    for (const r of results) summary[r.verdict]++;
    summary.retracted = results.filter(r => r.matched?.retracted).length;
    const rows = results.map((r, i) =>
      `${i + 1}. **${r.verdict}**${r.matched ? ` — ${listedTitle(r.matched)} (${r.matched.year ?? 'n.d.'})${r.matched.doi ? ` doi:${r.matched.doi}` : ''}` : ''}` +
      `${r.issues.length ? ` — ${r.issues.join('; ')}` : ''}`);
    const retractedRefs = results.flatMap((r, i) => (r.matched?.retracted ? [`#${i + 1}`] : []));
    const text = [
      ...(retractedRefs.length ? [retractionWarning(retractedRefs.length === 1 ? [`Reference ${retractedRefs[0]}`] : [`References ${retractedRefs.join(', ')}`])] : []),
      `# Checked ${args.references.length} reference${args.references.length === 1 ? '' : 's'}`,
      `verified ${summary.verified} · likely ${summary.likely} · ambiguous ${summary.ambiguous} · mismatch ${summary.mismatch} · not found ${summary.not_found}` +
        (summary.not_checked ? ` · not checked ${summary.not_checked} (send those again later)` : '') +
        (summary.retracted ? ` · retracted ${summary.retracted}` : ''),
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
    const error = reportToolError(caught, 'verify_references', deps.logger);
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
    // The paper exists, so the verdict stands; it is just not evidence.
    issues: [...(paper.retracted ? ['retracted'] : []), ...extra, ...j.issues]
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

type Found = { p: Paper; j: Judgement };

const STRONG = new Set(['verified', 'likely']);

/** The candidates a title search hands the judge: the top of the merged answer. */
const JUDGED = 5;

/**
 * Records read per source for a title search, against the server's 300. The
 * merged ranking fuses each source's own positions (`rank.ts`), so the five
 * judged are made of the top of each source; a record below 25 in every
 * source that holds it never reaches them. Read to 300, the same search costs
 * OpenAlex two requests and DOAJ and OpenAIRE three each, for records that
 * are only discarded — and a batch of 25 references can make 75 of them.
 */
const TITLE_DEPTH = 25;

/**
 * The title's words in the title within a year of the one cited, then in the
 * title at any date, then anywhere in the record — each only when the one
 * before found nothing good enough. The judge grades every candidate, so the
 * searches can afford to be wide.
 *
 * Words, not the quoted title: a phrase keeps its punctuation, and sources do
 * not agree on it. Measured live, the 1953 Watson–Crick paper is titled
 * "nucleic acids; a structure" in Europe PMC and was cited "nucleic acids: a
 * structure", so the exact phrase never found it — only its reprints. The year
 * goes first because classic papers are reprinted under their own title: the
 * plain title search ranked a 2007 reprint above the original. A year search
 * that finds only a weak match goes on, since the cited year may be the error;
 * the plain title search stops at any match, so a wrong year costs two
 * searches, not three.
 */
async function findByTitle(ref: ParsedReference, deps: ToolDeps): Promise<Found | undefined> {
  if (!ref.title) return undefined;
  const words = tokens(ref.title).filter(t => !OPERATOR_WORDS.has(t)).slice(0, 12).join(' ');
  if (!words) return undefined;
  const attempts: Array<{ q: string; enough: (found: Found) => boolean }> = [
    ...(ref.year ? [{ q: `TI=(${words}) AND PY=${ref.year - 1}-${ref.year + 1}`, enough: (f: Found) => STRONG.has(f.j.verdict) }] : []),
    { q: `TI=(${words})`, enough: (f: Found) => f.j.verdict !== 'not_found' },
    { q: `TS=(${words})`, enough: () => true }
  ];
  let best: Found | undefined;
  for (const { q, enough } of attempts) {
    // A title the grammar cannot read is a title to try the other way, not a
    // failed check: the syntax is ours, not the reference's.
    try {
      parseQuery(q);
    } catch {
      continue;
    }
    const { response } = await deps.engine.search(
      { q, filters: { openAccessOnly: false }, page: 1, pageSize: JUDGED },
      { admit: deps.admit, depth: TITLE_DEPTH }
    );
    if (response.papers.length === 0) continue;
    const found = response.papers
      .map(p => ({ p, j: judge(ref, p) }))
      .sort((a, b) => b.j.score - a.j.score)[0]!;
    if (!best || found.j.score > best.j.score) best = found;
    if (enough(found)) break;
  }
  return best && best.j.verdict !== 'not_found' ? best : undefined;
}
