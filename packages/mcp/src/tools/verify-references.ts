import * as z from 'zod';
import type { Paper } from '@sci-open/shared';
import { parseQuery } from '@sci-open/core';
import pLimit from '../p-limit';
import { defineTool, type ToolDeps } from '../framework/define-tool';
import { reportToolError } from '../errors';
import { parseReference, type ParsedReference } from '../references/parse';
import { judge, tokens, type Judgement } from '../references/match';
import { shapePaper, paperSchema, listedTitle, retractionWarning } from '../shape/paper';
import { fenceUntrusted } from '../safety/untrusted';
import { sanitizeText } from '../safety/sanitize';

const VERDICTS = ['verified', 'likely', 'ambiguous', 'mismatch', 'not_found', 'not_checked'] as const;

const resultSchema = z.object({
  input: z.string(),
  verdict: z.enum(VERDICTS),
  /** The paper the citation describes, when one was found. */
  matched: paperSchema.optional(),
  /** For a cited DOI that names another paper: that paper. */
  doi_target: paperSchema.optional(),
  evidence: z.object({
    matched_on: z.enum(['doi', 'arxiv', 'pmid', 'title', 'none']),
    title_precision: z.number().optional(),
    year_consistent: z.boolean().optional(),
    author_consistent: z.boolean().optional(),
    venue_consistent: z.boolean().optional(),
    volume_consistent: z.boolean().optional(),
    pages_consistent: z.boolean().optional(),
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
    'Check up to 25 references (free-text citations, DOIs, arXiv ids or PMIDs) and grade each: verified (title, year, an author ' +
    'and the journal, volume and first page where they are cited agree with the record), likely (the paper exists; a detail differs, named in issues), ambiguous, ' +
    'mismatch (the DOI is wrong: it belongs to a different paper, given as doi_target, or does not exist; matched is then the paper ' +
    'the rest of the citation names, when one is found), not_found, ' +
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
    // Every cited DOI resolved from Crossref first, fifty to a request and no
    // admission: a DOI it holds is judged on its record, without a search of
    // every source. A batch failure costs only that shortcut.
    const dois = [...new Set(args.references.flatMap(r => citedDoi(r) ?? []))];
    const resolved = dois.length
      ? await deps.engine.resolveDois(dois, { signal: deps.signal }).then(r => r.found, (error: unknown) => {
          // Cancelled, the call fails as a whole, and nothing failed to log.
          deps.signal.throwIfAborted();
          reportToolError(error, 'verify_references', deps.logger);
          return new Map<string, Paper>();
        })
      : new Map<string, Paper>();
    const limit = pLimit(3); // be polite: three references in flight at once
    const results = await Promise.all(args.references.map(r => limit(() => checkOne(r, deps, resolved))));
    const summary = { verified: 0, likely: 0, ambiguous: 0, mismatch: 0, not_found: 0, not_checked: 0, retracted: 0 };
    for (const r of results) summary[r.verdict]++;
    summary.retracted = results.filter(r => r.matched?.retracted).length;
    const rows = results.map((r, i) =>
      `${i + 1}. **${r.verdict}**${r.matched ? ` — ${listedTitle(r.matched)} (${r.matched.year ?? 'n.d.'})${r.matched.doi ? ` doi:${r.matched.doi}` : ''}` : ''}` +
      `${r.issues.length ? ` — ${r.issues.join('; ')}` : ''}` +
      `${r.doi_target ? ` — the cited DOI is that of ${listedTitle(r.doi_target)} (${r.doi_target.year ?? 'n.d.'})` : ''}`);
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

/** The DOI a reference cites, for the batch lookup. One the parser cannot
 * read is left to `checkOne`, which reports it as that reference's failure. */
function citedDoi(raw: string): string | undefined {
  try {
    return parseReference(raw).doi;
  } catch {
    return undefined;
  }
}

/** One reference. A refused admission or a failed lookup is this reference's
 * outcome, not the batch's: the verdicts already reached are kept. */
async function checkOne(raw: string, deps: ToolDeps, resolved: ReadonlyMap<string, Paper>): Promise<Result> {
  try {
    // A reference still queued when the call is cancelled is never started.
    deps.signal.throwIfAborted();
    return await verifyOne(parseReference(raw), deps, resolved);
  } catch (caught) {
    // Cancelled, the call fails as a whole; no verdict is wanted any more.
    if (deps.signal.aborted) throw caught;
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
 *
 * A DOI is judged on the record Crossref's batch resolved it to (`resolved`)
 * when it has one, and looked up in every source only when it has not. The verdict is the same
 * either way — corroboration moves the judge's score, never its verdict — but
 * `corroborated_by` then names that one source, and whether the paper is
 * retracted is its word alone.
 */
async function verifyOne(ref: ParsedReference, deps: ToolDeps, resolved: ReadonlyMap<string, Paper>): Promise<Result> {
  const input = sanitizeText(ref.raw);
  const done = (
    matched_on: 'doi' | 'arxiv' | 'pmid' | 'title',
    paper: Paper,
    j: Judgement,
    extra: string[] = [],
    verdict: Result['verdict'] = j.verdict,
    doiTarget?: Paper
  ): Result => ({
    input,
    verdict,
    matched: shapePaper(paper, 'concise'),
    ...(doiTarget ? { doi_target: shapePaper(doiTarget, 'concise') } : {}),
    evidence: {
      matched_on,
      ...(j.title_precision !== undefined ? { title_precision: j.title_precision } : {}),
      ...(j.year_consistent !== undefined ? { year_consistent: j.year_consistent } : {}),
      ...(j.author_consistent !== undefined ? { author_consistent: j.author_consistent } : {}),
      ...(j.venue_consistent !== undefined ? { venue_consistent: j.venue_consistent } : {}),
      ...(j.volume_consistent !== undefined ? { volume_consistent: j.volume_consistent } : {}),
      ...(j.pages_consistent !== undefined ? { pages_consistent: j.pages_consistent } : {}),
      corroborated_by: j.corroborated_by
    },
    // The paper exists, so the verdict stands; it is just not evidence.
    issues: [...(paper.retracted ? ['retracted'] : []), ...extra, ...j.issues]
  });
  const unmatched = (verdict: Result['verdict'], matched_on: 'doi' | 'title' | 'none', issues: string[]): Result => ({
    input, verdict, evidence: { matched_on, corroborated_by: [] }, issues
  });

  if (ref.doi) {
    const paper = resolved.get(ref.doi.toLowerCase()) ?? (await deps.engine.lookupDoi(ref.doi, { admit: deps.admit, signal: deps.signal }));
    if (paper) {
      const j = judge(ref, paper);
      // A DOI that resolves names a real paper, so a title that does not match
      // it is a wrong DOI, never "not found" — however much the two titles
      // share (PRISMA 2009 cited with the PRISMA 2020 statement's DOI). The
      // judge's precision, not the raw overlap: it reads a record that left the
      // cited subtitle off as the title cited.
      const wrong = ref.title !== undefined && ((j.title_precision ?? 0) < 0.5 || j.verdict === 'not_found');
      if (!wrong) return done('doi', paper, j);
      // The DOI's paper is not the one cited. The rest of the citation may
      // still name a real paper, whose DOI is the correction: find it, and
      // give the DOI's own paper beside it.
      const intended = await findByTitle(ref, deps);
      if (intended && STRONG.has(intended.j.verdict) && normalizedDoi(intended.p.doi) !== normalizedDoi(ref.doi)) {
        return done('title', intended.p, intended.j, ['doi_points_to_different_work'], 'mismatch', paper);
      }
      return {
        ...unmatched('mismatch', 'doi', ['doi_points_to_different_work', 'cited_title_not_found']),
        doi_target: shapePaper(paper, 'concise')
      };
    }
    const registered = await deps.engine.doiRegistered(ref.doi, { signal: deps.signal });
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
    const paper = await deps.engine.lookup(kind === 'arxiv' ? `arxiv:${id}` : `ncbi:${id}`, { signal: deps.signal });
    if (paper) return done(kind, paper, judge(ref, paper));
  }

  if (!ref.title) return unmatched('not_found', 'none', ['no_title_or_identifier_found']);
  const found = await findByTitle(ref, deps);
  return found ? done('title', found.p, found.j) : unmatched('not_found', 'title', ['no_similar_title_in_any_source']);
}

const normalizedDoi = (doi: string | undefined) => doi?.trim().toLowerCase();

/** Words the grammar leaves out of a search in lower case: dropped here first,
 * so the twelve words sent are twelve that are searched. */
const OPERATOR_WORDS = new Set(['and', 'or', 'not']);

type Found = { p: Paper; j: Judgement };

const STRONG = new Set(['verified', 'likely']);

/** The record's venue, volume or first page is not the one cited. */
const publishedElsewhere = (j: Judgement) => j.venue_consistent === false || j.volume_consistent === false || j.pages_consistent === false;

/** The candidates a title search hands the judge: the top of the merged answer. */
const JUDGED = 5;

/**
 * Records read per source for a title search, against the server's 300. The
 * merged ranking fuses each source's own positions (`rank.ts`), so the five
 * judged are made of the top of each source; a record below 25 in every
 * source that holds it never reaches them. Read to 300, the same search costs
 * DOAJ and OpenAIRE three requests each, for records that are only discarded
 * — and a batch of 25 references can make 75 of them.
 */
const TITLE_DEPTH = 25;

/** The first cited author as the grammar takes one: quoted where the name holds more than letters. */
const authorClause = (surname: string): string =>
  /^\p{L}+$/u.test(surname) ? `AU=${surname}` : `AU="${surname.replace(/"/g, '')}"`;

/**
 * The title's words in the title within a year of the one cited, then in the
 * title at any date, then in the title of a work by the first author cited,
 * then anywhere in the record — each only when the one before found nothing
 * good enough. The judge grades every candidate, so the
 * searches can afford to be wide.
 *
 * Words, not the quoted title: a phrase keeps its punctuation, and sources do
 * not agree on it. Measured live, the 1953 Watson–Crick paper is titled
 * "nucleic acids; a structure" in Europe PMC and was cited "nucleic acids: a
 * structure", so the exact phrase never found it — only its reprints. The year
 * goes first because classic papers are reprinted under their own title: the
 * plain title search ranked a 2007 reprint above the original. A year search
 * that finds only a weak match goes on, since the cited year may be the error;
 * so does one whose match was published somewhere other than the citation
 * says, which is how a reprint carrying the wrong year cited looks, and the
 * plain title search then brings the original in to be judged beside it. That
 * search stops at any match published where the citation says, so a wrong
 * year costs two searches, not three.
 *
 * The author goes in third because a generic title's original is outranked by
 * the papers that share its words. Measured on the references eval: "A
 * mathematical theory of communication" cited as 1951 matched a 1950 Physics
 * Today item, and "Rises, trenches, great faults, and crustal blocks" a
 * reprint series, and neither title search returned the original at all.
 * Crossref, asked for the title's words with the author (`query.author`),
 * returns it among its first three, beside the reprints, and the volume and
 * first page cited tell the judge which is the original.
 */
async function findByTitle(ref: ParsedReference, deps: ToolDeps): Promise<Found | undefined> {
  if (!ref.title) return undefined;
  const words = tokens(ref.title).filter(t => !OPERATOR_WORDS.has(t)).slice(0, 12).join(' ');
  if (!words) return undefined;
  const attempts: Array<{ q: string; enough: (found: Found) => boolean }> = [
    ...(ref.year ? [{ q: `TI=(${words}) AND PY=${ref.year - 1}-${ref.year + 1}`, enough: (f: Found) => STRONG.has(f.j.verdict) && !publishedElsewhere(f.j) }] : []),
    { q: `TI=(${words})`, enough: (f: Found) => f.j.verdict !== 'not_found' && !publishedElsewhere(f.j) },
    ...(ref.surnames[0] ? [{ q: `TI=(${words}) AND ${authorClause(ref.surnames[0])}`, enough: (f: Found) => f.j.verdict !== 'not_found' }] : []),
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
      { admit: deps.admit, depth: TITLE_DEPTH, signal: deps.signal }
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
