import type { Query, QueryField, QueryJoin, QueryNode, QueryValue, YearRange } from './query';

/**
 * The Web of Science query grammar: `TS=(crispr AND "gene editing") NOT AU=Doudna`.
 *
 * Phase 11 deleted the advanced-search tab instead of repairing it, and said
 * why: the UI built `title:CRISPR AND year:2024` and nothing behind it had ever
 * understood one. `parseQuery` recognised quoted phrases, bare terms and DOIs,
 * so a field prefix reached the providers as a literal word to search for, and
 * the tab's own worked example made arXiv answer HTTP 400. This is the missing
 * half — the grammar, and an AST with somewhere to put a field and a `NOT`.
 *
 * **What it accepts**
 *
 * - Field tags, case-insensitive, with `=` or `:` — `TS=`, `TI=`, `AB=`, `AU=`,
 *   `SO=`, `PU=`, `PY=`, `DO=`, `ALL=`.
 * - `AND`, `OR`, `NOT`, parenthesised groups, and a tagged group whose members
 *   inherit the tag: `AU=(Doudna OR Charpentier)`.
 * - Quoted phrases, and the wildcards `*` and `?` inside a bare term.
 * - Year ranges on `PY`: `2020`, `2020-2024`, `2020-`, `-2024`.
 * - Adjacent clauses with no operator between them, which mean `AND` — so
 *   `crispr gene editing` parses exactly as it did before this file existed.
 *
 * **What it refuses, rather than silently mis-running**
 *
 * `NEAR` and `SAME` are real Web of Science operators and are rejected with a
 * message saying so. They are proximity operators: no provider here can express
 * one, and `Paper` does not retain token positions, so neither the fan-out nor
 * the local evaluator could honour them. Accepting them as ordinary words would
 * turn `gene NEAR/3 editing` into a search for the word "near" — which is the
 * class of quiet wrongness this grammar exists to end.
 *
 * **Precedence**, loosest to tightest: `OR`, then `AND`, then `NOT`, then
 * parentheses. Web of Science's own order, so a query copied from it means here
 * what it meant there.
 */

/** Tags, as Web of Science writes them. */
const FIELD_TAGS: Record<string, QueryField> = {
  ALL: 'all',
  TS: 'topic',
  TI: 'title',
  AB: 'abstract',
  AU: 'author',
  SO: 'venue',
  PU: 'publisher',
  PY: 'year',
  DO: 'doi'
};

/**
 * Rejected by name rather than by silence. See the header: these parse as
 * ordinary words if nothing stops them, and a query asking for adjacency would
 * come back as a query asking for the word "near".
 */
const UNSUPPORTED_OPERATORS = new Set(['NEAR', 'SAME']);

/**
 * The default field for a word with no tag.
 *
 * `topic` rather than `all`, matching Web of Science, where an untagged search
 * is a Topic search. It is also the narrower and more useful reading: `all`
 * matches a word appearing anywhere in a record, including in a funder name.
 */
export const DEFAULT_FIELD: QueryField = 'topic';

export class QueryParseError extends Error {
  /** Offset into the input, so a UI can point at the problem. */
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'QueryParseError';
    this.position = position;
  }
}

type Token =
  | { kind: 'word'; text: string; at: number }
  | { kind: 'phrase'; text: string; at: number }
  | { kind: 'open'; at: number }
  | { kind: 'close'; at: number };

/**
 * Text -> tokens.
 *
 * A word runs to the next space, parenthesis or quote, which is what lets
 * `TS=(a OR b)` split into the tag and the group while `TS=crispr` stays one
 * token for the parser to divide at the `=`.
 *
 * An unterminated quote is an error rather than a phrase running to the end of
 * the input. `parseQuery`'s old behaviour was to leave it alone and treat the
 * quote as an ordinary character, which is right for a search box where the
 * user is still typing, and wrong here: in a grammar with operators, swallowing
 * the rest of the line changes what the operators apply to.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const char = input[i]!;

    if (/\s/.test(char)) {
      i += 1;
      continue;
    }

    if (char === '(') {
      tokens.push({ kind: 'open', at: i });
      i += 1;
      continue;
    }

    if (char === ')') {
      tokens.push({ kind: 'close', at: i });
      i += 1;
      continue;
    }

    if (char === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) throw new QueryParseError('Unclosed quote', i);
      tokens.push({ kind: 'phrase', text: input.slice(i + 1, end), at: i });
      i = end + 1;
      continue;
    }

    let end = i;
    while (end < input.length && !/[\s()"]/.test(input[end]!)) end += 1;
    tokens.push({ kind: 'word', text: input.slice(i, end), at: i });
    i = end;
  }

  return tokens;
}

/** `TS=crispr` -> the tag and what follows it; `crispr` -> no tag. */
function splitTag(word: string): { field: QueryField; rest: string } | undefined {
  const match = word.match(/^([A-Za-z]+)[=:]([\s\S]*)$/);
  if (!match) return undefined;

  const field = FIELD_TAGS[match[1]!.toUpperCase()];
  // An unknown tag is not an error: it is how a pasted URL, a gene name like
  // `BRCA1:c.68` or any other word containing a colon stays an ordinary term.
  if (!field) return undefined;

  return { field, rest: match[2]! };
}

