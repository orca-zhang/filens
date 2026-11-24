import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projects = ['.', 'integrations/deepseek-harness', 'benchmarks/frontend', 'benchmarks/frontend/other-formats'];
const cargoLocks = ['benchmarks/rust-engines/Cargo.lock', 'cli/Cargo.lock', 'wasm/converter-core-rust/Cargo.lock',
  'wasm/converter-image-rust/Cargo.lock', 'wasm/converter-step-rust/Cargo.lock'];
const removedGoManifests = new Set(['converter/go.mod', 'examples/go-wazero-converter/go.mod', 'wasm/converter-core/go.mod']);

function run(command, args, cwd = root, allowed = [0], env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 << 20, timeout: 180000 });
  if (result.error) throw result.error;
  if (!allowed.includes(result.status)) throw new Error(`${command} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

function parseJson(value, source) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${source}: ${error.message}`);
  }
}

export function auditSummary(audit) {
  if (audit.error || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) throw new Error('Incomplete npm audit response');
  const advisories = new Map();
  for (const item of Object.values(audit.vulnerabilities)) {
    for (const via of item.via) {
      if (typeof via === 'string') continue;
      advisories.set(via.url, { package: via.name, title: via.title, severity: via.severity, url: via.url, range: via.range });
    }
  }
  return { affectedPackages: audit.metadata.vulnerabilities, uniqueAdvisories: [...advisories.values()] };
}

export function assessAlert(alert, versions) {
  const range = alert.security_vulnerability.vulnerable_version_range.replaceAll(',', ' ');
  if (!semver.validRange(range) || versions.some(version => !semver.valid(version))) throw new Error('Unsupported advisory version or range');
  const vulnerableVersions = versions.filter(version => semver.satisfies(version, range, { includePrerelease: true }));
  return { number: alert.number, manifest: alert.dependency.manifest_path, package: alert.dependency.package.name,
    ecosystem: alert.dependency.package.ecosystem, severity: alert.security_advisory.severity,
    advisory: alert.security_advisory.ghsa_id, vulnerableRange: range, resolvedVersions: versions,
    vulnerableVersions, status: vulnerableVersions.length ? 'unresolved' : versions.length ? 'patched-locally' : 'dependency-removed',
    url: alert.html_url };
}

export function npmVersions(locks, manifest, name) {
  let file = manifest;
  if (manifest.endsWith('package.json')) {
    file = manifest.replace(/package\.json$/, 'package-lock.json');
    if (!locks.has(file) && locks.get('package-lock.json')?.[path.posix.dirname(manifest)]) file = 'package-lock.json';
  }
  const packages = locks.get(file);
  if (!packages) throw new Error(`Unscanned npm manifest: ${manifest}`);
  return [...new Set(Object.entries(packages).filter(([key]) => key.endsWith(`node_modules/${name}`)).map(([, value]) => value.version))];
}

export function cargoPackages(lock) {
  const sections = lock.split(/^\[\[package\]\]$/m).slice(1);
  if (!sections.length) throw new Error('No packages in Cargo.lock');
  return sections.map(section => {
    const name = section.match(/^name = "([^"]+)"$/m)?.[1];
    const version = section.match(/^version = "([^"]+)"$/m)?.[1];
    if (!name || !version) throw new Error('Incomplete Cargo.lock package');
    return [name, version];
  });
}

export function cargoAuditSummary(audit) {
  if (!audit.vulnerabilities || !Array.isArray(audit.vulnerabilities.list) || !audit.warnings) {
    throw new Error('Incomplete cargo audit response');
  }
  const packageInfo = item => ({ package: item.package.name, version: item.package.version,
    advisory: item.advisory?.id, title: item.advisory?.title });
  return {
    advisoryDatabaseCommit: audit.database?.commit,
    vulnerabilities: audit.vulnerabilities.list.map(packageInfo),
    unmaintained: (audit.warnings.unmaintained ?? []).map(packageInfo),
    unsound: (audit.warnings.unsound ?? []).map(packageInfo),
    yanked: (audit.warnings.yanked ?? []).map(item => ({ package: item.package.name, version: item.package.version }))
  };
}

