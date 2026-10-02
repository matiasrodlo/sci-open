import { describe, it, expect, vi } from 'vitest';
import { readMcpConfig, defaultMcpConfig } from '../src/config';
import { selectTools } from '../src/toolsets';

const EMAIL = { UNPAYWALL_EMAIL: 'ops@example.org' };

describe('readMcpConfig', () => {
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

  it('takes provider keys, but not the placeholders .env.example ships with', () => {
    const { config } = readMcpConfig({ ...EMAIL, OPENALEX_API_KEY: 'real-key', CORE_API_KEY: 'your_core_api_key_here' }, []);
    expect(config.apiKeys).toEqual({ openalex: 'real-key' });
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
  const names = (request: Parameters<typeof selectTools>[0]) => selectTools(request).map(t => t.name);

  it('serves core and read by default, in a fixed order', () => {
    expect(names({})).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper']);
    expect(names({ toolsets: ['default'] })).toEqual(names({}));
  });

  it('serves every tool for all, and adds tools by name', () => {
    expect(names({ toolsets: ['all'] })).toEqual(['search_papers', 'get_search_page', 'get_paper', 'verify_references', 'read_paper']);
    expect(names({ toolsets: ['graph'], tools: ['get_paper'] })).toEqual(['get_paper']);
    expect(names({ toolsets: ['core'] })).not.toContain('read_paper');
  });

  it('refuses an unknown toolset or tool, naming the valid ones', () => {
    expect(() => selectTools({ toolsets: ['nope'] })).toThrow('Unknown toolset "nope". Toolsets: core, read, graph, export.');
    expect(() => selectTools({ tools: ['read_pdf'] })).toThrow(/Unknown tool "read_pdf".*Tools: search_papers/);
  });
});
