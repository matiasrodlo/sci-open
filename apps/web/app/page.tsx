import { Suspense } from 'react';
import Link from 'next/link';
import {
  AlignLeft,
  ArrowRight,
  BookOpen,
  Braces,
  Calendar,
  Hash,
  Heading,
  Quote,
  Search,
  User,
  type LucideIcon
} from 'lucide-react';
import { AdvancedSearchBar } from '@/components/AdvancedSearchBar';
import { AUTHORITIES, SEARCHED_SOURCES } from '@/lib/provider-labels';

const searchHref = (query: string) => `/results?q=${encodeURIComponent(query)}`;

/**
 * Searches to start from, set out the way OpenAlex sets out works beside its
 * search box: a kind above, the thing itself as a link, a line of context.
 *
 * OpenAlex fills that column with real records. This page has none to show
 * without running a search on every visit, and the thing a new reader most
 * needs to see is that the box takes more than words — so each entry is a
 * working query in one of the shapes the grammar accepts, and clicking it runs
 * it.
 */
const EXAMPLES: Array<{ kind: string; query: string; note: string; icon: LucideIcon }> = [
  {
    kind: 'Keywords',
    query: 'crispr gene editing',
    note: 'Words with no tag search titles, abstracts and keywords.',
    icon: Search
  },
  {
    kind: 'Field tags',
    query: 'TS=(crispr OR cas9) NOT AU=Doudna',
    note: 'Web of Science syntax, pasted as it is.',
    icon: Braces
  },
  {
    kind: 'Phrase and years',
    query: 'TI="climate adaptation" AND PY=2020-2024',
    note: 'Quotes keep words together; a year takes a range.',
    icon: Quote
  },
  {
    kind: 'One journal',
    query: 'SO="PLOS ONE" AND TS=malaria',
    note: 'A journal, repository or preprint server by name.',
    icon: BookOpen
  }
];

/** The grammar, a tag to a card. See `query-grammar.ts` for the whole of it. */
const SYNTAX: Array<{ tag: string; name: string; note: string; example?: string; icon: LucideIcon }> = [
  {
    tag: 'TS=',
    name: 'Topic',
    note: 'Title, abstract and keywords together. A word with no tag searches here.',
    example: 'TS=microplastics',
    icon: Search
  },
  {
    tag: 'TI=',
    name: 'Title',
    note: 'The title alone, for when a word in the abstract is not enough.',
    example: 'TI="large language models"',
    icon: Heading
  },
  {
    tag: 'AB=',
    name: 'Abstract',
    note: 'The abstract alone — methods and designs are named there, not in titles.',
    example: 'AB="randomized controlled trial" AND TS=sleep',
    icon: AlignLeft
  },
  {
    tag: 'AU=',
    name: 'Author',
    note: 'A name, or several in brackets, each standing for itself.',
    example: 'AU=(Doudna OR Charpentier)',
    icon: User
  },
  {
    tag: 'SO=',
    name: 'Source',
    note: 'The journal, repository or preprint server the paper appeared in.',
    example: 'SO=eLife AND TS=neuroscience',
    icon: BookOpen
  },
  {
    tag: 'PY=',
    name: 'Year',
    note: 'A year or a range: 2020, 2020-2024, 2020- and -2024.',
    example: 'TS=malaria AND PY=2020-',
    icon: Calendar
  },
  {
    tag: 'AND OR NOT',
    name: '',
    note: 'Both, either, or not. Brackets group, and the order is Web of Science’s.',
    example: 'TS=(crispr OR cas9) NOT AU=Doudna',
    icon: Braces
  },
  {
    tag: '#1 AND #2',
    name: '',
    note: 'Every search you run is numbered in the history under the box. Combine them by number.',
    icon: Hash
  }
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 px-4 pb-20 pt-14 sm:px-6 md:pt-24 lg:grid-cols-2 lg:gap-20">
        <div>
          <h1 className="text-[2.75rem] font-bold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-6xl">
            Find research anyone can read
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted-foreground">
            One search across {SEARCHED_SOURCES.slice(0, 4).join(', ')} and{' '}
            {SEARCHED_SOURCES.length - 4} more scholarly sources, kept to the papers that are
            open access.
          </p>
          <div className="mt-8 max-w-lg">
            <Suspense fallback={<div className="h-[6.5rem] animate-pulse rounded-lg border bg-muted/40" />}>
              <AdvancedSearchBar />
            </Suspense>
          </div>
        </div>

        <section aria-labelledby="examples-heading">
          <h2 id="examples-heading" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Try a search
          </h2>
          <ul className="mt-2 divide-y">
            {EXAMPLES.map(({ kind, query, note, icon: Icon }) => (
              <li key={query} className="flex gap-3 py-4">
                <Icon className="mt-[1.4rem] h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {kind}
                  </div>
                  <Link
                    href={searchHref(query)}
                    className="mt-0.5 block break-words font-mono text-[15px] text-link hover:underline"
                  >
                    {query}
                  </Link>
                  <p className="mt-1 text-sm text-muted-foreground">{note}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section id="sources" aria-labelledby="sources-heading" className="scroll-mt-16 border-y bg-subtle">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2
            id="sources-heading"
            className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground"
          >
            Sources
          </h2>
          <ul className="mx-auto mt-7 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {SEARCHED_SOURCES.map(name => (
              <li key={name} className="text-xl font-semibold tracking-tight text-foreground/75">
                {name}
              </li>
            ))}
          </ul>
          {/* Not "searched together": a source is sent only the searches it
              can answer, and the results page names any that were not. */}
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
            Each search goes to every source that can answer it, and the results say which
            did. A paper with a DOI is then looked up in {AUTHORITIES.slice(0, -1).join(', ')} and{' '}
            {AUTHORITIES[AUTHORITIES.length - 1]} — for the registrar&rsquo;s record, how it is
            open, and who cites it.
          </p>
        </div>
      </section>

      <section id="syntax" aria-labelledby="syntax-heading" className="mx-auto max-w-6xl scroll-mt-16 px-4 pt-20 sm:px-6">
        <h2 id="syntax-heading" className="text-4xl font-bold tracking-[-0.03em] sm:text-5xl">
          Search the way you already do
        </h2>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-muted-foreground">
          The box reads Web of Science&rsquo;s query language, so a search copied from a methods
          section or a saved alert means the same thing here. Plain words work too.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SYNTAX.map(({ tag, name, note, example, icon: Icon }) => (
            <li key={tag} className="flex flex-col rounded-lg border bg-card p-5">
              <div className="flex items-center gap-2 text-[15px] font-semibold">
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <code className="font-mono">{tag}</code>
                {name && <span>{name}</span>}
              </div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{note}</p>
              <div className="mt-auto pt-4">
                {example && (
                  <div className="flex items-end justify-between gap-3">
                    <code className="min-w-0 break-words font-mono text-xs text-foreground/80">{example}</code>
                    <Link
                      href={searchHref(example)}
                      className="inline-flex shrink-0 items-center gap-1 text-[13.5px] font-semibold hover:underline"
                      aria-label={`Try ${example}`}
                    >
                      Try
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-6 text-sm text-muted-foreground">
          Also <code className="font-mono text-foreground/80">DO=</code> for a DOI,{' '}
          <code className="font-mono text-foreground/80">PU=</code> for a publisher and{' '}
          <code className="font-mono text-foreground/80">ALL=</code> for every field. Tags take{' '}
          <code className="font-mono text-foreground/80">=</code> or{' '}
          <code className="font-mono text-foreground/80">:</code>, in either case.
        </p>
      </section>
    </>
  );
}
