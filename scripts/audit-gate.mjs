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
 * Every entry here is blocked on a major upgrade that the runbook scopes as
 * its own task, because the fix version is behind a major: Fastify's patch is
 * >=5.7.2 against a 4.x tree, and Next's are >=15.x against 14.x. Neither is a
 * dependency bump — Fastify 5 requires Node 20+ and changes the logger and
 * plugin contracts, and Next 15 requires React 19 and makes `params` and
 * `searchParams` async in every server component.
 *
 * Nothing else belongs in this list. An advisory that `pnpm update` or a
 * `pnpm.overrides` entry can resolve should be resolved — that is how the
 * other 97 went.
 */
const ACCEPTED = [
  // Fastify 4 -> 5. Content-Type header tab character allows body validation bypass.
  { id: 'GHSA-jx2c-rxcm-jvmq', pkg: 'fastify', clearedBy: 'Fastify 4 -> 5' },
  // Reached only through fastify@4's pinned router.
  { id: 'GHSA-c96f-x56v-gq3h', pkg: 'find-my-way', clearedBy: 'Fastify 4 -> 5' },

  // Next 14 -> 15. Seven DoS/SSRF advisories whose patch versions are all 15.x.
  { id: 'GHSA-h25m-26qc-wcjf', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-q4gf-8mx6-v5v3', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-36qx-fr4f-26g5', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-8h8q-6873-q5fj', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-c4j6-fc7j-m34r', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-89xv-2m56-2m9x', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-m99w-x7hq-7vfj', pkg: 'next', clearedBy: 'Next 14 -> 15' },
  { id: 'GHSA-p9j2-gv94-2wf4', pkg: 'next', clearedBy: 'Next 14 -> 15' }
];

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
