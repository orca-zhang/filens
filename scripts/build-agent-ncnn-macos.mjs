// Release-builder utility. Installed npm packages contain this companion and
// never need CMake, a compiler, Homebrew, or a Python interpreter.
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, copyFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertReleaseDirectory } from './agent-release-privacy.mjs';

const commit = 'd0d50631179e380e587fb188338f5683d2c93275';
const sha256 = '8dd8f7458865b54f8a2dda49dd3247ed75b6216f6b0c1158bec82bfc37393482';

export async function buildMacNCNN(destination, { signal } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The macOS companion must be built on macOS arm64');
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ncnn-build-'));
  try {
    console.error('Building the portable macOS NCNN companion (CMake and Xcode command-line tools required for source builds).');
    const response = await fetch(`https://codeload.github.com/Tencent/ncnn/tar.gz/${commit}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`NCNN source HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('NCNN source SHA-256 mismatch');
    await writeFile(path.join(work, 'source.tar.gz'), bytes);
    await run('tar', ['-xzf', path.join(work, 'source.tar.gz'), '-C', work], signal);
    const source = path.join(work, `ncnn-${commit}`);
    const build = path.join(work, 'build');
    const cmake = { CMAKE_BUILD_TYPE:'Release', CMAKE_OSX_DEPLOYMENT_TARGET:'12.0', NCNN_VERSION:'20260430', NCNN_SHARED_LIB:'ON', NCNN_OPENMP:'ON', NCNN_SIMPLEOMP:'ON', NCNN_VULKAN:'OFF', NCNN_BUILD_TOOLS:'OFF', NCNN_BUILD_EXAMPLES:'OFF', NCNN_BUILD_BENCHMARK:'OFF', NCNN_BUILD_TESTS:'OFF' };
    await run('cmake', ['-S', source, '-B', build, ...Object.entries(cmake).map(([k,v]) => `-D${k}=${v}`)], signal);
    await run('cmake', ['--build', build, '--parallel', '4'], signal);
    await mkdir(destination, { recursive: true });
    const library = path.join(destination, 'libncnn.dylib');
    await copyFile(path.join(build, 'src/libncnn.dylib'), library);
    await run('install_name_tool', ['-id', '@rpath/libncnn.dylib', library], signal);
    await run('strip', ['-x', library], signal);
    await run('codesign', ['--force', '--sign', '-', library], signal);
    await copyFile(path.join(source, 'LICENSE.txt'), path.join(destination, 'NCNN-LICENSE.txt'));
    const hash = createHash('sha256').update(await readFile(library)).digest('hex');
    await writeFile(path.join(destination, 'native-build.json'), JSON.stringify({ commit, sourceSHA256:sha256, cmake, sha256:hash }, null, 2) + '\n');
  } finally { await rm(work, { recursive:true, force:true }); }
}

function run(command, args, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio:'inherit', signal });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function stageZigToolchain(root) {
  const configured = process.env.FILENS_ZIG ?? 'zig';
  const hasPath = path.isAbsolute(configured) || configured.includes('/') || configured.includes('\\');
  const names = process.platform === 'win32' && !configured.toLowerCase().endsWith('.exe') ? [configured, `${configured}.exe`] : [configured];
  const candidates = hasPath ? [configured] : (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap(directory => names.map(name => path.join(directory, name)));
  let binary;
  for (const candidate of candidates) {
    try { await access(candidate); binary = await realpath(candidate); break; } catch { /* Try the next PATH entry. */ }
  }
  if (!binary) return { command:configured, cleanup:async () => {} };

  // Zig embeds its libc-header paths in C objects. Build from a staged copy
  // outside RUNNER_TEMP so release artifacts do not expose the runner home.
  const stagingRoot = await mkdtemp(path.join(process.platform === 'win32' ? root : os.tmpdir(), 'filens-zig-'));
  const install = path.join(stagingRoot, path.basename(path.dirname(binary)));
  try {
    await cp(path.dirname(binary), install, { recursive:true });
    return { command:path.join(install, path.basename(binary)), cleanup:() => rm(stagingRoot, { recursive:true, force:true }) };
  } catch (error) {
    await rm(stagingRoot, { recursive:true, force:true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMacNCNN(path.resolve('dist/native'));
}

// Rebuild the published wrapper snapshot with the same minimum macOS as the
// CLI. The upstream prebuilt library currently targets the publisher's macOS 26.
export async function buildMacWrapper(destination, { signal, sourceCount = 3 } = {}) {
  return buildOCRWrapper(destination, { signal, sourceCount, platform: 'darwin-arm64' });
}

// Rebuild every wrapper from the same hash-pinned snapshot. Upstream Linux
// prebuilts contain personal source paths; -trimpath keeps them out of releases.
export async function buildOCRWrapper(destination, { signal, sourceCount = 3, platform = `${process.platform}-${process.arch}` } = {}) {
  destination = path.resolve(destination);
  if (!['darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64'].includes(platform)) throw new Error('Unsupported OCR wrapper target');
  if (platform === 'darwin-arm64' && (process.platform !== 'darwin' || process.arch !== 'arm64')) throw new Error('The macOS wrapper must be built on macOS arm64');
  const { downloadArtifact } = await import('./model-download.mjs');
  const { modelSources } = await import('./download-agent-models.mjs');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'converter/rapidocr/runtime.json'), 'utf8'));
  const artifact = manifest.wrapperSource;
  const darwin = platform === 'darwin-arm64';
  const windows = platform === 'win32-x64';
  const windowsLoader = windows ? await readFile(path.join(root,'packaging/ncnn-windows/native_loader_windows.go')) : null;
  const loaderSHA256 = windowsLoader ? createHash('sha256').update(windowsLoader).digest('hex') : undefined;
  const memoryInput = await readFile(path.join(root, 'packaging/ncnn-memory/filens_memory_input.go'));
  const memoryInputSHA256 = createHash('sha256').update(memoryInput).digest('hex');
  const library = path.join(destination, windows ? 'zima_ncnn_runtime_v7.dll' : darwin ? 'libzima_ncnn_runtime_v7.dylib' : 'libzima_ncnn_runtime_v7.so');
  const architecture = platform.endsWith('-x64') ? 'amd64' : 'arm64';
  try {
    const prior = JSON.parse(await readFile(path.join(destination, 'wrapper-build.json'), 'utf8'));
    if (prior.sourceSHA256 === artifact.sha256 && prior.platform === platform && prior.trimpath === true && prior.loaderSHA256 === loaderSHA256 && prior.memoryInputSHA256 === memoryInputSHA256
        && createHash('sha256').update(await readFile(library)).digest('hex') === prior.sha256) {
      await assertReleaseDirectory(destination);
      return;
    }
  } catch { /* Rebuild an absent or altered wrapper. */ }
  const work = await mkdtemp(path.join(os.tmpdir(), 'filens-ocr-wrapper-'));
  try {
    const archive = path.join(work, 'source.tar.gz');
    await downloadArtifact({ ...artifact, path:archive, sources:modelSources(artifact, sourceCount, manifest) }, { signal });
    await run('tar', ['-xzf', archive, '-C', work], signal);
    const ocrSource = path.join(work, 'tools/ncnn_runtime_wrapper/native_ocr_runtime.go');
    let ocrText = await readFile(ocrSource, 'utf8');
    for (const [before, after] of [
      ['source, err := imaging.Open(config.imagePath, imaging.AutoOrientation(true))', 'source, err := filensOCRImage(parsed, config.imagePath)'],
      ['if imagePath == "" {', 'if imagePath == "" && metadataStringValue(parsed.Input["image_base64"]) == "" {'],
    ]) {
      if (ocrText.split(before).length !== 2) throw new Error('Pinned OCR memory input patch no longer matches');
      ocrText = ocrText.replace(before, after);
    }
    await writeFile(ocrSource, ocrText);
    await writeFile(path.join(work, 'tools/ncnn_runtime_wrapper/filens_memory_input.go'), memoryInput);
    if (windows) {
      const source = path.join(work,'tools/ncnn_runtime_wrapper/native_embedding_runtime.go');
      const text = await readFile(source,'utf8');
      const calls = /purego\.Dlopen\((candidate), purego\.RTLD_NOW\|purego\.RTLD_GLOBAL\)/g;
      if ([...text.matchAll(calls)].length !== 2) throw new Error('Pinned OCR wrapper loader patch no longer matches');
      const registration = 'purego.RegisterLibFunc(target, handle, symbol)';
      if (text.split(registration).length !== 2) throw new Error('Pinned OCR symbol patch no longer matches');
      await writeFile(source,text.replace(calls,'nativeDlopen($1)').replace(registration,'registerWindowsNativeSymbol(target, handle, symbol)').replace('\n\t"github.com/ebitengine/purego"',''));
      await writeFile(path.join(work,'tools/ncnn_runtime_wrapper/native_loader_windows.go'),windowsLoader);
    }
    // Go's -trimpath does not rewrite paths embedded by the C compiler.
    const pathMappings = [[root, '/filens-source'], [work, '/ocr-wrapper-source'], [os.homedir(), '/toolchain-cache'],
      ['/home', '/build-home'], ['/Users', '/build-home'], ['C:/Users', '/build-home']];
    // Apply the mappings to macros and debug records too; compiler/toolchain
    // versions do not all treat -ffile-prefix-map identically.
    const cgoPathFlags = pathMappings.flatMap(([from, to]) => {
      from = from.replaceAll('\\', '/');
      return [`-ffile-prefix-map=${from}=${to}`, `-fdebug-prefix-map=${from}=${to}`, `-fmacro-prefix-map=${from}=${to}`];
    }).join(' ');
    const cgoCflags = [process.env.CGO_CFLAGS, cgoPathFlags, '-g0', '-fno-sanitize=all', darwin && '-mmacosx-version-min=12.0'].filter(Boolean).join(' ');
    const stripDebug = darwin ? '-Wl,-S' : '-Wl,--strip-debug';
    const sanitizerRuntime = !darwin && !windows ? '-fsanitize=undefined' : '';
    const externalFlags = [sanitizerRuntime, stripDebug].filter(Boolean).join(' ');
    const ldflags = `-s -w -X main.ncnnRuntimeVersion=${manifest.version} -extldflags "${externalFlags}"`;
    const stagedZig = darwin ? null : await stageZigToolchain(root);
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('go', ['build','-trimpath','-buildmode=c-shared','-ldflags',ldflags,'-o',library,'./tools/ncnn_runtime_wrapper'], {
          cwd:work, stdio:'inherit', signal,
          env:{...process.env,CGO_ENABLED:'1',GOOS:windows?'windows':darwin?'darwin':'linux',GOARCH:architecture,CGO_CFLAGS:cgoCflags,
            ...(darwin ? {MACOSX_DEPLOYMENT_TARGET:'12.0',CGO_LDFLAGS:'-mmacosx-version-min=12.0'}
              : {CC:`${stagedZig.command} cc -target ${windows ? 'x86_64-windows-gnu' : `${architecture === 'amd64' ? 'x86_64' : 'aarch64'}-linux-gnu.2.17`}`})}
        });
        child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Build OCR wrapper exited with ${code}`)));
      });
    } finally { await stagedZig?.cleanup(); }
    if (darwin) await run('codesign',['--force','--sign','-',library],signal);
    await rm(path.join(destination,'libzima_ncnn_runtime_v7.h'),{force:true});
    if (windows) await rm(path.join(destination,'zima_ncnn_runtime_v7.h'),{force:true});
    await writeFile(path.join(destination,'wrapper-build.json'),JSON.stringify({release:manifest.version,sourceSHA256:artifact.sha256,platform,trimpath:true,memoryInputSHA256,
      ...(windows ? {minimumWindows:'10',compiler:'zig cc',loaderSHA256} : darwin ? {minimumMacOS:'12.0'} : {minimumGlibc:'2.17',compiler:'zig cc'}),
      sha256:createHash('sha256').update(await readFile(library)).digest('hex')},null,2)+'\n');
    await assertReleaseDirectory(destination);
  } finally { await rm(work,{recursive:true,force:true}); }
}
