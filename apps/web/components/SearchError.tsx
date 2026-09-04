import Link from 'next/link';
import { AlertTriangle, Clock, Gauge, Link2Off, ServerCrash } from 'lucide-react';
import type { SearchFailure } from '@/lib/search-error';
import { isRetryable } from '@/lib/search-error';

/**
 * What a failed search says to the person who ran it.
 *
 * One panel used to cover every failure — "There was an error performing your
 * search. Please try again." — which is wrong advice in two of the five cases
 * and useless in a third. A rate limit needs a wait, a malformed URL needs a
 * new search rather than a retry, and an unreachable service needs the reader
 * to know it is not their query.
 *
 * Each case therefore says what happened, whose problem it is, and what to do
 * next, in that order. Naming whose problem it is is not politeness: a reader
 * who thinks a bad query caused this will keep editing the query.
 *
 * A server component on purpose. Nothing here is interactive — the retry is a
 * page reload, which the browser already offers — so this costs no client
 * bundle and renders inside the same Suspense boundary as the results.
 */

const COPY: Record<SearchFailure, { icon: typeof AlertTriangle; title: string; detail: string }> = {
  'rate-limited': {
    icon: Gauge,
    title: 'Too many searches just now',
    detail:
      'The service limits how many searches it will run in a minute, and that limit has been reached. ' +
      'Nothing is wrong with your query — wait a few seconds and run it again.'
  },
  'bad-request': {
    icon: Link2Off,
    title: 'This search address is not valid',
    detail:
      'Part of this URL asks for something the search service will not accept, which usually means a ' +
      'bookmark from an older version of the site or an address that was edited by hand. Reloading ' +
      'will not help; start a new search instead.'
  },
  timeout: {
    icon: Clock,
    title: 'The search took too long',
    detail:
      'The service accepted the search and did not finish it in time. This is more likely on a broad ' +
      'query than a narrow one — try again, or add a term to narrow it.'
  },
  unavailable: {
    icon: ServerCrash,
    title: 'The search service is not answering',
    detail:
      'Nothing answered the request at all, so the service is stopped or unreachable. This is not ' +
      'something your search can cause and not something you can fix — try again shortly.'
  },
  'server-error': {
    icon: AlertTriangle,
    title: 'The search failed while running',
    detail:
      'The service accepted the search and then failed part way through. Trying again often works, ' +
      'because the failure is frequently one provider rather than the service. If it keeps happening, ' +
      'the problem is on our side.'
  }
};

export function SearchError({ failure }: { failure: SearchFailure }) {
  const { icon: Icon, title, detail } = COPY[failure];

  return (
    <div className="text-center py-12" role="alert">
      <Icon className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground mb-4 mx-auto max-w-prose">{detail}</p>

      {/*
        * Offered only where a retry is hopeless, so the one case that needs a
        * different action is the one case that gets a link. Everywhere else the
        * advice is "run it again", and a link away from the results would be
        * pointing at the wrong thing.
        */}
      {!isRetryable(failure) && (
        <Link
          href="/"
          className="text-sm font-medium underline underline-offset-4 hover:text-foreground"
        >
          Start a new search
        </Link>
      )}
    </div>
  );
}
