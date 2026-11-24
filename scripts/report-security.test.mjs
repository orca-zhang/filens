import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAlert, auditSummary, cargoAuditSummary, cargoPackages, npmVersions, renderMarkdown } from './report-security.mjs';

const alert = { number: 1, dependency: { manifest_path: 'Cargo.lock', package: { name: 'zip', ecosystem: 'rust' } },
  security_advisory: { severity: 'critical', ghsa_id: 'example' },
  security_vulnerability: { vulnerable_version_range: '>= 0.6.0, < 9.0.5' } };

test('checks every locked version, including vulnerable transitive copies', () => {
  assert.equal(assessAlert(alert, ['9.1.3']).status, 'patched-locally');
  assert.equal(assessAlert(alert, ['9.1.3', '2.6.1']).status, 'unresolved');
  assert.equal(assessAlert(alert, []).status, 'dependency-removed');
  assert.throws(() => assessAlert(alert, ['unparsed-version']));
});

test('counts an advisory once despite multiple affected dependency chains', () => {
  const via = { name: 'picomatch', url: 'https://example.test/advisory' };
  const result = auditSummary({ metadata: { vulnerabilities: { high: 3, total: 3 } },
    vulnerabilities: { picomatch: { via: [via] }, vite: { via: ['picomatch', via] } } });
  assert.equal(result.affectedPackages.total, 3);
  assert.equal(result.uniqueAdvisories.length, 1);
});

test('does not interpret a failed or incomplete audit as zero findings', () => {
  assert.throws(() => auditSummary({ error: { code: 'E404' } }));
  assert.throws(() => auditSummary({}));
});

test('reads all Cargo.lock package records and rejects malformed lockfiles', () => {
  assert.deepEqual(cargoPackages('version = 4\n[[package]]\nname = "zip"\nversion = "2.6.1"\n[[package]]\nname = "zip"\nversion = "9.1.3"\n'),
    [['zip', '2.6.1'], ['zip', '9.1.3']]);
  assert.throws(() => cargoPackages(''));
  assert.throws(() => cargoPackages('[[package]]\nname = "zip"'));
});

test('keeps RustSec vulnerabilities separate from maintenance and yanked warnings', () => {
  const report = cargoAuditSummary({ database: { commit: 'abc' },
    vulnerabilities: { count: 0, list: [] },
    warnings: { unmaintained: [{ package: { name: 'old-crate', version: '1.0.0' }, advisory: { id: 'RUSTSEC-1', title: 'unmaintained' } }],
      unsound: [], yanked: [{ package: { name: 'gone-crate', version: '0.1.0' } }] } });
  assert.equal(report.vulnerabilities.length, 0);
  assert.equal(report.unmaintained[0].advisory, 'RUSTSEC-1');
  assert.equal(report.yanked[0].package, 'gone-crate');
  assert.throws(() => cargoAuditSummary({ vulnerabilities: { list: [] } }));
});

test('renders RustSec warnings separately from known vulnerabilities', () => {
  const markdown = renderMarkdown({ observedAt: '2026-11-18T12:00:00Z',
    summary: { githubAlerts: 1, patchedLocally: 1, dependenciesRemoved: 0, unresolvedGithubAlerts: 0,
      uniqueNpmAdvisories: 0, rustsecVulnerabilities: 0, rustsecUnmaintainedWarnings: 1,
      rustsecUnsoundWarnings: 0, rustsecYankedPackages: 0 },
    npmScans: [{}],
    rustSecScans: [
      { lock: 'Cargo.lock', unmaintained: [{ package: 'old-crate', version: '1.0.0', advisory: 'RUSTSEC-1', title: 'unmaintained' }], unsound: [], yanked: [] },
      { lock: 'step/Cargo.lock', unmaintained: [{ package: 'old-crate', version: '1.0.0', advisory: 'RUSTSEC-1', title: 'unmaintained' }], unsound: [], yanked: [] }
    ],
    localPatches: [], reviewNotes: [], limits: [] });
  assert.match(markdown, /未维护/);
  assert.match(markdown, /Cargo\.lock`、`step\/Cargo\.lock/);
  assert.match(markdown, /## RustSec 告警/);
});

test('uses the matching workspace lock and refuses unscanned manifests', () => {
  const locks = new Map([['package-lock.json', { 'packages/core': {}, 'node_modules/fflate': { version: '0.8.3' } }],
    ['integration/package-lock.json', { 'node_modules/fflate': { version: '0.8.2' } }]]);
  assert.deepEqual(npmVersions(locks, 'packages/core/package.json', 'fflate'), ['0.8.3']);
  assert.deepEqual(npmVersions(locks, 'integration/package.json', 'fflate'), ['0.8.2']);
  assert.throws(() => npmVersions(locks, 'unknown/package.json', 'fflate'));
});
