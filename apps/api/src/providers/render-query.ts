import type { QueryField, QueryNode, YearRange } from '@open-access-explorer/shared';

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
  /** A value with no field around it, for concepts `fields` returns nothing for. */
  unscoped(value: string): string;
  /** False where the API has no negation. The clause is then dropped, not faked. */
  supportsNot: boolean;
};

function renderClause(node: Extract<QueryNode, { kind: 'clause' }>, dialect: Dialect): string | undefined {
  const { field, value } = node;

  if (value.kind === 'years') {
    return field === 'year' ? dialect.years(value.range) : undefined;
  }

  if (field === 'doi') return dialect.doi(value.text);

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
 * Every composite below wraps itself, so nothing here re-wraps its children: a
 * child is either an atom that needs no parentheses or a group that already
 * carries its own. `NOT` is the exception and always brackets what it negates,
 * because how tightly negation binds is the one thing these dialects do not
 * agree on.
 */
export function renderExpression(node: QueryNode, dialect: Dialect): string | undefined {
  switch (node.kind) {
    case 'clause':
      return renderClause(node, dialect);

    case 'and': {
      // A child that cannot be rendered is simply not required of the
      // provider. Every remaining child still is, so this stays a subset of
      // the records the query describes being asked for.
      const parts = node.nodes
        .map(child => renderExpression(child, dialect))
        .filter((part): part is string => part !== undefined);
      if (parts.length === 0) return undefined;
      return parts.length === 1 ? parts[0]! : `(${parts.join(' AND ')})`;
    }

    case 'or': {
      // All or nothing. See the header: an `OR` missing a branch asks for less
      // than the query does, and the dropped branch's records are then gone.
      const parts = node.nodes.map(child => renderExpression(child, dialect));
      if (parts.some(part => part === undefined)) return undefined;
      const present = parts as string[];
      return present.length === 1 ? present[0]! : `(${present.join(' OR ')})`;
    }

    case 'not': {
      if (!dialect.supportsNot) return undefined;
      const inner = renderExpression(node.node, dialect);
      return inner === undefined ? undefined : `NOT (${inner})`;
    }
  }
}
