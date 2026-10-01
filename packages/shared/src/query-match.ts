import type { Paper } from './paper';
import type { QueryField, QueryNode, QueryValue } from './query';

/**
 * Does this record satisfy the parsed query?
 *
 * The grammar is only half of fielded search. The other half is that most of
 * the providers cannot run the query that was typed: OpenAIRE has no query
 * language at all, OpenAlex has no filter key for `SO=` or `PU=`, arXiv's
 * negation is a different shape, and the ones that do all spell their fields
 * differently and index different text under them. Translating
 * as much as each can express and hoping is how the deleted advanced-search tab
 * behaved, and it is why it was deleted.
 *
 * So the query is enforced here instead, over the merged records, where every
 * provider's results are the same shape. `flatten` guarantees the fan-out reads
 * a **superset** of the real answer; this narrows that superset back to it. The
 * provider's own translation stays worth doing — it decides how much of the
 * depth budget is spent on records that can still qualify — but it is an
 * optimisation, and correctness does not rest on it.
 *
 * **Three values, not two.** A record whose abstract this service never received
 * cannot be judged against `AB=crispr`: the provider may well have matched text
 * we do not hold. Answering `false` there would drop records for the crime of
 * arriving with a field missing — and since the evaluator runs *after* the
 * provider already applied what it could, that is a real and one-sided loss.
 * So an unjudgeable clause is `unknown`, unknown propagates through `AND`, `OR`
 * and `NOT`, and `matchesQuery` keeps anything it cannot positively rule out.
 *
 * The bias is deliberate and it is the safe direction: this step can only ever
 * remove records, so it should remove only the ones it can actually convict.
 */

/** `true` / `false` / `unknown` — see the header on why the third exists. */
export type Match = boolean | 'unknown';

function and(values: readonly Match[]): Match {
  if (values.some(v => v === false)) return false;
  if (values.some(v => v === 'unknown')) return 'unknown';
  return true;
}

function or(values: readonly Match[]): Match {
  if (values.some(v => v === true)) return true;
  if (values.some(v => v === 'unknown')) return 'unknown';
  return false;
}

function not(value: Match): Match {
  return value === 'unknown' ? 'unknown' : !value;
}

/**
 * The text a field is matched against, or `undefined` when this service does
 * not hold it for this record.
 *
 * `undefined` and `[]` mean different things and the difference decides a
 * match: a paper with no abstract yields `undefined` and is unjudgeable, while
 * a paper with an empty topic list genuinely has no topics. Only `title`,
 * `authors` and `topics` are always present on a `Paper`.
 */
function textOf(paper: Paper, field: QueryField): string[] | undefined {
  switch (field) {
    case 'title':
      return [paper.title];
    case 'abstract':
      return paper.abstract === undefined ? undefined : [paper.abstract];
    case 'author':
      return paper.authors;
    case 'venue':
      return paper.venue === undefined ? undefined : [paper.venue];
    case 'publisher':
      return paper.publisher === undefined ? undefined : [paper.publisher];
    case 'doi':
      return paper.doi === undefined ? undefined : [paper.doi];
    // Title, abstract and keywords together — Web of Science's Topic search.
    // The abstract is included when there is one and simply absent when there
    // is not, rather than making the whole clause unjudgeable: a topic word
    // found in the title is a match on the evidence available.
    case 'topic':
      return [paper.title, ...(paper.abstract !== undefined ? [paper.abstract] : []), ...paper.topics];
    case 'all':
      return [
        paper.title,
        ...paper.authors,
        ...paper.topics,
        ...(paper.abstract !== undefined ? [paper.abstract] : []),
        ...(paper.venue !== undefined ? [paper.venue] : []),
        ...(paper.publisher !== undefined ? [paper.publisher] : []),
        ...(paper.doi !== undefined ? [paper.doi] : [])
      ];
    case 'year':
      return undefined;
  }
}

