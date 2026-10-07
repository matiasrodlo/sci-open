import { describe, it, expect, vi } from 'vitest';
import { readMcpConfig, defaultMcpConfig } from '../src/config';
import { selectTools } from '../src/toolsets';

const EMAIL = { UNPAYWALL_EMAIL: 'ops@example.org' };

describe('readMcpConfig', () => {
  it('serves stdio unless asked for HTTP', () => {
    expect(readMcpConfig(EMAIL, []).config.http).toBeUndefined();
  });

  it('reads the HTTP settings from flags and the environment, flags first, and never writes there', () => {
    const { config } = readMcpConfig({
      ...EMAIL, SCI_OPEN_HTTP_PORT: '9000', SCI_OPEN_ALLOWED_ORIGINS: 'a.example, b.example',
      SCI_OPEN_TRUST_PROXY: 'loopback,10.0.0.0/8', SCI_OPEN_REQUESTS_PER_MIN: '90', SCI_OPEN_TOTAL_NEW_SEARCHES_PER_MIN: '300',
      SCI_OPEN_ADMIN_KEY: 'k'
    }, ['--http', '--port', '8081', '--host', '0.0.0.0']);
    expect(config.http).toEqual({
      host: '0.0.0.0', port: 8081, allowedOrigins: ['a.example', 'b.example'], trustProxy: ['loopback', '10.0.0.0/8'],
      requestsPerMinute: 90, totalNewSearchesPerMinute: 300, adminKey: 'k'
    });
    expect(config.allowWrites).toBe(false);
  });

  it('defaults to loopback on 8080, trusting no proxy and allowing no browser', () => {
    expect(readMcpConfig({ ...EMAIL, SCI_OPEN_HTTP: '1' }, []).config.http).toEqual({
      host: '127.0.0.1', port: 8080, allowedOrigins: [], trustProxy: [], requestsPerMinute: 60, totalNewSearchesPerMinute: 120
    });
  });

  it('refuses a port that is not one, and warns that --port alone serves stdio', () => {
    expect(readMcpConfig(EMAIL, ['--http', '--port', 'eighty']).exit).toMatchObject({ code: 2 });
    const { config, warnings } = readMcpConfig(EMAIL, ['--port', '9000']);
    expect(config.http).toBeUndefined();
    expect(warnings).toContain('--port and --host apply only with --http; serving stdio');
  });

  it('starts from the defaults, with the contact in the User-Agent', () => {
    const { config, warnings } = readMcpConfig(EMAIL, []);
    expect(warnings).toEqual([]);
    expect(config).toMatchObject({
      allowWrites: true, trustedFullTextOnly: false, textBudgetChars: 40_000, structuredBudgetChars: 80_000,
      maxNewSearchesPerMinute: 30, searchDepth: 300, logLevel: 'warn', engine: 'live', apiKeys: {}
    });
    expect(config.userAgent).toMatch(/^sci-open-mcp\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/matiasrodlo\/sci-open; mailto:ops@example\.org\)$/);
    expect(config.toolsets).toBeUndefined();
  });

  it('warns without a contact, and still starts', () => {
    const { config, warnings } = readMcpConfig({}, []);
    expect(warnings[0]).toMatch(/UNPAYWALL_EMAIL is not set/);
    expect(config.userAgent).not.toContain('mailto');
  });

  it('lets a flag beat its variable', () => {
    const { config } = readMcpConfig({ ...EMAIL, SCI_OPEN_TOOLSETS: 'core', SCI_OPEN_LOG_LEVEL: 'error' }, ['--toolsets', 'all', '--log-level', 'debug']);
    expect(config.toolsets).toEqual(['all']);
    expect(config.logLevel).toBe('debug');
  });

  it('turns writes off by flag or by variable', () => {
    expect(readMcpConfig(EMAIL, ['--no-writes']).config.allowWrites).toBe(false);
    expect(readMcpConfig({ ...EMAIL, SCI_OPEN_ALLOW_WRITES: '0' }, []).config.allowWrites).toBe(false);
    expect(readMcpConfig({ ...EMAIL, SCI_OPEN_ALLOW_WRITES: 'false' }, []).config.allowWrites).toBe(false);
  });

  it('warns and falls back on a number out of range or a level it does not know', () => {
    const { config, warnings } = readMcpConfig({ ...EMAIL, SEARCH_DEPTH: '50000', SCI_OPEN_TEXT_BUDGET_CHARS: 'lots', SCI_OPEN_LOG_LEVEL: 'loud' }, []);
    expect(config.searchDepth).toBe(300);
    expect(config.textBudgetChars).toBe(40_000);
    expect(config.logLevel).toBe('warn');
    expect(warnings).toHaveLength(3);
  });

  it('reads 300 records per source unless told otherwise, at most 2,000', () => {
    expect(readMcpConfig({ ...EMAIL, SEARCH_DEPTH: '2000' }, []).config.searchDepth).toBe(2000);
    expect(readMcpConfig({ ...EMAIL, SEARCH_DEPTH: '2001' }, []).config.searchDepth).toBe(300);
  });

  it('takes provider keys, but not the placeholders .env.example ships with, nor one for a source no longer asked', () => {
    const { config } = readMcpConfig({ ...EMAIL, NCBI_API_KEY: 'real-key', CORE_API_KEY: 'your_core_api_key_here', OPENALEX_API_KEY: 'old-key' }, []);
    expect(config.apiKeys).toEqual({ ncbi: 'real-key' });
  });

  it('leaves out the sources it is told to, flag first, and warns about a name that is no source', () => {
    expect(readMcpConfig(EMAIL, []).config).not.toHaveProperty('without');
    expect(readMcpConfig({ ...EMAIL, SCI_OPEN_WITHOUT: 'Crossref' }, []).config.without).toEqual(['crossref']);
    expect(readMcpConfig({ ...EMAIL, SCI_OPEN_WITHOUT: 'doaj' }, ['--without', 'core,crossref']).config.without).toEqual(['core', 'crossref']);
    const { config, warnings } = readMcpConfig({ ...EMAIL, SCI_OPEN_WITHOUT: 'crossref,openalex' }, []);
    expect(config.without).toEqual(['crossref']);
    expect(warnings).toEqual([expect.stringMatching(/^--without openalex is not a source \(.*crossref.*\); ignored$/)]);
  });

  it('exits 0 for --help and --version and 2 for an unknown flag, writing nothing to stdout', () => {
    const write = vi.spyOn(process.stdout, 'write');
    expect(readMcpConfig(EMAIL, ['--help']).exit).toMatchObject({ code: 0, output: expect.stringContaining('--toolsets') });
    expect(readMcpConfig(EMAIL, ['--version']).exit).toMatchObject({ code: 0, output: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    expect(readMcpConfig(EMAIL, ['--bogus']).exit).toMatchObject({ code: 2 });
    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('is never allowed to write when a host starts from the defaults', () => {
    expect(defaultMcpConfig('ua').allowWrites).toBe(false);
  });
});

describe('selectTools', () => {
  const names = (request: Parameters<typeof selectTools>[0], writable = true) => selectTools(request, writable).map(t => t.name);

  it('serves core and read by default, in a fixed order', () => {
    expect(names({})).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper', 'save_paper']);
    expect(names({ toolsets: ['default'] })).toEqual(names({}));
  });

  it('serves every tool for all, and adds tools by name', () => {
    expect(names({ toolsets: ['all'] })).toEqual([
      'search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper', 'save_paper', 'get_citations', 'export_citations'
    ]);
    expect(names({ toolsets: ['graph'] })).toEqual(['get_citations']);
    expect(names({ toolsets: ['default'], tools: ['export_citations'] })).toEqual([
      'search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper', 'save_paper', 'export_citations'
    ]);
    expect(names({ toolsets: ['graph'], tools: ['get_paper'] })).toEqual(['get_paper', 'get_citations']);
    expect(names({ toolsets: ['core'] })).not.toContain('read_paper');
  });

  it('leaves save_paper out where writes are not allowed, and refuses it by name there', () => {
    expect(names({}, false)).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper']);
    expect(names({ toolsets: ['all'] }, false)).not.toContain('save_paper');
    expect(() => selectTools({ tools: ['save_paper'] }, false)).toThrow(/"save_paper" only writes files/);
  });

  it('refuses an unknown toolset or tool, naming the valid ones', () => {
    expect(() => selectTools({ toolsets: ['nope'] }, true)).toThrow('Unknown toolset "nope". Toolsets: core, read, graph, export.');
    expect(() => selectTools({ tools: ['read_pdf'] }, true)).toThrow(/Unknown tool "read_pdf".*Tools: search_papers/);
  });
});