/**
 * `2020-2024` -> a range, and a bare `2020` -> the year itself.
 *
 * An open end is allowed at either side, because a reader wanting everything
 * since 2020 should not have to name a closing year that will be wrong next
 * January.
 */
function parseYears(text: string, at: number): YearRange {
  const trimmed = text.trim();
  const range = trimmed.match(/^(\d{4})?\s*-\s*(\d{4})?$/);

  if (range && (range[1] || range[2])) {
    const from = range[1] ? Number(range[1]) : undefined;
    const to = range[2] ? Number(range[2]) : undefined;
    if (from !== undefined && to !== undefined && from > to) {
      throw new QueryParseError(`Year range runs backwards: ${trimmed}`, at);
    }
    return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  }

  if (/^\d{4}$/.test(trimmed)) {
    const year = Number(trimmed);
    return { from: year, to: year };
  }

  throw new QueryParseError(`PY takes a year or a year range, not "${trimmed}"`, at);
}

function clause(field: QueryField, value: QueryValue): QueryNode {
  return { kind: 'clause', field, value };
}

/** A word or phrase, scoped to whichever field is in force, as a leaf. */
function leaf(field: QueryField, token: Token & { kind: 'word' | 'phrase' }): QueryNode {
  if (field === 'year') return clause(field, { kind: 'years', range: parseYears(token.text, token.at) });
  if (token.kind === 'phrase') return clause(field, { kind: 'phrase', text: token.text });
  return clause(field, { kind: 'term', text: token.text });
}

/** `and` and `or` nodes with one child are that child. Keeps the tree readable. */
function group(kind: 'and' | 'or', nodes: QueryNode[]): QueryNode {
  return nodes.length === 1 ? nodes[0]! : { kind, nodes };
}

function operatorOf(token: Token): 'AND' | 'OR' | 'NOT' | undefined {
  if (token.kind !== 'word') return undefined;
  const upper = token.text.toUpperCase();
  if (upper === 'AND' || upper === 'OR' || upper === 'NOT') return upper;
  return undefined;
}

/**
 * Recursive descent over the token stream.
 *
 * `field` is the tag in force, which is what makes `AU=(Doudna OR Charpentier)`
 * work: the group is parsed with `author` as its default, so its untagged
 * members inherit it. A tag written inside the group still wins, as it does in
 * Web of Science.
 */
