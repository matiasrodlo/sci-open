import type { Query, QueryField, QueryJoin, QueryNode, YearRange } from '@open-access-explorer/shared';

/**
 * The parsed query -> one provider's native query string.
 *
 * Five of the keyword providers spell a fielded search the same way underneath
 * a different vocabulary: a list of native fields per concept, a value ORed
 * across them, and `AND`/`OR`/`NOT` between the results. Europe PMC writes
 * `AUTH:`, arXiv writes `au:`, PubMed writes `[au]`, DOAJ writes
 * `bibjson.author.name:` and PLOS writes `author:`. Writing five tree walkers
 * to say that five times would put the interesting part — which native field
 * answers which question, and what each API does when asked — behind four
 * copies of the boring part.
 *
 * So the walk lives here and each provider supplies a `Dialect`: its field
 * mapping and its spelling. What is left in a provider's `translate.ts` is the
 * thing only that provider knows.
 *
 * **The one invariant: this may only ever widen.**
 *
 * A provider that cannot express part of a query renders the rest and drops
 * that part, which reads *more* records than the query asked for.
 * `matchesQuery` then narrows the merged set back to the real answer. The
 * reverse — rendering something narrower than was asked — is unrecoverable,
 * because the orchestrator can only filter records a provider actually
 * returned.
 *
 * It is why `or` behaves the way it does below. Dropping a branch of an `AND`
 * widens and is safe; dropping a branch of an `OR` *narrows*, because the
 * dropped branch was an alternative that could have matched on its own. So an
 * `OR` with an unrenderable branch is dropped whole.
 *
 * `undefined` means "nothing of this could be expressed", and every caller
 * treats it as "fall back to the flat `terms`/`phrases`" — which is the query
 * this provider would have received before the grammar existed.
 */

export type Dialect = {
  /**
   * The native fields a clause on this concept searches, ORed together.
   *
   * Empty means this provider cannot scope that concept at all, and the clause
   * is rendered unscoped instead — wider, and safe by the invariant above.
   */
  fields(field: QueryField): readonly string[];
  /** `TITLE:x`, `ti:x`, `x[ti]` — wherever the provider puts the field name. */
  scope(nativeField: string, value: string): string;
  /** Escaping, and whatever the provider does with `*` and `?`. */
  term(text: string): string;
  /** Quoting, for a run of words that must stay adjacent. */
  phrase(text: string): string;
  /** A year bound, or `undefined` where the provider cannot express one. */
  years(range: YearRange): string | undefined;
  /** A DOI clause inside a larger query, as opposed to a whole DOI lookup. */
  doi(value: string): string | undefined;
  /**
   * A value with no field around it, for concepts `fields` returns nothing for
   * — or `undefined` where the provider has no wider index to ask, and the
   * clause is then left out.
   */
  unscoped(value: string): string | undefined;
  /** False where the API has no negation. The clause is then dropped, not faked. */
  supportsNot: boolean;
  /**
   * One person, from the words of their name in the order they were written,
   * as this index finds a person — or `undefined` where these words cannot be
   * sent as a name.
   *
   * Only for an index that keeps authors as names rather than as words, where
   * each word of `AU=Jennifer AND AU=Doudna` on its own finds nothing. See
   * `withAuthorName`; a dialect without one renders author clauses as it
   * renders every other.
   */
  authorName?(words: readonly string[]): string | undefined;
};

/**
 * The flat query's terms as one provider can send them, or `undefined` when
 * one of them cannot be — and then nothing of the flat query can.
 *
 * `send` returns a term in the form the provider runs faithfully, or `''` for
 * one it cannot: a wildcard its index would answer wrongly, a term with nothing
 * in it to search for. No term is left out. Leaving out one of several
 * alternatives narrows the query; leaving out a required one widens it, which
 * would be safe only if `matchesQuery` applied it afterwards — and the flat
 * form no longer says which field a term came from, so it may be a `topic`
 * term, whose absence is never convicted. See `cannotSend`.
 */
export function flatTerms(query: Query, send: (term: string) => string): string[] | undefined {
  const words = query.terms.map(term => term.trim()).filter(Boolean);
  const sent = words.map(send).filter(Boolean);
  return sent.length < words.length ? undefined : sent;
}

