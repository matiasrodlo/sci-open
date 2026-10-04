import { parseArgs } from 'util';
import { MAX_DEPTH, usableApiKey, type ApiKeys } from '@sci-open/core';
import { BUILD } from './build-info';
import type { LogLevel } from './log';

export type McpConfig = {
  userAgent: string;
  apiKeys: ApiKeys;
  toolsets?: string[];
  tools?: string[];
  allowWrites: boolean;
  trustedFullTextOnly: boolean;
  textBudgetChars: number;
  structuredBudgetChars: number;
  maxNewSearchesPerMinute: number;
  /** Records read per source. 300, half the engine's default of 600: see D11. */
  searchDepth: number;
  logLevel: LogLevel;
  openCitationsToken?: string;
  /** `fixture` serves recorded answers, for evals and demos. */
  engine: 'live' | 'fixture';
  fixturesPath?: string;
  /** Serve Streamable HTTP instead of stdio (`--http`). */
  http?: HttpConfig;
};

/** The HTTP server's own settings. See `http-server.ts`. */
export type HttpConfig = {
  host: string;
  port: number;
  /** Hostnames a browser may call from. Empty refuses every browser `Origin`. */
  allowedOrigins: string[];
  /** Proxies trusted to name the client in X-Forwarded-For, as proxy-addr reads them. */
  trustProxy: string[];
  /** Requests a minute per client, any kind. */
  requestsPerMinute: number;
  /** Serve without an OpenAlex key. For a trial, never a shared deployment. */
  allowUnkeyed: boolean;
  /** Enables GET /metrics for whoever sends it as a bearer token. */
  adminKey?: string;
};

/** The config, warnings to log once a logger exists, and — for `--help`,
 * `--version` or a bad flag — what to print and the code to exit with. */
export type ConfigResult = { config: McpConfig; warnings: string[]; exit?: { code: number; output: string } };

const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
const KEYED = ['core', 'ncbi', 'doaj', 'datacite', 'openalex'] as const;

export const USAGE = `sci-open-mcp: MCP server for open-access scientific literature, over stdio or HTTP.

  --toolsets <list>         core, read, graph, export, all, default  [SCI_OPEN_TOOLSETS]
  --tools <list>            extra tools by name                      [SCI_OPEN_TOOLS]
  --no-writes               refuse save_to                           [SCI_OPEN_ALLOW_WRITES=0]
  --trusted-fulltext-only   full text from Europe PMC and arXiv only [SCI_OPEN_TRUSTED_FULLTEXT_ONLY=1]
  --engine <live|fixture>   fixture serves recorded answers          [SCI_OPEN_ENGINE]
  --fixtures <path>         the recordings for --engine fixture      [SCI_OPEN_FIXTURES]
  --log-level <level>       error, warn, info or debug, to stderr    [SCI_OPEN_LOG_LEVEL]
  --http                    serve Streamable HTTP at /mcp, not stdio [SCI_OPEN_HTTP=1]
  --port <n>                HTTP port, 8080 by default               [SCI_OPEN_HTTP_PORT]
  --host <address>          HTTP address, 127.0.0.1 by default       [SCI_OPEN_HTTP_HOST]
  --help, --version

Over HTTP: OPENALEX_API_KEY is required (SCI_OPEN_ALLOW_UNKEYED=1 for a trial),
SCI_OPEN_ALLOWED_ORIGINS names hostnames a browser may call from,
SCI_OPEN_TRUST_PROXY the proxies that may name the client, SCI_OPEN_ADMIN_KEY
enables GET /metrics, and save_to is always refused.

Set UNPAYWALL_EMAIL to a real address. Every setting is listed in Appendix A of
docs/mcp-implementation-manual.md.`;

/** Whether a tool may write a file here: only on a local connection, where
 * the path a caller names is on this machine, and only when allowed. */
export function writesAllowed(deps: { transport: 'stdio' | 'http'; config: Pick<McpConfig, 'allowWrites'> }): boolean {
  return deps.transport === 'stdio' && deps.config.allowWrites;
}

/** Every default, nothing read. A host serving HTTP starts from this. */
export function defaultMcpConfig(userAgent: string): McpConfig {
  return {
    userAgent,
    apiKeys: {},
    allowWrites: false,
    trustedFullTextOnly: false,
    textBudgetChars: 40_000,
    structuredBudgetChars: 80_000,
    maxNewSearchesPerMinute: 30,
    searchDepth: 300,
    logLevel: 'warn',
    engine: 'live'
  };
}

/**
 * Environment variables first, then flags, which win. Returns warnings rather
 * than logging them: the logger is not configured yet when this runs.
 */