class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly length: number,
    /** What two adjacent clauses with no operator between them mean. */
    private readonly implicitJoin: QueryJoin
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    return this.tokens[this.index++];
  }

  private endOfInput(): number {
    return this.tokens[this.index - 1]?.at ?? this.length;
  }

  parse(field: QueryField): QueryNode {
    const node = this.parseOr(field);
    const trailing = this.peek();
    if (trailing) {
      if (trailing.kind === 'close') throw new QueryParseError('Unbalanced )', trailing.at);
      throw new QueryParseError('Unexpected input after the query', trailing.at);
    }
    return node;
  }

  /** Whether the next token begins another clause rather than closing this one. */
  private startsClause(): boolean {
    const token = this.peek();
    if (!token || token.kind === 'close') return false;
    return operatorOf(token) === undefined;
  }

  private parseOr(field: QueryField): QueryNode {
    const nodes = [this.parseAnd(field)];

    for (;;) {
      const token = this.peek();
      if (token && operatorOf(token) === 'OR') {
        this.next();
        nodes.push(this.parseAnd(field));
        continue;
      }
      // An adjacency, when the caller asked for adjacency to mean OR. The
      // AND loop below leaves those alone in that case, so they arrive here.
      if (this.implicitJoin === 'OR' && this.startsClause()) {
        nodes.push(this.parseAnd(field));
        continue;
      }
      break;
    }

    return group('or', nodes);
  }

  /**
   * `AND` and `NOT` at one level, and the absence of either between two
   * clauses meaning `AND`.
   *
   * `NOT` is binary here — `a NOT b` is `a AND NOT b`, which is how Web of
   * Science writes an exclusion — and unary at the start of a group, so
   * `NOT AU=Doudna` parses rather than erroring on a missing left operand.
   */
  private parseAnd(field: QueryField): QueryNode {
    const nodes: QueryNode[] = [];
    let negateNext = false;

    const push = (node: QueryNode): void => {
      nodes.push(negateNext ? { kind: 'not', node } : node);
      negateNext = false;
    };

    // A leading NOT, before there is anything to exclude it from.
    if (operatorOf(this.peek() ?? { kind: 'close', at: 0 }) === 'NOT') {
      this.next();
      negateNext = true;
    }

    push(this.parsePrimary(field));

    for (;;) {
      const token = this.peek();
      if (!token || token.kind === 'close') break;

      const operator = operatorOf(token);
      if (operator === 'OR') break;

      if (operator === 'AND' || operator === 'NOT') {
        this.next();
        negateNext = operator === 'NOT';
        const operand = this.peek();
        if (!operand || operand.kind === 'close') {
          throw new QueryParseError(`${operator} needs something after it`, token.at);
        }
        push(this.parsePrimary(field));
        continue;
      }

      // Two clauses with nothing between them. What that means is the
      // caller's to say: `parseQuery`'s `join` option is how the old flat
      // parser expressed the same choice, and it still reaches here.
      if (this.implicitJoin !== 'AND') break;
      push(this.parsePrimary(field));
    }

    return group('and', nodes);
  }

  private parsePrimary(field: QueryField): QueryNode {
    const token = this.next();
    if (!token) throw new QueryParseError('Query ended early', this.endOfInput());

    if (token.kind === 'close') throw new QueryParseError('Unbalanced )', token.at);

    if (token.kind === 'open') {
      const inner = this.parseOr(field);
      const closing = this.next();
      if (!closing || closing.kind !== 'close') {
        throw new QueryParseError('Unbalanced (', token.at);
      }
      return inner;
    }

    if (token.kind === 'phrase') return leaf(field, token);

    if (UNSUPPORTED_OPERATORS.has(token.text.toUpperCase().split('/')[0]!)) {
      throw new QueryParseError(
        `${token.text.toUpperCase()} is not supported: no source here can express proximity`,
        token.at
      );
    }

    const tagged = splitTag(token.text);
    if (!tagged) return leaf(field, token);

    // `TS=crispr`: the tag and its value arrived as one token.
    if (tagged.rest) {
      return leaf(tagged.field, { kind: 'word', text: tagged.rest, at: token.at });
    }

    // `TS=` on its own: the value is whatever comes next, group or word alike.
    const value = this.peek();
    if (!value || value.kind === 'close') {
      throw new QueryParseError(`${token.text} needs a value`, token.at);
    }
    return this.parsePrimary(tagged.field);
  }
}

/**
 * `#1 AND #2` -> `(crispr) AND (AU=Doudna)`.
 *
 * Web of Science numbers every search you run and lets you combine the numbers,
 * which is how a long query gets built without being typed as one long query.
 * The combination is a *query* algebra rather than a set algebra — `#1 AND #2`
 * means "the query that was #1, and the query that was #2", not "the records
 * that came back from each, intersected". That distinction is what makes it
 * implementable here at all: the result is another query, so the grammar,
 * every provider dialect and the evaluator handle it with no further work.
 *
 * **Single-level substitution, never recursive.** Each stored set carries the
 * text it actually ran, which is already expanded, so `#3` needs no second
 * pass. That is not only a simplification: the history arrives from the browser
 * and is therefore untrusted input, and a recursive expander would have to be
 * defended against a payload where set 1 refers to itself. There is nothing to
 * defend here, because nothing is ever substituted twice.
 *
 * Tokenised rather than pattern-replaced, so `TI="#1 ranked"` stays a phrase
 * about the characters `#1` instead of quietly becoming a search for whatever
 * the reader ran first.
 *
 * Wrapped in brackets on the way in, because `#1 AND #2` where `#1` was
 * `a OR b` has to mean `(a OR b) AND …` and not `a OR b AND …`. Precedence
 * would silently change the question otherwise.
 */
const SET_REFERENCE = /^#(\d+)$/;