/**
 * A flat query's scoped terms and phrases as the clauses a provider ANDs.
 *
 * Under `AND` the terms are one group and each phrase a clause of its own, all
 * required, as the flat form has always been sent. Under `OR` every term and
 * every phrase is an alternative, in one group. The phrases used to be pushed
 * as clauses of their own whatever the join — "phrases are always required" —
 * which is right for the search box this form predates, where "any of these
 * words" still meant every quoted phrase. A flat `OR` now only ever comes from
 * an `OR` in the query, where the phrase is one of the alternatives, and
 * requiring it asked `a OR "b c"` as `a AND "b c"`: the records only `a`
 * matched were never read.
 *
 * Grouped either way, so an `OR` cannot swallow the clauses the caller ANDs
 * beside it — `a OR b AND year:[…]` does not mean what it looks like.
 */
export function joinFlat(terms: readonly string[], phrases: readonly string[], join: QueryJoin): string[] {
  if (join === 'OR') {
    const alternatives = [...terms, ...phrases];
    if (alternatives.length === 0) return [];
    return [alternatives.length > 1 ? `(${alternatives.join(' OR ')})` : alternatives[0]!];
  }

  const clauses: string[] = [];
  if (terms.length > 0) clauses.push(terms.length > 1 ? `(${terms.join(' AND ')})` : terms[0]!);
  clauses.push(...phrases);
  return clauses;
}

/**
 * Whether `matchesQuery` convicts a record that lacks a clause on this field.
 *
 * It does for a title, an abstract, an author, a venue or a publisher — this
 * service holds the whole of each — and it does not for `topic` or `all`,
 * which reach indexes it holds no copy of: a miss there is `unknown`, and the
 * record is kept (see `matchesClause`). So a clause on the first kind can be
 * left out of a provider's query and applied to what comes back; one on the
 * second cannot, because nothing that comes back without it is ever removed.
 */
function convictable(field: QueryField): boolean {
  return field !== 'topic' && field !== 'all';
}

/**
 * Whether leaving this part of a query out of a provider's request widens the
 * request for good: true when the part holds, outside any `NOT`, a `topic` or
 * `all` clause.
 *
 * Leaving a part out is undone only where `matchesQuery` convicts a record that
 * fails it — see `convictable`. A topic or `all` term it never convicts on, so
 * everything the wider request brings back without it is kept. A negated part
 * turns that round: a record is convicted for *having* what it excludes, which
 * this service can see, so leaving out a `NOT` is safe — unless what it negates
 * negates a topic term in turn.
 */
export function dropsForGood(node: QueryNode, negated = false): boolean {
  switch (node.kind) {
    case 'clause':
      return !negated && !convictable(node.field);
    case 'and':
    case 'or':
      return node.nodes.some(child => dropsForGood(child, negated));
    case 'not':
      return dropsForGood(node.node, !negated);
  }
}

/**
 * What a render left out that `dropsForGood`. Filled in by `renderExpression`
 * when it is handed one, which only `cannotSend` does.
 */
type DropProbe = { forGood: boolean };

/**
 * True when this provider cannot be sent the tree without leaving out a part
 * that `dropsForGood`: a topic or `all` term it has no faithful form of — a
 * wildcard its index answers wrongly, a term with nothing in it to search for —
 * or an `OR` it cannot send whole that holds one.
 *
 * Left out, such a part widens the request and the widening is never undone.
 * Measured on 2026-09-30, `TS=crispr AND TS=*generation` with the wildcard left
 * out came back 30% papers containing it; and on 2026-10-01,
 * `TS=crispr AND (TS=mouse OR TS=rat)` from the providers asked for `crispr`
 * alone came back 2% and 9% papers mentioning either animal, against 100% from
 * every provider sent the OR. A provider in that position is not asked;
 * `translate` returns nothing, which reports it skipped.
 *
 * Decided by rendering, because what is left out is whatever the render could
 * not express, and checked before the caller renders for real, because a
 * render that fails falls back to the flat form, which would ask the widened
 * question anyway.
 */
export function cannotSend(node: QueryNode, dialect: Dialect): boolean {
  const probe: DropProbe = { forGood: false };
  const rendered = renderExpression(node, dialect, false, probe);
  return probe.forGood || (rendered === undefined && dropsForGood(node));
}

/**
 * Whether the flat form — `Query.terms`, `phrases` and `join` — states this
 * tree whole, give or take a part it may leave out: one clause, an AND of
 * clauses and `NOT`s, or an OR of clauses.
 *
 * Anything nested is not. The flat form keeps a tree's required leaves, or with
 * none required its alternatives, so `crispr AND (mouse OR rat)` reaches a
 * provider as `crispr`, and the `OR` it lost is a topic clause `matchesQuery`
 * never applies (see `dropsForGood`). A provider that translates from the flat
 * form needs another route for such a tree, or none.
 */
