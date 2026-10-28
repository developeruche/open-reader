/**
 * Fails when a dependency uses a license outside the allowlist. Run in CI via `pnpm licenses:check`.
 * GPL components are allowed only by name (personal-use build, see docs/THIRD_PARTY.md).
 */
import { execFileSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'Python-2.0',
  'OFL-1.1',
  'Unlicense',
  'MIT-0',
  '(MIT OR CC0-1.0)',
  '(MIT OR Apache-2.0)',
  '(MIT AND Zlib)',
  '(BSD-2-Clause OR MIT OR Apache-2.0)',
]);
/** Packages allowed despite a license outside the list, with the reason. */
const EXCEPTIONS: Record<string, string> = {};

interface LicenseEntry {
  name: string;
  versions: string[];
}

const out = execFileSync('pnpm', ['licenses', 'list', '--json'], { encoding: 'utf8' });
const byLicense = JSON.parse(out) as Record<string, LicenseEntry[]>;
const bad: string[] = [];
for (const [license, pkgs] of Object.entries(byLicense)) {
  if (ALLOWED.has(license)) continue;
  for (const p of pkgs)
    if (!(p.name in EXCEPTIONS)) bad.push(`${p.name}@${p.versions.join(',')}: ${license}`);
}
if (bad.length) {
  console.error(
    `Licenses need review (add to docs/THIRD_PARTY.md and the allowlist):\n${bad.join('\n')}`,
  );
  process.exit(1);
}
console.log('All dependency licenses are on the allowlist.');