export function expandSets(input: string, sets: readonly string[]): string {
  const tokens = tokenize(input);

  let out = '';
  let copied = 0;

  for (const token of tokens) {
    if (token.kind !== 'word') continue;

    const match = token.text.match(SET_REFERENCE);
    if (!match) continue;

    const number = Number(match[1]);
    // Sets are numbered from one, as Web of Science numbers them, so `#0` is
    // not an off-by-one to be tolerated — it is a reference to nothing.
    if (number < 1 || number > sets.length) {
      throw new QueryParseError(`#${number} is not a search you have run`, token.at);
    }

    // A slot with nothing in it is a set that has been dropped, not one that
    // was blank: a blank search is never recorded, and the history keeps a set's
    // number stable when it evicts the set itself so that older references
    // cannot silently start pointing at somebody else's search.
    const text = sets[number - 1]!.trim();
    if (!text) throw new QueryParseError(`#${number} is no longer in the search history`, token.at);

    out += input.slice(copied, token.at) + `(${text})`;
    copied = token.at + token.text.length;
  }

  return out + input.slice(copied);
}

/** Whether this text refers to a numbered set, and so needs a history to run. */
export function referencesSets(input: string): boolean {
  return tokenize(input).some(token => token.kind === 'word' && SET_REFERENCE.test(token.text));
}

export type ParseExpressionOptions = {
  /** The field an untagged word is scoped to. */
  field?: QueryField;
  /** What adjacency means, when no operator is written. */
  join?: QueryJoin;
};

/** Parses the grammar, or throws `QueryParseError`. */
export function parseExpression(input: string, options: ParseExpressionOptions = {}): QueryNode {
  const { field = DEFAULT_FIELD, join = 'AND' } = options;
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new QueryParseError('Empty query', 0);
  return new Parser(tokens, input.length, join).parse(field);
}

/**
 * Whether a clause on this field can be carried by the flat `terms`.
 *
 * The flat form has nowhere to put a field, so whoever reads it searches
 * whatever they search for a bare word — which for every provider here means
 * the title, the abstract and whatever keyword index they keep. A leaf is only
 * safe to flatten if being searched that way is *wider* than the clause, and
 * that is true exactly for the fields whose text lives there.
 *
 * `author`, `venue` and `publisher` are the ones it is not true for, and
 * carrying them was a real defect rather than a theoretical one. Measured live:
 * `SO=Nature AND TS=genome` reached OpenAlex as
 * `title_and_abstract.search:Nature genome`, which *requires* the word "Nature"
 * in the title or abstract — so a genome paper published in Nature whose title
 * does not name the journal was never fetched, and `matchesQuery` cannot
 * recover a record nobody returned. The flattening was narrowing, which is the
 * one thing it may not do.
 *
 * Dropping them instead means a provider with no fielded search contributes
 * nothing to an author-only query. That is the honest outcome: it has no way to
 * answer the question that was asked, and a wrong-field search spends the depth
 * budget to return records the evaluator will drop anyway.
 *
 * `year` and `doi` are left out for a different reason — they are lifted onto
 * `Query.years` and `Query.doi`, which every provider can express.
 */
function flattenable(field: QueryField): boolean {
  return field === 'topic' || field === 'all' || field === 'title' || field === 'abstract';
}

/**
 * The leaves that must match for the whole tree to match.
 *
 * What makes the flattening in `flatten` safe. Under `and` every child's
 * requirements are required; under `or` only what every branch demands is, so
 * `a OR b` requires nothing and `(a AND b) OR (a AND c)` requires `a`; under
 * `not` nothing is required, because the leaf below is the opposite of a
 * requirement.
 */
function requiredLeaves(node: QueryNode): QueryValue[] {
  switch (node.kind) {
    case 'clause':
      if (!flattenable(node.field)) return [];
      return [node.value];
    case 'and':
      return node.nodes.flatMap(requiredLeaves);
    case 'or': {
      const [first, ...rest] = node.nodes.map(requiredLeaves);
      if (!first) return [];
      return first.filter(value => rest.every(other => other.some(o => sameValue(o, value))));
    }
    case 'not':
      return [];
  }
}

function sameValue(a: QueryValue, b: QueryValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'years' || b.kind === 'years') return false;
  return a.text.toLowerCase() === (b as { text: string }).text.toLowerCase();
}

/** Every positive leaf anywhere in the tree, for when nothing is required. */
function positiveLeaves(node: QueryNode): QueryValue[] {
  switch (node.kind) {
    case 'clause':
      if (!flattenable(node.field)) return [];
      return [node.value];
    case 'and':
    case 'or':
      return node.nodes.flatMap(positiveLeaves);
    case 'not':
      return [];
  }
}