export function flatStatesWhole(node: QueryNode): boolean {
  switch (node.kind) {
    case 'clause':
      return true;
    case 'and':
      return node.nodes.every(child => child.kind === 'clause' || child.kind === 'not');
    case 'or':
      return node.nodes.every(child => child.kind === 'clause');
    case 'not':
      return false;
  }
}

function renderClause(node: Extract<QueryNode, { kind: 'clause' }>, dialect: Dialect): string | undefined {
  const { field, value } = node;

  if (value.kind === 'years') {
    return field === 'year' ? dialect.years(value.range) : undefined;
  }

  if (field === 'doi') return dialect.doi(value.text);

  // A term this provider cannot send is left out, which only widens the query
  // where `matchesQuery` can apply it afterwards. Where it cannot, `cannotSend`
  // has already kept the provider from being asked.
  const rendered = value.kind === 'phrase' ? dialect.phrase(value.text) : dialect.term(value.text);
  if (!rendered) return undefined;

  const natives = dialect.fields(field);
  // No native field for this concept: ask the whole index instead of not
  // asking. Wider than the query, which the local evaluator corrects.
  if (natives.length === 0) return dialect.unscoped(rendered);

  const scoped = natives.map(native => dialect.scope(native, rendered));
  return scoped.length === 1 ? scoped[0]! : `(${scoped.join(' OR ')})`;
}

/**
 * A word of a name that is only an initial — "A", "A.", "B.U.", PubMed's "JA".
 * The part of a name the sources write most differently, or leave off.
 */
export function isInitial(word: string): boolean {
  const letters = word.replace(/[.\-‐]/g, '');
  return letters.length <= 1 || (letters.length <= 3 && /^[A-Z]+$/.test(letters));
}

/**
 * A name as its words, each required on the author field, for an index that
 * keeps authors word by word — a dialect's `authorName` where the index has no
 * notion of a name. Initials are left out: a source that writes the forename
 * has no "J" to match, and `matchesQuery` checks the initial where it matters.
 *
 * Measured live on 2026-10-01 for the phrase a Web of Science author search
 * carries, "Doudna, Jennifer": DOAJ found 0 for the phrase and 59 for the
 * words, PLOS 0 and 93. Each word is a word of the phrase, so this only ever
 * asks for more.
 */
