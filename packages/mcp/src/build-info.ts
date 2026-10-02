/** Replaced with the commit's SHA by esbuild's `define` in scripts/build-npm.ts. */
declare const __SCI_OPEN_COMMIT__: string | undefined;

/**
 * Who this server is, for provenance and `serverInfo`. Committed rather than
 * generated, so `tsc`, the tests and the linter never depend on a build step;
 * `typeof` on an undeclared global is `'undefined'`, not a `ReferenceError`,
 * so the workspace build runs with `commit` absent and the npm bundle has it.
 */
export const BUILD = {
  version: '0.4.0', // build-info.test.ts keeps this equal to package.json
  commit: typeof __SCI_OPEN_COMMIT__ === 'string' ? __SCI_OPEN_COMMIT__ : undefined
};