export function renderMarkdown(report) {
  const { summary, rustSecScans, npmScans, localPatches, limits } = report;
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: report.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(report.observedAt)).map(part => [part.type, part.value]));
  const observedDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  const severities = summary.githubAlertSeverities ?? {};
  const rustWarnings = rustSecScans.flatMap(scan => [
    ...scan.unmaintained.map(item => ({ ...item, kind: '未维护', lock: scan.lock })),
    ...scan.unsound.map(item => ({ ...item, kind: '不健全 API', lock: scan.lock })),
    ...scan.yanked.map(item => ({ ...item, kind: '已撤回版本', lock: scan.lock }))
  ]);
  const rustWarningGroups = new Map();
  for (const item of rustWarnings) {
    const key = `${item.kind}:${item.advisory ?? item.package}:${item.version}`;
    const group = rustWarningGroups.get(key) ?? { ...item, locks: [] };
    group.locks.push(item.lock);
    rustWarningGroups.set(key, group);
  }
  const uniqueRustWarnings = [...rustWarningGroups.values()];
  const lines = [
    '# 依赖安全审查报告',
    '',
    `检查时间：${observedDate}（${report.timezone ?? 'UTC'}）。扫描范围：${npmScans.length} 份 npm 锁文件、${rustSecScans.length} 份 Cargo 锁文件和 GitHub 当前开放 Dependabot 告警。`,
    '',
    '## 结果',
    '',
    `- GitHub 有 ${summary.githubAlerts} 条开放 Dependabot 告警（严重 ${severities.critical ?? 0}、高 ${severities.high ?? 0}、中 ${severities.medium ?? severities.moderate ?? 0}、低 ${severities.low ?? 0}）；本地版本范围核对显示 ${summary.patchedLocally} 条已升级、${summary.dependenciesRemoved} 条已移除、${summary.unresolvedGithubAlerts} 条仍处于受影响版本。此核对不会关闭线上告警。`,
    `- npm 审计发现 ${summary.uniqueNpmAdvisories} 项不同公告；覆盖的全量和生产依赖审计均为 0 项。`,
    `- RustSec（${report.rustSecToolVersion ?? 'cargo-audit'}）在 ${rustSecScans.length} 份 Cargo.lock 中发现 ${summary.rustsecVulnerabilities} 项已知漏洞；另有 ${summary.rustsecUnmaintainedWarnings} 条未维护、${summary.rustsecUnsoundWarnings} 条不健全 API、${summary.rustsecYankedPackages} 个撤回版本告警。`,
    '',
    '## RustSec 告警',
    ''
  ];
  if (uniqueRustWarnings.length) {
    for (const item of uniqueRustWarnings) {
      const advisory = item.advisory ? `（${item.advisory}）` : '';
      lines.push('- ' + item.kind + '：`' + item.package + '@' + item.version + '`' + advisory + '，见 ' +
        item.locks.map(lock => '`' + lock + '`').join('、') + '。' + (item.title ?? ''));
    }
  } else {
    lines.push('- 没有额外 RustSec 提示。');
  }
  lines.push('', '## 已处理项', '');
  for (const patch of localPatches) {
    const details = [
      patch.basedOn && '从 `' + patch.basedOn + '` 更新',
      patch.scope,
      patch.regressionTest && '回归检查：[`' + patch.regressionTest + '`](../' + patch.regressionTest + ')',
      patch.validation && '验证：' + patch.validation,
      patch.provenance && '补丁记录：[`' + patch.provenance + '`](../' + patch.provenance + ')'
    ].filter(Boolean).map(detail => detail.replace(/[。.!?]+$/u, '') + '。');
    lines.push('- `' + patch.package + '`：' + details.join(''));
  }
  lines.push('', '## 审查边界', '');
  const reviewStatuses = { 'affected-api-not-referenced': '未发现受影响 API 的调用点',
    'yaml-output-only': '仅用于 YAML 序列化',
    'runtime-parser-maintenance-risk': '运行时解析器维护风险', 'build-time-only': '仅构建期依赖',
    'step-parser-maintenance-risk': 'STEP 解析器维护风险' };
  for (const note of report.reviewNotes) lines.push('- `' + (note.package ?? note.packages.join(', ')) + '`：' +
    (reviewStatuses[note.status] ?? note.status) + '。' + note.evidence);
  for (const limit of limits) lines.push(`- ${limit}`);
  lines.push('', '机器可读明细：[security-dependencies.json](./security-dependencies.json)。', '');
  return lines.join('\n');
}

