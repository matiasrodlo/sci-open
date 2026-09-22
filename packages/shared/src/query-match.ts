import type { Paper } from './paper';
import type { QueryField, QueryNode, QueryValue } from './query';

/**
 * Does this record satisfy the parsed query?
 *
 * The grammar is only half of fielded search. The other half is that most of
 * the providers cannot run the query that was typed: OpenAIRE has no query
 * language at all, DOAJ cannot express `NOT`, and the ones that do all spell
 * their fields differently and index different text under them. Translating
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
 * A term, wildcards and all, as a regular expression.
 *
 * `*` is any run of characters and `?` is exactly one, as Web of Science writes
 * them. Everything else is escaped, so a term containing `.` or `+` matches
 * those characters rather than acting as a pattern — a search for `C++` should
 * not be a regular expression nobody typed.
 *
 * Bounded by `\b` at both ends so `TS=gene` does not match "generation". A term
 * whose edge is not a word character (`C++`) gets no boundary on that side,
 * because `\b` after `+` demands a following word character and would make the
 * term unmatchable.
 */
function termPattern(text: string): RegExp {
  // Split on the wildcards, so each is replaced by its pattern and everything
  // between them is escaped literally. Done in one pass rather than by
  // substituting placeholders, because a placeholder is a string the user could
  // also have typed.
  //
  // Both expand to word characters, not to `\S`: a wildcard stands in for the
  // rest of a word, so `TI=gen*` should not reach across the space in "gene
  // editing" and match the pair as though it were one token.
  const body = text
    .split(/([*?])/)
    .map(part =>
      part === '*' ? '\\w*'
      : part === '?' ? '\\w'
      : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');

  // Bounded at both ends so `TS=gene` does not match "generation", and a
  // wildcard counts as a word character for that purpose — it expands to one.
  // Without it `gen?` is `\bgen\w` unanchored, which matches "genome": the
  // wildcard would mean "and then anything" rather than "one more letter, and
  // then the word ends".
  //
  // An edge that is neither (`C++`) gets no boundary on that side, because `\b`
  // after `+` demands a following word character and would make the term
  // unmatchable.
  const wordish = (char: string | undefined): boolean => char !== undefined && /[\w*?]/.test(char);
  const open = wordish(text[0]) ? '\\b' : '';
  const close = wordish(text[text.length - 1]) ? '\\b' : '';

  return new RegExp(`${open}${body}${close}`, 'i');
}

/** A phrase: the same words, adjacent and in order, whatever the spacing was. */
function phrasePattern(text: string): RegExp {
  const words = text.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b${words.join('\\s+')}\\b`, 'i');
}

function matchesValue(value: QueryValue, haystacks: readonly string[]): boolean {
  if (value.kind === 'years') return false;

  const pattern = value.kind === 'phrase' ? phrasePattern(value.text) : termPattern(value.text);
  return haystacks.some(text => pattern.test(text));
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

  if (matchesValue(value, haystacks)) return true;

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
