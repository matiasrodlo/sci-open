import { Fragment } from 'react';
import Link from 'next/link';
import { BookOpen, User } from 'lucide-react';
import { fieldSearchHref } from '@/lib/entity-search';

/**
 * A name on the byline, as a link to everything under that name.
 *
 * The colour says which kind of name it is before it is read — green for a
 * person, amber for a venue — which is how OpenAlex lets a list be scanned for
 * one author. See `fieldSearchHref` for why the search is a phrase.
 */
export function EntityLink({ field, name }: { field: 'author' | 'venue'; name: string }) {
  const Icon = field === 'author' ? User : BookOpen;
  const href = fieldSearchHref(field, name);
  const className = `font-semibold ${field === 'author' ? 'text-author' : 'text-venue'}`;
  // The icon is held to the first word, or a line can end on a bare icon and
  // start the next with the name it belonged to.
  const space = name.indexOf(' ');
  const first = space === -1 ? name : name.slice(0, space);
  const rest = space === -1 ? '' : name.slice(space);
  const content = (
    <>
      <span className="whitespace-nowrap">
        <Icon className="mr-0.5 inline h-3 w-3 -translate-y-px" aria-hidden="true" />
        {first}
      </span>
      {rest}
    </>
  );

  if (!href) return <span className={className}>{content}</span>;

  return (
    <Link
      href={href}
      className={`${className} hover:underline`}
      title={field === 'author' ? `Search for papers by ${name}` : `Search for papers in ${name}`}
    >
      {content}
    </Link>
  );
}

/**
 * "2024 by A, B and C in Venue" — the year, then who, then where, the line
 * OpenAlex puts under every title.
 *
 * `shown` is how many authors are named before the rest become "et al.": a
 * list wants three, a paper's own page has room for more.
 */
export function Byline({
  year,
  authors,
  venue,
  shown
}: {
  year?: number | undefined;
  authors: readonly string[];
  venue?: string | undefined;
  shown: number;
}) {
  const named = authors.filter(name => name && name.trim());
  const listed = named.slice(0, shown);

  if (!year && listed.length === 0 && !venue) return null;

  return (
    <>
      {year && <span>{year}</span>}
      {listed.length > 0 && (
        <>
          {year ? ' by ' : 'By '}
          {listed.map((name, index) => (
            <Fragment key={`${name}-${index}`}>
              {index > 0 && (index === listed.length - 1 && named.length <= shown ? ' and ' : ', ')}
              <EntityLink field="author" name={name} />
            </Fragment>
          ))}
          {named.length > shown && <span className="text-muted-foreground">, et al.</span>}
        </>
      )}
      {venue && (
        <>
          {year || listed.length > 0 ? ' in ' : 'In '}
          <EntityLink field="venue" name={venue} />
        </>
      )}
    </>
  );
}
