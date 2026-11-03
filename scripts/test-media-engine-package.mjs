// Check declarations as a consumer without workspace peers or the Photos checkout.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'filens-media-package-'));
try {
  const destination = path.join(temporary, 'node_modules/@filens/media');
  mkdirSync(destination, { recursive: true });
  cpSync(path.join(root, 'packages/media/package.json'), path.join(destination, 'package.json'));
  cpSync(path.join(root, 'packages/media/dist'), path.join(destination, 'dist'), { recursive: true });
  writeFileSync(path.join(temporary, 'index.ts'), `
    import { MediaCapabilityDetector, MediaFormatInspector, recoverBrowserVideo,
      type BrowserMediaInput } from '@filens/media/engine';
    const input: BrowserMediaInput = new Blob();
    new MediaCapabilityDetector();
    new MediaFormatInspector();
    void recoverBrowserVideo(input, document.createElement('video'), { allowTranscoding: false });
  `);
  writeFileSync(path.join(temporary, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2020', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    strict: true, noEmit: true, types: [], skipLibCheck: false
  }, include: ['index.ts'] }));
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', path.join(temporary, 'tsconfig.json')], { stdio: 'inherit' });
  await import(path.join(destination, 'dist/engine.js'));
  console.log('Isolated engine JavaScript and declarations passed without workspace peers or mp4box installed');
} finally { rmSync(temporary, { recursive: true, force: true }); }