/**
 * A term, wildcards and all, as a test over text.
 *
 * `*` is any run of word characters and `?` is exactly one, as Web of Science
 * writes them. Everything else is literal, so a term containing `.` or `+`
 * matches those characters rather than acting as a pattern — a search for `C++`
 * should not be a regular expression nobody typed.
 *
 * Bounded by `\b` at both ends so `TS=gene` does not match "generation". A term
 * whose edge is not a word character (`C++`) gets no boundary on that side,
 * because `\b` after `+` demands a following word character and would make the
 * term unmatchable.
 *
 * **The wildcards are not handed to the regex engine.** They were: `*` became
 * `\w*`, and a term carrying several — `TI=**********z` — is a pattern whose
 * backtracking grows exponentially with the count, because every `\w*` can take
 * any share of the same word. This runs over every merged record on the event
 * loop, so one such search stalled every other request: measured on the compose
 * stack, ten of them held `/health` for 14.7 s over one search's 2,000 papers,
 * and each two more multiplied that by about six.
 *
 * What makes the fix exact rather than approximate is that a wildcard cannot
 * leave its word. A run of word characters in the term — wildcards included —
 * is bounded on each side by a literal non-word character or by `\b`, so
 * whatever it matches is a whole word of the text or nothing. The expression
 * matches each run that holds a wildcard as `(\w*)`, which can only ever take
 * the whole word, and `globMatches` checks the wildcards against the word it
 * captured.
 */
function termMatcher(text: string): (haystack: string) => boolean {
  // Runs of word characters at the odd indices, the literal text between them
  // at the even ones. Both wildcards count as word characters here, since both
  // stand for them: `TI=gen*` should not reach across the space in "gene
  // editing" and match the pair as though it were one token.
  const globs: string[] = [];
  const body = text
    .split(/([\w*?]+)/)
    .map((part, index) => {
      if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Letters, digits and `_` only: nothing in it needs escaping.
      if (!/[*?]/.test(part)) return part;
      globs.push(part.toLowerCase());
      return '(\\w*)';
    })
    .join('');

  // Bounded at both ends so `TS=gene` does not match "generation", and a
  // wildcard counts as a word character for that purpose — it stands for one.
  // Without it `gen?` would match the start of "genome": the wildcard would
  // mean "and then anything" rather than "one more letter, and then the word
  // ends".
  const wordish = (char: string | undefined): boolean => char !== undefined && /[\w*?]/.test(char);
  const open = wordish(text[0]) ? '\\b' : '';
  const close = wordish(text[text.length - 1]) ? '\\b' : '';

  if (globs.length === 0) {
    const pattern = new RegExp(`${open}${body}${close}`, 'i');
    return haystack => pattern.test(haystack);
  }

  const pattern = new RegExp(`${open}${body}${close}`, 'gi');
  return haystack => {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(haystack)) !== null) {
      // `\w` is ASCII here, so the captured words are too, and lowering both
      // sides is exactly the `i` flag's comparison.
      const words = match;
      if (globs.every((glob, index) => globMatches(glob, words[index + 1]!.toLowerCase()))) return true;
      // The next candidate may overlap this one: `exec` would resume after it.
      pattern.lastIndex = match.index + 1;
    }
    return false;
  };
}

/**
 * Whether a whole word matches a pattern of literal characters, `*` and `?`.
 *
 * The usual greedy match: on a mismatch, go back to the most recent `*` and let
 * it take one more character. Only the latest `*` ever needs revisiting, since
 * within one word it can absorb anything an earlier one could — so this is at
 * worst the word's length times the pattern's, where a backtracking regex tries
 * every way of sharing the word among the stars.
 */
function globMatches(glob: string, word: string): boolean {
  let g = 0;
  let w = 0;
  let star = -1;
  let resume = 0;

  while (w < word.length) {
    if (g < glob.length && (glob[g] === '?' || glob[g] === word[w])) {
      g += 1;
      w += 1;
    } else if (g < glob.length && glob[g] === '*') {
      star = g;
      resume = w;
      g += 1;
    } else if (star !== -1) {
      g = star + 1;
      resume += 1;
      w = resume;
    } else {
      return false;
    }
  }

  while (glob[g] === '*') g += 1;
  return g === glob.length;
}

