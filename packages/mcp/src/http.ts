import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createServerFactory, selectionFrom, type ServerDeps } from './server';
import { selectTools } from './toolsets';

/**
 * The server over Streamable HTTP, as a web-standard handler a host mounts
 * (the API wraps it with `toNodeHandler`). The same factory as stdio, so the
 * two can never offer different tools.
 *
 * Stateless: every request gets a fresh instance from the factory, which is
 * what lets any replica answer any request — a search handle carries its own
 * search (D4). 2025-era clients are served the same way, so `GET` and
 * `DELETE`, their session operations, answer 405.
 *
 * No `responseMode`. The default answers a call as JSON and upgrades it to an
 * SSE stream only when the handler sends a notification before its result —
 * which ours do only for a client that asked for progress (D12). `'json'`
 * would drop those notifications.
 *
 * Writes are always refused here, whatever the config says: `save_to` names a
 * path on the caller's machine, and over HTTP this process is not on it.
 */
export function createHttpHandler(
  deps: Omit<ServerDeps, 'transport'>,
  options: { onerror?: (error: Error) => void; maxRequestBodySize?: number } = {}
): McpHttpHandler {
  const handler = createMcpHandler(
    createServerFactory({ ...deps, config: { ...deps.config, allowWrites: false }, transport: 'http' }),
    {
      legacy: 'stateless',
      ...(options.maxRequestBodySize ? { maxRequestBodySize: options.maxRequestBodySize } : {}),
      // Reporting only; it never alters the response. A host logs the message,
      // never the request, which can hold a query or a reference.
      onerror: options.onerror ?? (() => {})
    }
  );
  return {
    ...handler,
    // A typo in `?toolsets=` would otherwise throw inside the factory, which
    // the SDK answers as an opaque 500. It is the caller's mistake, and the
    // valid names are the fix, as `--toolsets` answers on stdio.
    fetch: async (request, requestOptions) => {
      try {
        selectTools(selectionFrom(new URL(request.url)));
      } catch (error) {
        return Response.json(
          { jsonrpc: '2.0', id: null, error: { code: -32602, message: (error as Error).message } },
          { status: 400 }
        );
      }
      return handler.fetch(request, requestOptions);
    }
  };
}
