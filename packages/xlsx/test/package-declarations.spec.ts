// @vitest-environment node
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageDeclarations } from '../../../scripts/package-declarations';

describe('published ESM declarations', () => {
  let root: string;
  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'filens-declarations-')));
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'filens-declarations-test', type: 'module' }));
    await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', declaration: true, skipLibCheck: true,
        typeRoots: [path.resolve(__dirname, '../../../node_modules/@types')] },
      include: ['src']
    }));
    const sources = {
      'types.ts': 'export interface Value { name: string }',
      'orphan.d.ts': "export type { Missing } from './not-emitted';",
      'nested/index.ts': `export type { Value } from '../types';
        export type { Value as ParentValue } from '..';
        export type { ParentValue as SelfValue } from '.';`,
      'Widget.vue.d.ts': 'export interface Widget { value: string }',
      'collision.ts': 'export interface FileValue { file: true }',
      'collision/index.ts': 'export interface FolderValue { folder: true }',
      'schema.v1.ts': 'export interface Versioned { revision: 1 }',
      '类型.ts': 'export interface UnicodeValue { label: string }',
      'esm.mts': 'export interface EsmValue { esm: true }',
      'commonjs.cts': 'export interface CjsValue { cjs: true }',
      'namespace.ts': 'export const value = 1;',
      'type-barrel.ts': 'export interface BarrelValue { barrel: true }',
      'styles.css': 'body { color: black }',
      'index.ts': `
      import './styles.css';
      import type { Value } from './types';
      export type ImportedValue = Value;
      export type { Value } from './types';
      export type { Value as NestedValue } from './nested';
      export type { Value as TrailingSlashValue } from './nested/';
      export type { Value as ExplicitValue } from './types.js';
      export type { Value as ExplicitIndexValue } from './nested/index.js';
      export type { Widget } from './Widget.vue';
      export type { FileValue } from './collision';
      export type { FolderValue } from './collision/';
      export type { Versioned } from './schema.v1';
      export type { UnicodeValue } from './类型';
      export type { EsmValue } from './esm.mjs';
      export type { CjsValue } from './commonjs.cjs';
      export type { Stats } from 'node:fs';
      export * from './namespace';
      export * as Namespace from './namespace';
      export type * as TypeNamespace from './type-barrel';
      export type * from './type-barrel';
      export type DynamicValue = import('./types').Value;
      export type EscapedValue = import('./\\u7c7b\\u578b').UnicodeValue;
      export type Pair = [import('./types').Value, import('./nested').Value];
      export type ValueType = typeof import('./namespace').value;
      /** The text import('./types') must remain unchanged. */
      export type Literal = './types';
      export type TemplateLiteral = \`./types\`;
      export const marker = 1;
    `
    };
    for (const [file, source] of Object.entries(sources)) {
      const target = path.join(root, 'src', file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    await build({
      root, configFile: false, logLevel: 'silent',
      plugins: [packageDeclarations({
        tsconfigPath: path.join(root, 'tsconfig.json'), include: ['src/**/*.{ts,mts,cts}'], entryRoot: 'src',
        copyDtsFiles: true, clearPureImport: false
      })],
      build: { lib: { entry: path.join(root, 'src/index.ts'), formats: ['es'], fileName: () => 'index.js' } }
    });
  });

  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it.each([
    ['type imports', 'index', "import { Value } from './types.js'"],
    ['named re-exports', 'index', "export type { Value } from './types.js'"],
    ['directory indexes', 'index', "NestedValue } from './nested/index.js'"],
    ['trailing slashes', 'index', "TrailingSlashValue } from './nested/index.js'"],
    ['explicit .js paths', 'index', "ExplicitValue } from './types.js'"],
    ['explicit index paths', 'index', "ExplicitIndexValue } from './nested/index.js'"],
    ['Vue declarations', 'index', "from './Widget.vue.js'"],
    ['files before same-name directories', 'index', "FileValue } from './collision.js'"],
    ['same-name directories with trailing slashes', 'index', "FolderValue } from './collision/index.js'"],
    ['filenames with dots', 'index', "from './schema.v1.js'"],
    ['Unicode filenames', 'index', "from './类型.js'"],
    ['explicit .mjs paths', 'index', "from './esm.mjs'"],
    ['explicit .cjs paths', 'index', "from './commonjs.cjs'"],
    ['bare specifiers', 'index', "from 'node:fs'"],
    ['star re-exports', 'index', "export * from './namespace.js'"],
    ['namespace re-exports', 'index', "export * as Namespace from './namespace.js'"],
    ['type namespace re-exports', 'index', "export type * as TypeNamespace from './type-barrel.js'"],
    ['type star re-exports', 'index', "export type * from './type-barrel.js'"],
    ['dynamic import types', 'index', "import('./types.js').Value"],
    ['multiple imports on one line', 'index', "[import('./types.js').Value, import('./nested/index.js').Value]"],
    ['typeof imports', 'index', "typeof import('./namespace.js').value"],
    ['side-effect asset imports', 'index', "import './styles.css'"],
    ['comments', 'index', "The text import('./types') must remain unchanged."],
    ['string literal types', 'index', "type Literal = './types'"],
    ['template literal types', 'index', 'type TemplateLiteral = `./types`'],
    ['parent file imports', 'nested/index', "from '../types.js'"],
    ['parent directory imports', 'nested/index', "from '../index.js'"],
    ['current directory imports', 'nested/index', "from './index.js'"],
    ['unresolved paths', 'orphan', "from './not-emitted'"],
    ['declarations without imports', 'namespace', 'export declare const value = 1']
  ])('handles %s', async (_name, file, expected) => {
    const declaration = await readFile(path.join(root, `dist/${file}.d.ts`), 'utf8');
    expect(declaration).toContain(expected);
  });

  it('does not append duplicate extensions', async () => {
    const index = await readFile(path.join(root, 'dist/index.d.ts'), 'utf8');
    expect(index).not.toContain('.js.js');
    expect(index).not.toContain('.mjs.js');
    expect(index).not.toContain('.cjs.js');
  });

  it('handles escaped Unicode specifiers using the original literal positions', async () => {
    const index = await readFile(path.join(root, 'dist/index.d.ts'), 'utf8');
    expect(index).toMatch(/EscapedValue = import\(['"]\.\/(?:类型|\\u7c7b\\u578b)\.js['"]\)\.UnicodeValue/);
  });

  it.each([
    ['Bundler', ts.ModuleKind.ESNext, ts.ModuleResolutionKind.Bundler],
    ['Node16', ts.ModuleKind.Node16, ts.ModuleResolutionKind.Node16],
    ['NodeNext', ts.ModuleKind.NodeNext, ts.ModuleResolutionKind.NodeNext]
  ])('type-checks the emitted graph under %s', (_name, module, moduleResolution) => {
    const program = ts.createProgram([path.join(root, 'dist/index.d.ts')], {
      target: ts.ScriptTarget.ES2022, module, moduleResolution, noEmit: true, strict: true, skipLibCheck: false,
      types: ['node'], typeRoots: [path.resolve(__dirname, '../../../node_modules/@types')]
    });
    expect(ts.getPreEmitDiagnostics(program).map(diagnostic =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
  });
});
