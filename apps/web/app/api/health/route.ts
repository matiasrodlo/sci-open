/**
 * Whether this service can reach the API. It is what the compose health check
 * asks.
 *
 * That check used to fetch `/`, which renders the home page and never calls
 * the API. Measured while reproducing `a0574e3f`: with `API_ORIGIN` pointing
 * where this container could not reach, every search answered 502 while api,
 * web and redis all reported healthy.
 *
 * A readiness answer, not a liveness one. It fails when the API cannot be
 * reached from here, whichever side is at fault, and restarting this service
 * does not bring the API back — so an orchestrator that restarts what is
 * unhealthy should probe `/` for liveness and this for readiness.
 *
 * Says whether, not why. The reason — an address, a refused connection — goes
 * to the log, where an operator looks, rather than to whoever asked.
 *
 * A static segment, so it is answered here rather than by the proxy beside it,
 * which forwards only the routes it lists and would answer this with a 404.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Inside the compose check's own five-second timeout. */
const BUDGET_MS = 3000;

const NO_STORE = { 'cache-control': 'no-store' };

export async function GET(): Promise<Response> {
  const origin = (process.env.API_ORIGIN || 'http://localhost:4000').replace(/\/+$/, '');

  try {
    const answer = await fetch(`${origin}/health`, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(BUDGET_MS)
    });
    if (answer.ok) return Response.json({ status: 'ok' }, { headers: NO_STORE });
    console.error(`Health check: the API answered ${answer.status}`);
  } catch (error) {
    console.error('Health check: the API could not be reached', error);
  }

  return Response.json({ status: 'unavailable' }, { status: 503, headers: NO_STORE });
}