export function nameAsWords(words: readonly string[], dialect: Dialect): string | undefined {
  const natives = dialect.fields('author');
  const names = words.filter(word => !isInitial(word));
  if (names.length === 0 || natives.length === 0) return undefined;

  const clauses: string[] = [];
  for (const word of names) {
    const term = dialect.term(word);
    if (!term) return undefined;
    const scoped = natives.map(native => dialect.scope(native, term));
    clauses.push(scoped.length === 1 ? scoped[0]! : `(${scoped.join(' OR ')})`);
  }
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' AND ')})`;
}

/**
 * The word an author clause names, when it names one outright: a bare term on
 * `author`, with no wildcard in it. A wildcard is a pattern, not part of a
 * name, and is left to render as a clause of its own.
 */
function authorWord(node: QueryNode): string | undefined {
  if (node.kind !== 'clause' || node.field !== 'author' || node.value.kind !== 'term') return undefined;
  const text = node.value.text.trim();
  return text && !/[*?]/.test(text) ? text : undefined;
}

/**
 * `literal`, or that and the same words sent as one person's name.
 *
 * Europe PMC and PubMed keep authors as names — "Doudna JA" — and match a bare
 * word only as a surname. So a name written one clause per word — which the
 * web app's author links were, for a while — found nothing in either and still
 * would, typed: measured live on 2026-10-01 with
 * the open-access filter, `AUTH:Jennifer AND AUTH:Doudna` is 0 where
 * `AUTH:Doudna` is 155, and `Jennifer[au] AND Doudna[au]` is 0 against 172.
 * Asked for the words as a name, each parses it itself, in either order and
 * with or without initials: Europe PMC's `AUTH:"Jennifer Doudna"` and
 * `AUTH:"Doudna Jennifer"` are both 153, PubMed's unquoted `Jennifer
 * Doudna[au]` and `Doudna Jennifer[au]` both 169, and `Jennifer A. Doudna[au]`
 * 162.
 *
 * The name is ORed with the literal clauses rather than put in their place,
 * which is what keeps this a widening: whatever the words matched before, they
 * still match. That matters when the words are not one person —
 * `AU=Doudna AND AU=Charpentier` is two co-authors, the name "Doudna
 * Charpentier" finds no one, and the literal half still returns the 6 papers
 * the two wrote together, measured on both indexes. `matchesQuery` holds what
 * comes back to the words, as it did before.
 *
 * Never under a `NOT`, where widening the clause would narrow the query.
 * Commas are dropped from the words: Europe PMC finds `"Doudna Jennifer"` and
 * nothing for `"Doudna, Jennifer"`, which is how bioRxiv writes the name.
 */
function withAuthorName(literal: string | undefined, words: readonly string[], dialect: Dialect): string | undefined {
  if (!literal || !dialect.authorName) return literal;
  const parts = words.flatMap(word => word.split(',')).map(word => word.trim()).filter(Boolean);
  if (parts.length < 2) return literal;
  const name = dialect.authorName(parts);
  if (!name || name === literal) return literal;
  return `(${literal} OR ${name})`;
}

/**
 * Every composite below wraps itself, so nothing here re-wraps its children: a
 * child is either an atom that needs no parentheses or a group that already
 * carries its own. `NOT` is the exception and always brackets what it negates,
 * because how tightly negation binds is the one thing these dialects do not
 * agree on.
 */
export function renderExpression(
  node: QueryNode,
  dialect: Dialect,
  negated = false,
  probe?: DropProbe
): string | undefined {
  // A child of a required AND that renders to nothing is left out of the
  // request. `cannotSend` hands a probe in to learn whether that was safe.
  const leftOut = (child: QueryNode, part: string | undefined) => {
    if (probe && !negated && part === undefined && dropsForGood(child)) probe.forGood = true;
  };

  switch (node.kind) {
    case 'clause': {
      const rendered = renderClause(node, dialect);
      // A phrase on `author` is a name already: `AU="Jennifer Doudna"`, which
      // PubMed finds nothing for quoted. See `withAuthorName`.
      if (negated || node.field !== 'author' || node.value.kind !== 'phrase') return rendered;
      return withAuthorName(rendered, node.value.text.split(/\s+/), dialect);
    }

    case 'and': {
      // The words of one person's name, each its own clause, rendered
      // together, so the name can be sent beside them. The other children
      // render as before. See `withAuthorName`.
      const words = negated || !dialect.authorName ? [] : node.nodes.map(authorWord);
      const named = words.filter((word): word is string => word !== undefined);
      if (named.length >= 2) {
        const literal = node.nodes
          .filter((_, index) => words[index] !== undefined)
          .map(child => renderExpression(child, dialect, negated, probe))
          .filter((part): part is string => part !== undefined);
        const group = withAuthorName(
          literal.length === 0 ? undefined : literal.length === 1 ? literal[0] : `(${literal.join(' AND ')})`,
          named,
          dialect
        );
        const others = node.nodes.filter((_, index) => words[index] === undefined);
        const rest = others.map(child => renderExpression(child, dialect, negated, probe));
        others.forEach((child, index) => leftOut(child, rest[index]));
        const present = [group, ...rest].filter((part): part is string => part !== undefined);
        if (present.length === 0) return undefined;
        return present.length === 1 ? present[0]! : `(${present.join(' AND ')})`;
      }

      const parts = node.nodes.map(child => renderExpression(child, dialect, negated, probe));
      node.nodes.forEach((child, index) => leftOut(child, parts[index]));
      // A child that cannot be rendered is simply not required of the
      // provider. Every remaining child still is, so this stays a superset of
      // the records the query describes.
      //
      // Not under a `NOT`, where it turns round: `NOT (a AND b)` rendered as
      // `NOT (a)` excludes every `a` record, including the ones without `b`
      // that the query keeps. There the whole group is dropped, and the `NOT`
      // with it, which widens instead.
      if (negated && parts.some(part => part === undefined)) return undefined;
      const present = parts.filter((part): part is string => part !== undefined);
      if (present.length === 0) return undefined;
      return present.length === 1 ? present[0]! : `(${present.join(' AND ')})`;
    }

    case 'or': {
      // All or nothing. See the header: an `OR` missing a branch asks for less
      // than the query does, and the dropped branch's records are then gone.
      // Dropped whole, it is the AND above that leaves it out — see `leftOut`.
      const parts = node.nodes.map(child => renderExpression(child, dialect, negated, probe));
      if (parts.some(part => part === undefined)) return undefined;
      const present = parts as string[];
      return present.length === 1 ? present[0]! : `(${present.join(' OR ')})`;
    }

    case 'not': {
      if (!dialect.supportsNot) return undefined;
      const inner = renderExpression(node.node, dialect, !negated, probe);
      return inner === undefined ? undefined : `NOT (${inner})`;
    }
  }
}
