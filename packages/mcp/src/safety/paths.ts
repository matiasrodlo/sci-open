import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { ToolError } from '../errors';

export type WritePolicy = { allowed: boolean };

/**
 * The only place this server writes a file, and only a file the user named:
 * an absolute path (a leading ~ is expanded), with the extension forced, and
 * nothing overwritten unless asked.
 */
export async function writeUserFile(
  policy: WritePolicy,
  requested: string,
  extension: '.md' | '.bib' | '.ris',
  contents: string,
  overwrite = false
): Promise<string> {
  if (!policy.allowed) {
    throw new ToolError('writes_disabled', 'This server is not allowed to write files.', 'Omit save_to to receive the content inline.');
  }
  const expanded = requested === '~' || requested.startsWith('~/') ? path.join(os.homedir(), requested.slice(1)) : requested;
  if (!path.isAbsolute(expanded)) {
    throw new ToolError('invalid_input', 'save_to must be an absolute path.', 'Example: /Users/me/papers/smith2024.md');
  }
  const target = expanded.endsWith(extension) ? expanded : `${expanded}${extension}`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, { flag: overwrite ? 'w' : 'wx' }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EEXIST') throw new ToolError('invalid_input', `${target} already exists.`, 'Pass overwrite: true, or choose another path.');
    throw e;
  });
  return target;
}
