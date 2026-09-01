#!/usr/bin/env node
/**
 * Fails on any high-severity advisory that has not been explicitly accepted.
 *
 * `pnpm audit --audit-level high` cannot do this on its own here. It is all or
 * nothing: either the job blocks on every advisory, which means it blocks
 * today and gets switched off, or it reports and blocks on nothing, which is
 * what it did for the whole refactor — `continue-on-error: true`, a number
 * nobody read, and 107 advisories by the time phase 12 ran.
 *
 * pnpm's own `auditConfig.ignoreGhsas` would express this, but it landed in
 * pnpm 9 and this repo is pinned to 8.10.0 by `packageManager`. Rather than
 * take a pnpm major to get an allowlist, the allowlist lives here, where it
 * has to carry a reason and the thing that removes it.
 *
 * The point of the gate is not that the accepted list is empty. It is that a
 * *new* high advisory breaks the build, and that every accepted one is named,
 * attributed to a specific piece of scheduled work, and impossible to add
 * without saying why.
 *
 *   node scripts/audit-gate.mjs
 */
import { execSync } from 'node:child_process';

/**
 * Advisories we are knowingly carrying, and what clears each.
 *
 * **Empty, and that is the intended state rather than a milestone.** It held
 * ten: two cleared by Fastify 4 -> 5 and eight by Next 14 -> 15, each entry
 * naming the upgrade that would remove it. Both upgrades have been done, the
 * gate reported all ten stale, and the tree is now at zero high or critical
 * against 27 when this list was written.
 *
 * The gate's value was never that the list was empty — it was that a *new* high
 * advisory breaks the build while every carried one is named, attributed to
 * scheduled work, and impossible to add without saying why. That is what kept
 * the list shrinking instead of accumulating, and it is why an entry added here
 * has to carry the same two things: a reason, and the specific change that
 * removes it.
 */
const ACCEPTED = [];

const BLOCKING = new Set(['high', 'critical']);

function audit() {
  try {
    // `pnpm audit` exits non-zero when it finds anything, so the output is
    // read off the failure rather than treated as one.
    return execSync('pnpm audit --json', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    if (error.stdout) return error.stdout;
    throw error;
  }
}

const report = JSON.parse(audit());
const advisories = Object.values(report.advisories ?? {});
const accepted = new Map(ACCEPTED.map(entry => [entry.id, entry]));

const blocking = advisories.filter(a => BLOCKING.has(a.severity));
const unexpected = blocking.filter(a => !accepted.has(a.github_advisory_id));
const seen = new Set(blocking.map(a => a.github_advisory_id));

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `advisories: ${advisories.length} total — ` +
  Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')
);
console.log(`high or critical: ${blocking.length}, of which ${blocking.length - unexpected.length} accepted\n`);

for (const entry of ACCEPTED) {
  if (!seen.has(entry.id)) {
    console.log(`  stale  ${entry.id} (${entry.pkg}) is no longer reported — remove it from ACCEPTED`);
  }
}

if (unexpected.length === 0) {
  console.log('No unaccepted high-severity advisories.');
  process.exit(0);
}

console.error(`\n${unexpected.length} unaccepted high-severity advisor${unexpected.length === 1 ? 'y' : 'ies'}:\n`);
for (const a of unexpected) {
  console.error(`  ${a.github_advisory_id}  ${a.module_name}`);
  console.error(`    ${a.title}`);
  console.error(`    installed ${a.findings?.[0]?.version ?? '?'}, patched ${a.patched_versions}`);
  console.error(`    ${a.url}\n`);
}
console.error('Resolve with `pnpm update` or a pnpm.overrides entry. If it truly needs a');
console.error('major upgrade, add it to ACCEPTED in scripts/audit-gate.mjs with the reason.');
process.exit(1);
