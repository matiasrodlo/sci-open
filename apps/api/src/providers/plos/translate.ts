import type { Query } from '@open-access-explorer/shared';

/**
 * Query -> the PLOS Solr query string. Pure, and the only place that knows
 * this API's syntax.
 *
 * `everything:crispr gene editing` and the explicitly AND-ed form were once
 * measured returning the same 5,940, and read as "this provider never had
 * arXiv's disjunction problem". The equality was real and the reading was
 * luck: `everything` is Solr's *default* field here, so the words after the
 * first fell into it anyway and the prefix was doing nothing either way.
 *
 * That stopped being true the moment the search was scoped — `title:gene
 * editing` matches 7,301 and `title:"gene editing"` matches 44 — which is why
 * `scoped` below prefixes every term rather than trusting one prefix to carry
 * the clause.
 */

/**
 * The fields a search for a subject means.
 *
 * `everything` was here, and for PLOS that is not a figure of speech — PLOS
 * publishes its own full text and indexes it, so `everything:` behaves exactly
 * like the OpenAlex `search` parameter this provider's neighbour moved away
 * from. Measured on `crispr gene editing` against the research-article filter:
 * **5,563** matches through `everything`, **359** in the title or abstract.
 *
 * `subject` is in the list for the same reason Europe PMC's `MESH` and
 * PubMed's `[mh]` are: it is the subject index, and dropping it would be a
 * loss rather than a noise cut. Here it recovers 2 records of 361 where Europe
 * PMC's recovers a tenth of the set — the rule is the same, the yield is a
 * property of how each corpus is indexed.
 */
const FIELDS = ['title', 'abstract', 'subject'] as const;

/** PLOS indexes from 2003; the ends of an open range have to be real dates. */
const EARLIEST = '2000-01-01T00:00:00Z';
const LATEST = '9999-12-31T23:59:59Z';

function quote(phrase: string): string {
  return `"${phrase.replace(/"/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

/**
 * One search word or quoted phrase, across the fields above.
 *
 * Per term, not one group wrapping the query, because a Solr field prefix
 * binds to the token after it and nothing else. Measured: `title:gene editing`
 * matches **7,301** — `gene` in the title and `editing` loose in the default
 * field — where `title:"gene editing"` matches **44**. A query scoped on its
 * first word and unscoped on the rest is worse than one that was never scoped,
 * and it looks fine from the outside.
 */
function scoped(value: string): string {
  return `(${FIELDS.map(field => `${field}:${value}`).join(' OR ')})`;
}

export type TranslateOptions = {
  /**
   * Accepted and ignored. Every PLOS journal is fully open access, so there is
   * no subset to narrow to.
   */
  openAccessOnly?: boolean;
};

export function translate(query: Query, _options: TranslateOptions = {}): string {
  const clauses: string[] = [];

  if (query.doi) {
    // `id`, not `doi`. A PLOS article's id *is* its DOI, and there is no `doi`
    // field — asking for one returns the entire corpus rather than an error:
    // `doi:"10.1371/journal.pgen.1002441"` matched 64,432 documents where
    // `id:"..."` matches exactly the one. The old connector used `doi:`, so
    // every PLOS DOI lookup answered with an arbitrary page of the corpus.
    clauses.push(`id:${quote(query.doi)}`);
  } else {
    const terms = query.terms.filter(t => t.trim()).map(t => scoped(t.trim()));
    const phrases = query.phrases.filter(p => p.trim()).map(p => scoped(quote(p)));

    if (terms.length > 0) {
      const joined = terms.join(` ${query.join} `);
      // Parenthesised so an OR join cannot swallow the date clause beside it.
      clauses.push(terms.length > 1 ? `(${joined})` : joined);
    }
    clauses.push(...phrases);
  }

  const { from, to } = query.years ?? {};
  if (from !== undefined || to !== undefined) {
    // Both ends are explicit. The old connector defaulted a missing lower
    // bound to the year 2000 and a missing upper bound to the current year —
    // two invented bounds that silently excluded anything outside them.
    const start = from !== undefined ? `${from}-01-01T00:00:00Z` : EARLIEST;
    const end = to !== undefined ? `${to}-12-31T23:59:59Z` : LATEST;
    clauses.push(`publication_date:[${start} TO ${end}]`);
  }

  return clauses.join(' AND ');
}