/**
 * A phrase: the same words, adjacent and in order, whatever the spacing was.
 *
 * Bounded only at an edge that is a word character, as `termMatcher` is. It
 * used to put `\b` at both ends unconditionally, and `\b` after `)` or `.`
 * demands a word character next — so a phrase ending in one could not match
 * anything, not even itself. `SO="Bioinformatics (Oxford, England)"`, which is
 * how PubMed names that journal, found nothing on a search over its own
 * records; so did `AU="Forstmann, B.U."`, and a phrase opening with a letter
 * outside ASCII, which `\w` does not count.
 */
function phrasePattern(text: string): RegExp {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const open = /^\w/.test(trimmed) ? '\\b' : '';
  const close = /\w$/.test(trimmed) ? '\\b' : '';
  return new RegExp(`${open}${words.join('\\s+')}${close}`, 'i');
}

/**
 * Letters `NFD` leaves whole, because Unicode treats them as letters of their
 * own rather than as a letter with a mark: "Łukasz" is not "Lukasz" to it.
 */
const UNMARKED: Record<string, string> = {
  ł: 'l', ø: 'o', đ: 'd', ð: 'd', ħ: 'h', ı: 'i', ŀ: 'l', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th'
};

/** A word of a name as two sources might both write it: lower case, no accents. */
function foldName(word: string): string {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[łøđðħıŀßæœþ]/g, letter => UNMARKED[letter]!);
}

/**
 * The words of a name, apart from the punctuation sources disagree on — stops,
 * hyphens, apostrophes straight or curly — and sorted into names and initials.
 *
 * An initial is a lone letter, or a short run of capitals: "A.", "B.U." and
 * PubMed's "JA". "Li" and "Wu" are names, and stay names, because they are not
 * written in capitals. On a record, though, a short run of capitals may be a
 * surname some source wrote in capitals — "LI Wei" — so there it counts as
 * both, and a query for "Li Wei" still finds it.
 *
 * `given` is how many names the text writes out, counted before hyphens split
 * them: "Sanvicente-García M" gives one, so its initial still has a job to do.
 */
