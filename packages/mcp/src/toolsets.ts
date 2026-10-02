import type { ToolDefinition, Toolset } from './framework/define-tool';
import { searchPapers } from './tools/search-papers';
import { getSearchPage } from './tools/get-search-page';
import { getPaper } from './tools/get-paper';
import { verifyReferences } from './tools/verify-references';
import { readPaper } from './tools/read-paper';

/**
 * Every tool this release ships, in a fixed order: tools/list must be
 * deterministic, for clients that cache it and for prompt caching. `graph`
 * (get_citations) and `export` (export_citations) are named so a client
 * config can ask for them, and are empty until their milestones ship.
 */
export const ALL_TOOLS: readonly ToolDefinition<any, any>[] = [searchPapers, getSearchPage, getPaper, verifyReferences, readPaper];

export const DEFAULT_TOOLSETS: readonly Toolset[] = ['core', 'read'];
export const TOOLSETS: readonly Toolset[] = ['core', 'read', 'graph', 'export'];

/** Old name → current name. Add a row whenever a tool is renamed; never delete one. */
export const ALIASES: Readonly<Record<string, string>> = {};

/**
 * The tools a request asks for: toolsets (default `core,read`; `all`;
 * `default`) plus individual tools by name. An unknown name fails, with the
 * valid ones — a typo in a client config must never silently drop a tool.
 */
export function selectTools(request: { toolsets?: readonly string[]; tools?: readonly string[] }): ToolDefinition<any, any>[] {
  const sets = request.toolsets?.length ? request.toolsets : DEFAULT_TOOLSETS;
  const unknownSets = sets.filter(s => s !== 'all' && s !== 'default' && !TOOLSETS.includes(s as Toolset));
  const names = (request.tools ?? []).map(n => ALIASES[n] ?? n);
  const unknownTools = names.filter(n => !ALL_TOOLS.some(t => t.name === n));
  if (unknownSets.length || unknownTools.length) {
    throw new Error(
      `Unknown ${[...unknownSets.map(s => `toolset "${s}"`), ...unknownTools.map(t => `tool "${t}"`)].join(', ')}. ` +
      `Toolsets: ${TOOLSETS.join(', ')}. Tools: ${ALL_TOOLS.map(t => t.name).join(', ')}.`
    );
  }
  const wanted = new Set<Toolset>(sets.includes('all') ? TOOLSETS : sets.flatMap(s => (s === 'default' ? DEFAULT_TOOLSETS : [s as Toolset])));
  return ALL_TOOLS.filter(t => wanted.has(t.toolset) || names.includes(t.name));
}
