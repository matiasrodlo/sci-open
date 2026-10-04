#!/usr/bin/env node
import { readFileSync } from 'fs';
import { parseArgs } from 'util';
import * as z from 'zod';
import { createEngine, useLogger } from '@sci-open/core';
import { readMcpConfig } from '../config';
import { stderrLogger } from '../log';
import { nullMetrics } from '../metrics';
import { tokenBucket } from '../admission';
import { ToolError, renderError, reportToolError, toToolError } from '../errors';
import { inputOf, type ToolDefinition, type ToolDeps } from '../framework/define-tool';
import { paperRefKind } from '../tools/resolve-paper';
import { searchPapers } from '../tools/search-papers';
import { getPaper } from '../tools/get-paper';
import { verifyReferences } from '../tools/verify-references';
import { readPaper } from '../tools/read-paper';
import { getCitations } from '../tools/get-citations';
import { exportCitations } from '../tools/export-citations';

const USAGE = `sci-open <command>

  search "<query>" [--page-size N] [--count]   search_papers (--count: count_only)
  paper <id or DOI>                            get_paper
  verify <file>                                verify_references, one reference per line (25 at most)
  read <id or DOI> [--section ID [--offset N] | --find TEXT | --out FILE]
                                               read_paper: the outline, a section, a search, or all of it to a file
  refs <DOI or id> [--offset N]                get_citations: what the paper cites
  citers <DOI or id> [--offset N]              get_citations: what cites the paper
  cite <DOI or id>... [--ris] [--abstracts] [--out FILE]
                                               export_citations: BibTeX (or RIS) to stdout, or to a file

Configured by the same environment variables as sci-open-mcp.`;

function readArgs() {
  try {
    return parseArgs({
      allowPositionals: true,
      strict: true,
      options: {
        'page-size': { type: 'string' },
        count: { type: 'boolean' },
        section: { type: 'string' },
        offset: { type: 'string' },
        find: { type: 'string' },
        out: { type: 'string' },
        ris: { type: 'boolean' },
        abstracts: { type: 'boolean' },
        help: { type: 'boolean' }
      }
    });
  } catch (error) {
    throw new ToolError('invalid_input', (error as Error).message, USAGE);
  }
}

/**
 * The same tool definitions the server registers, called directly — their
 * input validated by the same schemas, their text printed. The CLI owns its
 * terminal, so unlike the server it writes results to stdout, and it keeps
 * the untrusted fences: an agent reading this output needs them as much as
 * one calling the tools.
 */
async function main(): Promise<void> {
  const { values, positionals } = readArgs();
  const [command, ...rest] = positionals;
  if (!command || values.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }

  const { config, warnings } = readMcpConfig(process.env, []);
  const logger = stderrLogger(config.logLevel);
  useLogger(logger);
  for (const warning of warnings) logger.warn({}, warning);

  const deps: ToolDeps = {
    engine: createEngine({
      userAgent: config.userAgent,
      apiKeys: config.apiKeys,
      search: { depth: config.searchDepth },
      ...(config.openCitationsToken ? { openCitationsToken: config.openCitationsToken } : {})
    }),
    config,
    metrics: nullMetrics,
    logger,
    transport: 'stdio',
    signal: new AbortController().signal, // a CLI run ends with its process
    admit: tokenBucket(config.maxNewSearchesPerMinute),
    progress: () => {}
  };

  const run = async (def: ToolDefinition<any, any>, args: unknown): Promise<void> => {
    const parsed = inputOf(def, true).safeParse(args); // the server's own limits and defaults
    if (!parsed.success) throw new ToolError('invalid_input', z.prettifyError(parsed.error));
    // Logged as the server logs it, so a fault's cause reaches stderr too.
    const outcome = await def.run(parsed.data, deps).catch((error: unknown) => {
      throw reportToolError(error, def.name, logger);
    });
    // An export's file is the output; its one-line summary goes to stderr, so
    // `sci-open cite … > refs.bib` writes a file a reference manager reads.
    if (outcome.resources?.length) {
      process.stderr.write(`${outcome.text}\n`);
      for (const attached of outcome.resources) process.stdout.write(attached.resource.text);
      return;
    }
    process.stdout.write(`${outcome.text}\n`);
  };

  switch (command) {
    case 'search':
      return run(searchPapers, {
        query: rest.join(' '),
        ...(values['page-size'] ? { page_size: Number(values['page-size']) } : {}),
        ...(values.count ? { count_only: true } : {})
      });
    case 'paper':
      return run(getPaper, paperRefKind(rest[0] ?? ''));
    case 'read':
      return run(readPaper, {
        paper: rest[0] ?? '',
        ...(values.out
          ? { save_to: values.out }
          : values.section
            ? { view: 'section', section: values.section, ...(values.offset ? { offset: Number(values.offset) } : {}) }
            : values.find
              ? { view: 'search', query: values.find }
              : {})
      });
    case 'refs':
    case 'citers':
      return run(getCitations, {
        paper: rest[0] ?? '',
        direction: command === 'refs' ? 'references' : 'cited_by',
        ...(values.offset ? { offset: Number(values.offset) } : {})
      });
    case 'cite':
      return run(exportCitations, {
        papers: rest,
        format: values.ris ? 'ris' : 'bibtex',
        ...(values.abstracts ? { include_abstracts: true } : {}),
        ...(values.out ? { save_to: values.out } : {})
      });
    case 'verify':
      return run(verifyReferences, {
        references: readFileSync(rest[0] ?? '/dev/stdin', 'utf8').split('\n').map(l => l.trim()).filter(Boolean)
      });
    default:
      throw new ToolError('invalid_input', `Unknown command "${command}".`, USAGE);
  }
}

main().catch(error => {
  process.stderr.write(`${renderError(toToolError(error))}\n`);
  process.exit(1);
});