function nameWords(text: string, record = false): { names: string[]; initials: string[]; given: number } {
  const names: string[] = [];
  const initials: string[] = [];
  let given = 0;
  for (const raw of text.split(/[\s,;]+/)) {
    const word = raw.replace(/[.'’`]/g, '');
    if (!word) continue;
    const letters = word.replace(/[-‐]/g, '');
    if (letters.length === 1 || (letters.length <= 3 && /^[A-Z]+$/.test(letters))) {
      initials.push(...foldName(letters).split(''));
      if (record && letters.length > 1) names.push(foldName(letters));
      continue;
    }
    given += 1;
    names.push(...word.split(/[-‐]+/).filter(Boolean).map(foldName));
  }
  return { names, initials, given };
}

/**
 * An author phrase, as a name rather than as a run of words.
 *
 * As a run of words, `AU="Doudna, Jennifer"` matched only a record that wrote
 * the name exactly so — bioRxiv's spelling — and every other source writes it
 * another way: "Jennifer A. Doudna", PubMed's "Doudna Jennifer A". The sources
 * were asked for the name and returned it, and this then dropped all of it, so
 * the search found nothing. A Web of Science author search is written
 * "Doudna, Jennifer", so that is the phrase a pasted query carries.
 *
 * As a name: every name in the phrase is a word of one author's name, in any
 * order and whatever the accents and punctuation — or, where the record gives
 * that name only as an initial, the initial: "Doudna JA" and "J. A. Doudna" are
 * her too. One name at least has to be there in full, which in practice is the
 * surname; the record that gives a surname as an initial is the price of that,
 * and is rare.
 *
 * Initials in the phrase are not held against a record that writes the
 * forename out — sources disagree on them more than on anything — and are what
 * tells one Doudna from another when the phrase writes out only one name:
 * "Doudna J" needs a forename or initial beginning with J.
 *
 * A phrase of initials alone names nobody, and is matched as words.
 */
function nameMatcher(text: string): ((author: string) => boolean) | undefined {
  const wanted = nameWords(text);
  if (wanted.names.length === 0) return undefined;

  return author => {
    const { names, initials } = nameWords(author, true);
    const missing = wanted.names.filter(name => !names.includes(name));
    if (missing.length === wanted.names.length) return false;
    if (!missing.every(name => initials.includes(name[0]!))) return false;
    if (wanted.given > 1 || wanted.initials.length === 0) return true;
    const first = wanted.initials[0]!;
    return initials.includes(first) || names.some(name => !wanted.names.includes(name) && name.startsWith(first));
  };
}

function matchesValue(field: QueryField, value: QueryValue, haystacks: readonly string[]): boolean {
  if (value.kind === 'years') return false;

  if (value.kind === 'phrase') {
    const name = field === 'author' ? nameMatcher(value.text) : undefined;
    if (name) return haystacks.some(name);
    const pattern = phrasePattern(value.text);
    return haystacks.some(text => pattern.test(text));
  }
  return haystacks.some(termMatcher(value.text));
}

function matchesClause(paper: Paper, field: QueryField, value: QueryValue): Match {
  if (value.kind === 'years') {
    if (paper.year === undefined) return 'unknown';
    const { from, to } = value.range;
    if (from !== undefined && paper.year < from) return false;
    if (to !== undefined && paper.year > to) return false;
    return true;
  }

  // A DOI is an identifier, not prose: compared whole and case-insensitively
  // rather than by the word-boundary search the text fields use, so that
  // `DO=10.1/abc` cannot be satisfied by `10.1/abcdef`.
  if (field === 'doi') {
    if (paper.doi === undefined) return 'unknown';
    return paper.doi.toLowerCase() === value.text.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  }

  const haystacks = textOf(paper, field);
  if (haystacks === undefined) return 'unknown';

  if (matchesValue(field, value, haystacks)) return true;

  // A miss on `topic` or `all` is not a finding.
  //
  // These are the concepts where the provider searched an index this service
  // holds no copy of. Europe PMC matches `MESH:` and `KW:` — measured in its own
  // translator at a tenth of the hits for `crispr`, records indexed under the
  // subject whose title and abstract never say the word. PubMed expands a bare
  // word through Automatic Term Mapping. OpenAlex searches full text. All of
  // them stem, and none of them ship the text they matched on.
  //
  // So text we hold that does not contain the word is an absence of evidence
  // rather than evidence of absence, and answering `false` would quietly delete
  // correct results from every ordinary keyword search — the widest possible
  // version of the failure this file exists to prevent. `unknown` keeps the
  // record and leaves the provider's judgement standing.
  //
  // The narrow fields below do not get this treatment, and the difference is
  // whether this service holds the whole of what the clause asks about: a title
  // is complete, an author list is complete, a year is a number. A miss there is
  // a real answer.
  if (field === 'topic' || field === 'all') return 'unknown';

  return false;
}

/** The tree evaluated against one record, `unknown` included. */
export function evaluateQuery(paper: Paper, node: QueryNode): Match {
  switch (node.kind) {
    case 'clause':
      return matchesClause(paper, node.field, node.value);
    case 'and':
      return and(node.nodes.map(child => evaluateQuery(paper, child)));
    case 'or':
      return or(node.nodes.map(child => evaluateQuery(paper, child)));
    case 'not':
      return not(evaluateQuery(paper, node.node));
  }
}

/**
 * Whether to keep this record.
 *
 * Anything not positively ruled out is kept — see the header. The whole step is
 * subtractive, so the question it answers is "can this record be convicted?",
 * not "can it be proved?".
 */
export function matchesQuery(paper: Paper, node: QueryNode): boolean {
  return evaluateQuery(paper, node) !== false;
}