/** Every year range the tree requires, so a provider can push the bound down. */
function requiredYears(node: QueryNode): YearRange[] {
  switch (node.kind) {
    case 'clause':
      return node.field === 'year' && node.value.kind === 'years' ? [node.value.range] : [];
    case 'and':
      return node.nodes.flatMap(requiredYears);
    case 'or':
    case 'not':
      return [];
  }
}

/** The tightest bound satisfying every required range. */
export function intersectYears(ranges: readonly YearRange[]): YearRange | undefined {
  const froms = ranges.map(r => r.from).filter((y): y is number => y !== undefined);
  const tos = ranges.map(r => r.to).filter((y): y is number => y !== undefined);

  const from = froms.length > 0 ? Math.max(...froms) : undefined;
  const to = tos.length > 0 ? Math.min(...tos) : undefined;

  if (from === undefined && to === undefined) return undefined;
  return { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
}

export type Flattened = {
  terms: string[];
  phrases: string[];
  join: QueryJoin;
  years?: YearRange;
};

/**
 * The tree -> the flat `terms`/`phrases`/`join` that `rank.ts` and the
 * providers without a boolean syntax read.
 *
 * The contract is that what comes back describes a **superset** of the tree's
 * real answer, never a subset. A provider translating from it reads too widely
 * and `matchesQuery` narrows the result afterwards; a provider reading too
 * narrowly would drop records nothing downstream could recover, because the
 * orchestrator can only filter what it was given.
 *
 * So the required leaves are joined with `AND` when there are any — the tightest
 * honest query — and everything positive is joined with `OR` when there are
 * none, which is the widest. `a OR b` takes the second path; `TS=crispr NOT
 * AU=Doudna` takes the first and reaches the provider as plain `crispr`.
 */
export function flatten(node: QueryNode): Flattened {
  const required = requiredLeaves(node);
  const values = required.length > 0 ? required : positiveLeaves(node);
  const join: QueryJoin = required.length > 0 ? 'AND' : 'OR';

  const terms: string[] = [];
  const phrases: string[] = [];
  for (const value of values) {
    if (value.kind === 'term') terms.push(value.text);
    else if (value.kind === 'phrase') phrases.push(value.text);
  }

  const years = intersectYears(requiredYears(node));

  return { terms, phrases, join, ...(years ? { years } : {}) };
}

/**
 * The tree -> the query text that produced it, normalised.
 *
 * For showing a reader what was understood. A search that silently means
 * something other than what was typed is the failure this whole file is against,
 * and the cheapest guard against it is printing the parse back.
 */
export function formatExpression(node: QueryNode): string {
  const tag = (field: QueryField): string =>
    Object.entries(FIELD_TAGS).find(([, value]) => value === field)?.[0] ?? 'ALL';

  switch (node.kind) {
    case 'clause': {
      const { value } = node;
      const text =
        value.kind === 'phrase' ? `"${value.text}"`
        : value.kind === 'term' ? value.text
        : `${value.range.from ?? ''}-${value.range.to ?? ''}`;
      return `${tag(node.field)}=${text}`;
    }
    case 'and':
      return node.nodes.map(bracketed).join(' AND ');
    case 'or':
      return node.nodes.map(bracketed).join(' OR ');
    case 'not':
      return `NOT ${bracketed(node.node)}`;
  }
}

function bracketed(node: QueryNode): string {
  const text = formatExpression(node);
  return node.kind === 'and' || node.kind === 'or' ? `(${text})` : text;
}

/** Whether a tree needs more than `terms`/`phrases` to be expressed honestly. */
export function isStructured(node: QueryNode): boolean {
  switch (node.kind) {
    case 'clause':
      return node.field !== DEFAULT_FIELD && node.field !== 'all';
    case 'not':
      return true;
    case 'or':
      return true;
    case 'and':
      return node.nodes.some(isStructured);
  }
}

/** The fields a tree actually mentions, for deciding what a provider can serve. */
export function fieldsUsed(node: QueryNode): Set<QueryField> {
  const fields = new Set<QueryField>();

  const walk = (current: QueryNode): void => {
    switch (current.kind) {
      case 'clause':
        fields.add(current.field);
        return;
      case 'not':
        walk(current.node);
        return;
      case 'and':
      case 'or':
        current.nodes.forEach(walk);
    }
  };

  walk(node);
  return fields;
}

/** True when the whole query is one DOI clause, which is a lookup and not a search. */
export function soleDoi(node: QueryNode): string | undefined {
  if (node.kind !== 'clause' || node.field !== 'doi') return undefined;
  return node.value.kind === 'term' || node.value.kind === 'phrase' ? node.value.text : undefined;
}

export type { Query };
