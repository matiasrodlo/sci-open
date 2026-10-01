'use client';

import Link from 'next/link';

interface RelatedPapersProps {
  topics?: string[];
}

/**
 * The topics already on the record, as links into a search.
 *
 * This component used to run a second full search to render four links:
 * it POSTed `/api/search` with the record's first three topics joined by
 * ` OR `, measured at 25.5 seconds and 2,361 fetched records, every time
 * anyone opened a paper. The four links it produced were the top of a
 * relevance ranking for a query nobody typed.
 *
 * The topics are already in hand, so no request is needed to say what a paper
 * is about. Each one links to the search it stands for, which is both honest
 * about what the link does and something the user can act on — the previous
 * version's links went to individual papers chosen by a query it never showed.
 *
 * Opening a paper now triggers no search at all.
 */
export function RelatedPapers({ topics }: RelatedPapersProps) {
  const shown = (topics ?? []).filter(topic => topic && topic.trim()).slice(0, 12);

  if (shown.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-topics-heading">
      <h2 id="related-topics-heading" className="mb-1 text-lg font-semibold tracking-tight">
        Related topics
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        Search for other open-access papers on these subjects.
      </p>
      <ul className="flex flex-wrap gap-2">
        {shown.map(topic => (
          <li key={topic}>
            <Link
              href={`/results?q=${encodeURIComponent(topic)}`}
              className="inline-block rounded-md border bg-card px-2.5 py-1 text-[13px] text-foreground/85 transition-colors hover:border-foreground/60 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {topic}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