export function readMcpConfig(env: NodeJS.ProcessEnv, argv: string[]): ConfigResult {
  const warnings: string[] = [];
  const fallback = defaultMcpConfig('');

  let flags;
  try {
    flags = parseArgs({
      args: argv,
      strict: true,
      options: {
        toolsets: { type: 'string' },
        tools: { type: 'string' },
        'no-writes': { type: 'boolean' },
        'trusted-fulltext-only': { type: 'boolean' },
        engine: { type: 'string' },
        fixtures: { type: 'string' },
        'log-level': { type: 'string' },
        http: { type: 'boolean' },
        port: { type: 'string' },
        host: { type: 'string' },
        help: { type: 'boolean' },
        version: { type: 'boolean' }
      }
    }).values;
  } catch (error) {
    return { config: fallback, warnings, exit: { code: 2, output: `${(error as Error).message}\n\n${USAGE}` } };
  }
  if (flags.help) return { config: fallback, warnings, exit: { code: 0, output: USAGE } };
  if (flags.version) return { config: fallback, warnings, exit: { code: 0, output: BUILD.version } };

  const read = (name: string) => env[name]?.trim() || undefined;
  const list = (value: string | undefined) => value?.split(',').map(s => s.trim()).filter(Boolean);
  const isOff = (name: string) => ['0', 'false', 'no'].includes((read(name) ?? '').toLowerCase());
  const isOn = (name: string) => ['1', 'true', 'yes'].includes((read(name) ?? '').toLowerCase());
  const whole = (name: string, otherwise: number, min: number, max: number): number => {
    const raw = read(name);
    if (raw === undefined) return otherwise;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    warnings.push(`${name}=${raw} is not a whole number from ${min} to ${max}; using ${otherwise}`);
    return otherwise;
  };
  const oneOf = <T extends string>(name: string, raw: string | undefined, allowed: readonly T[], otherwise: T): T => {
    if (raw === undefined) return otherwise;
    const value = raw.toLowerCase() as T;
    if (allowed.includes(value)) return value;
    warnings.push(`${name} ${raw} is not one of ${allowed.join(', ')}; using ${otherwise}`);
    return otherwise;
  };

  const email = read('UNPAYWALL_EMAIL');
  if (!email) {
    warnings.push('UNPAYWALL_EMAIL is not set: Unpaywall refuses anonymous requests and OpenAlex meters them more tightly');
  }

  const apiKeys: ApiKeys = {};
  for (const provider of KEYED) {
    const key = usableApiKey(read(`${provider.toUpperCase()}_API_KEY`));
    if (key) apiKeys[provider] = key;
  }

  const toolsets = list(flags.toolsets ?? read('SCI_OPEN_TOOLSETS'));
  const tools = list(flags.tools ?? read('SCI_OPEN_TOOLS'));
  const openCitationsToken = read('OPENCITATIONS_TOKEN');
  const fixturesPath = flags.fixtures ?? read('SCI_OPEN_FIXTURES');

  let http: HttpConfig | undefined;
  if (flags.http || isOn('SCI_OPEN_HTTP')) {
    const port = flags.port ?? read('SCI_OPEN_HTTP_PORT');
    const portNumber = Number(port ?? 8080);
    if (!Number.isInteger(portNumber) || portNumber < 0 || portNumber > 65535) {
      return { config: fallback, warnings, exit: { code: 2, output: `--port ${port} is not a port number\n\n${USAGE}` } };
    }
    const adminKey = read('SCI_OPEN_ADMIN_KEY');
    http = {
      host: flags.host ?? read('SCI_OPEN_HTTP_HOST') ?? '127.0.0.1',
      port: portNumber,
      allowedOrigins: list(read('SCI_OPEN_ALLOWED_ORIGINS')) ?? [],
      trustProxy: list(read('SCI_OPEN_TRUST_PROXY')) ?? [],
      requestsPerMinute: whole('SCI_OPEN_REQUESTS_PER_MIN', 60, 1, 6000),
      allowUnkeyed: isOn('SCI_OPEN_ALLOW_UNKEYED'),
      ...(adminKey ? { adminKey } : {})
    };
  } else if (flags.port || flags.host) {
    warnings.push('--port and --host apply only with --http; serving stdio');
  }

  return {
    config: {
      userAgent: `sci-open-mcp/${BUILD.version} (+https://github.com/matiasrodlo/sci-open${email ? `; mailto:${email}` : ''})`,
      apiKeys,
      ...(toolsets?.length ? { toolsets } : {}),
      ...(tools?.length ? { tools } : {}),
      allowWrites: !flags['no-writes'] && !isOff('SCI_OPEN_ALLOW_WRITES'),
      trustedFullTextOnly: Boolean(flags['trusted-fulltext-only']) || isOn('SCI_OPEN_TRUSTED_FULLTEXT_ONLY'),
      textBudgetChars: whole('SCI_OPEN_TEXT_BUDGET_CHARS', fallback.textBudgetChars, 2_000, 400_000),
      structuredBudgetChars: whole('SCI_OPEN_STRUCTURED_BUDGET_CHARS', fallback.structuredBudgetChars, 2_000, 1_000_000),
      maxNewSearchesPerMinute: whole('SCI_OPEN_MAX_NEW_SEARCHES_PER_MIN', fallback.maxNewSearchesPerMinute, 1, 600),
      searchDepth: whole('SEARCH_DEPTH', fallback.searchDepth, 1, MAX_DEPTH),
      logLevel: oneOf('log level', flags['log-level'] ?? read('SCI_OPEN_LOG_LEVEL'), LOG_LEVELS, 'warn'),
      ...(openCitationsToken ? { openCitationsToken } : {}),
      engine: oneOf('engine', flags.engine ?? read('SCI_OPEN_ENGINE'), ['live', 'fixture'] as const, 'live'),
      ...(fixturesPath ? { fixturesPath } : {}),
      // Over HTTP the path a caller names is on their machine, not this one.
      ...(http ? { http, allowWrites: false } : {})
    },
    warnings
  };
}
