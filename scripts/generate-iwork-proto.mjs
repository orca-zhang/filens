import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const protoDir = join(rootDir, 'packages', 'iwork', 'vendor', 'iwork-converter', 'proto');
const outputJsonFile = join(rootDir, 'packages', 'iwork', 'src', 'generated', 'iwork-proto.json');
const outputTsFile = join(rootDir, 'packages', 'iwork', 'src', 'generated', 'iwork-proto.ts');
const typeMapsTsFile = join(rootDir, 'packages', 'iwork', 'src', 'generated', 'type-maps.ts');
const pbjsBin = resolve(rootDir, 'node_modules', 'protobufjs-cli', 'bin', 'pbjs');

const protoFiles = readdirSync(protoDir)
  .filter((file) => file.endsWith('.proto'))
  .map((file) => join(protoDir, file));

if (!protoFiles.length) {
  throw new Error(`No .proto files found in ${protoDir}`);
}

mkdirSync(dirname(outputJsonFile), { recursive: true });

execFileSync(process.execPath, [pbjsBin, '-t', 'json', '-p', protoDir, '-o', outputJsonFile, ...protoFiles], {
  cwd: rootDir,
  stdio: 'inherit'
});

if (!statSync(outputJsonFile).size) {
  throw new Error(`Failed to generate protobuf descriptor at ${outputJsonFile}`);
}

const descriptor = JSON.parse(readFileSync(outputJsonFile, 'utf8'));
// Keep generated declarations small; consumers need the schema interface,
// rather than a literal TypeScript type for every protobuf field.
writeFileSync(outputTsFile, `import type { INamespace } from 'protobufjs/light.js';\nconst descriptor = ${JSON.stringify(descriptor)} as INamespace;\nexport default descriptor;\n`);

const commonTypeMap = JSON.parse(
  readFileSync(join(rootDir, 'packages', 'iwork', 'vendor', 'iwork-converter', 'codegen', 'Common.json'), 'utf8')
);
const keynoteTypeMap = JSON.parse(
  readFileSync(join(rootDir, 'packages', 'iwork', 'vendor', 'iwork-converter', 'codegen', 'Keynote.json'), 'utf8')
);
const numbersTypeMap = JSON.parse(
  readFileSync(join(rootDir, 'packages', 'iwork', 'vendor', 'iwork-converter', 'codegen', 'Numbers.json'), 'utf8')
);
const pagesTypeMap = JSON.parse(
  readFileSync(join(rootDir, 'packages', 'iwork', 'vendor', 'iwork-converter', 'codegen', 'Pages.json'), 'utf8')
);

writeFileSync(
  typeMapsTsFile,
  [
    `export const commonTypeMap: Record<string, string> = ${JSON.stringify(commonTypeMap)};`,
    `export const keynoteTypeMap: Record<string, string> = ${JSON.stringify(keynoteTypeMap)};`,
    `export const numbersTypeMap: Record<string, string> = ${JSON.stringify(numbersTypeMap)};`,
    `export const pagesTypeMap: Record<string, string> = ${JSON.stringify(pagesTypeMap)};`,
    ''
  ].join('\n')
);