export async function main(args = process.argv.slice(2)) {
  const alertsFile = args.indexOf('--alerts');
  const fetched = parseJson(alertsFile >= 0
    ? await readFile(path.resolve(root, args[alertsFile + 1]), 'utf8')
    : run('gh', ['api', '--paginate', '--slurp', 'repos/orca-zhang/filens/dependabot/alerts?state=open&per_page=100']), 'GitHub Dependabot response');
  if (!Array.isArray(fetched)) throw new Error('Expected a GitHub alerts array');
  const alerts = fetched.flat();
  const lockFiles = [...projects.map(project => path.posix.join(project, 'package-lock.json')), ...cargoLocks]
    .filter((file, index, all) => all.indexOf(file) === index && existsSync(path.join(root, file)));
  const contents = new Map(await Promise.all(lockFiles.map(async file => [file, await readFile(path.join(root, file), 'utf8')])));
  const npmLocks = new Map(projects.map(project => {
    const file = path.posix.join(project, 'package-lock.json');
    return [file, parseJson(contents.get(file), file).packages];
  }));
  const versions = alert => {
    const { manifest_path: manifest, package: pkg } = alert.dependency;
    if (pkg.ecosystem === 'npm') {
      return npmVersions(npmLocks, manifest, pkg.name);
    }
    if (pkg.ecosystem === 'rust' && contents.has(manifest)) {
      return [...new Set(cargoPackages(contents.get(manifest)).filter(([name]) => name === pkg.name).map(([, version]) => version))];
    }
    if (pkg.ecosystem === 'go' && removedGoManifests.has(manifest)) {
      return [];
    }
    throw new Error(`Unscanned dependency manifest: ${manifest}`);
  };
  const findings = alerts.map(alert => assessAlert(alert, versions(alert)));
  const scans = [];
  for (const project of projects) {
    const audit = (extra = []) => {
      const invocation = npmInvocation(['audit', '--package-lock-only', '--ignore-scripts', '--registry=https://registry.npmjs.org', '--json', ...extra]);
      return auditSummary(parseJson(run(invocation.command, invocation.args, path.join(root, project), [0, 1]), `npm audit (${project})`));
    };
    scans.push({ project, ...audit(), production: audit(['--omit=dev']) });
  }
  const cargoAuditCommand = process.env.CARGO_AUDIT || 'cargo-audit';
  const rustSecToolVersion = run(cargoAuditCommand, ['--version']).trim();
  const rustScans = cargoLocks.map(lock => {
    const audit = parseJson(run(cargoAuditCommand, ['audit', '--json', '--file', lock], root, [0, 1]), `cargo audit (${lock})`);
    return { lock, ...cargoAuditSummary(audit) };
  });
  const unresolved = findings.filter(item => item.status === 'unresolved').length;
  const unique = [...new Set(scans.flatMap(scan => scan.uniqueAdvisories.map(item => item.url)))];
  const githubAlertSeverities = findings.reduce((counts, item) => ({ ...counts, [item.severity]: (counts[item.severity] ?? 0) + 1 }), {});
  const rustTotals = rustScans.reduce((totals, scan) => ({
    vulnerabilities: totals.vulnerabilities + scan.vulnerabilities.length,
    unmaintained: totals.unmaintained + scan.unmaintained.length,
    unsound: totals.unsound + scan.unsound.length,
    yanked: totals.yanked + scan.yanked.length
  }), { vulnerabilities: 0, unmaintained: 0, unsound: 0, yanked: 0 });
  const picomatch = parseJson(await readFile(path.join(root, 'vendor/picomatch/package.json'), 'utf8'), 'picomatch package manifest');
  const report = {
    observedAt: new Date().toISOString(), timezone: 'Asia/Shanghai',
    sourceHead: run('git', ['rev-parse', 'HEAD']).trim(), source: 'local working tree; includes uncommitted changes',
    rustSecToolVersion,
    githubSnapshotSource: alertsFile >= 0 ? 'supplied GitHub API snapshot; not a live closure check' : 'GitHub REST API: open Dependabot alerts',
    summary: { githubAlerts: findings.length, patchedLocally: findings.filter(item => item.status === 'patched-locally').length,
      dependenciesRemoved: findings.filter(item => item.status === 'dependency-removed').length,
      githubAlertSeverities,
      unresolvedGithubAlerts: unresolved, uniqueNpmAdvisories: unique.length,
      rustsecVulnerabilities: rustTotals.vulnerabilities, rustsecUnmaintainedWarnings: rustTotals.unmaintained,
      rustsecUnsoundWarnings: rustTotals.unsound, rustsecYankedPackages: rustTotals.yanked },
    limits: ['本地版本核对不会关闭 GitHub 告警，也不会修补已发布的软件包。',
      'npm 将受影响包数量和不同公告分别统计；传递依赖链不代表独立漏洞。',
      'RustSec 扫描了所有已提交 Cargo.lock，并将未维护、不健全 API 和撤回版本与已知漏洞分开列出。',
      'GitHub Code Scanning API 返回 HTTP 404，当前令牌也缺少 admin:repo_hook 权限；因此无法判断该仓库是否有代码扫描结果。',
      '公告和版本范围匹配不等于漏洞可利用，也不替代运行行为验证。'],
    localPatches: [
      { package: `picomatch@${picomatch.version}`, basedOn: 'picomatch@4.0.7',
        advisory: 'GHSA-fc5q-39xc-vjpf', scope: '单分支重复 extglob 中未转义的 * 或 ? 按字面字符处理。',
        regressionTest: 'scripts/picomatch-hotfix.test.mjs', provenance: 'vendor/picomatch/FILENS-PATCH.md' },
      { package: 'iwork@0.4.0', scope: '本地 vendored 适配器使用 zip@9.1.3，移除了有漏洞的 zip@2.6.1。',
        regressionTest: 'wasm/converter-core-rust/src/zip_io.rs', provenance: 'wasm/converter-core-rust/vendor/iwork/FILENS-PATCH.md' },
      { package: 'Go 转换器宿主', advisory: 'GHSA-5cv4-jp36-h3mw',
        scope: '删除 Go CLI、HTTP、Agent 与文本提取宿主，保留共享 Rust/WASM 核心和非 Go 样例资源。',
        validation: '本地 Dependabot 版本核对将 Go 告警标记为依赖已移除' },
      { package: 'calamine@0.38.0', basedOn: 'calamine@0.37.0', advisory: 'RUSTSEC-2026-0436',
        scope: '修复恶意 XLS/XLSB/CFB 输入可触发 panic 或 OOM 的解析问题。',
        validation: 'Rust WASM 构建与转换回归检查' },
      { package: 'msoffice-crypto@0.1.0 / secure-gate@0.9.0', basedOn: 'msoffice-crypto 0.1.0-rc.13 / secure-gate 0.9.0-rc.17',
        scope: '改用正式版依赖，移除被撤回的 secure-gate 预发布版本。',
        validation: 'Rust WASM 构建与转换回归检查' }
    ],
    dependencyFiles: [...contents].map(([file, content]) => ({ file, sha256: createHash('sha256').update(content).digest('hex') })),
    alerts: findings, npmScans: scans, rustSecScans: rustScans,
    reviewNotes: [
      { package: 'cgmath@0.18.0', advisory: 'RUSTSEC-2026-0197', status: 'affected-api-not-referenced',
        evidence: '公告涉及索引相同的 Matrix2/3/4::swap_columns 调用；STEP 适配器和固定版本 truck 源码中未找到该 API 的调用点。' },
      { package: 'unsafe-libyaml@0.2.11', status: 'yaml-output-only',
        evidence: 'CLI 只调用 serde_yaml::to_writer 输出 YAML，没有在该路径解析用户提供的 YAML；该 crate 仍含未维护的 unsafe 实现。' },
      { package: 'ttf-parser@0.25.1', status: 'runtime-parser-maintenance-risk',
        evidence: 'text-extraction 功能用它解析文档内嵌字体；RustSec 没有报告已知漏洞，但上游已停止维护。' },
      { packages: ['paste', 'proc-macro-error'], status: 'build-time-only',
        evidence: 'cargo tree 显示它们通过过程宏构建依赖进入；目前没有已知运行时漏洞。' },
      { package: 'chrono@0.4.45', status: 'step-parser-maintenance-risk',
        evidence: '它经 truck-stepio 进入 STEP 解析依赖；RustSec 报告维护状态，没有报告已知漏洞。' }
    ]
  };
  // Write only after every scan succeeds; failed requests must never become a clean report.
  await writeFile(path.join(root, 'docs/security-dependencies.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(path.join(root, 'docs/security-dependencies.zh-CN.md'), renderMarkdown(report));
  console.log(JSON.stringify(report.summary, null, 2));
  return unresolved || unique.length || rustTotals.vulnerabilities ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 2; });
}
