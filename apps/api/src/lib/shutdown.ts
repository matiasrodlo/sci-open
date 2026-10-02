import { log } from './logger';

/** Something held for the life of the process and released on the way out. */
export type Resource = {
  name: string;
  close(): Promise<void> | void;
};

/**
 * Stops taking requests, lets the ones in flight finish, and only then
 * releases what they were using.
 *
 * The order is the point. The handlers this replaced destroyed the upstream
 * HTTP agents and quit Redis first and closed the server last, so every
 * search still running when a deploy sent SIGTERM lost its sockets mid-fan-out
 * and failed. `server.close()` is Fastify's: it stops accepting connections,
 * answers new requests on open ones with a 503, and resolves once the
 * requests already running have been answered — after which nothing is left
 * to need the resources.
 *
 * One resource failing to close is logged and does not stop the next; the
 * process is exiting either way, and a Redis that will not answer QUIT is no
 * reason to leave sockets open to ten upstreams. The server failing to close
 * is no reason either: that rejection used to end the sequence before any
 * resource was released, and reach the signal handler as an unhandled one.
 * The promise this returns does not reject.
 *
 * Returns a function that runs the sequence once however many times it is
 * called, so a second signal during a slow drain does not start it again.
 */
export function gracefulShutdown(
  server: { close(): Promise<unknown> },
  resources: readonly Resource[]
): () => Promise<void> {
  let running: Promise<void> | undefined;

  return () => {
    running ??= (async () => {
      try {
        await server.close();
      } catch (error) {
        log.error('Failed to stop the server during shutdown', error);
      }
      for (const resource of resources) {
        try {
          await resource.close();
        } catch (error) {
          log.warn(`Failed to close ${resource.name} during shutdown`, error);
        }
      }
    })();
    return running;
  };
}
