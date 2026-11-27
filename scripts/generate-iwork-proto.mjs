import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import protobuf from 'protobufjs/light.js';

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

const descriptor = JSON.parse(readFileSync(outputJsonFile, 'utf8'));
const schema = protobuf.Root.fromJSON(descriptor);
const included = new Set();

function include(node) {
  if (!node || included.has(node.fullName)) return;
  included.add(node.fullName);
  include(node.parent);
  if (node instanceof protobuf.Type) {
    for (const field of node.fieldsArray) {
      include(field.resolve().resolvedType);
      include(field.declaringField);
    }
  }
}

include(schema.lookupType('TSP.ArchiveInfo'));
for (const mapping of [commonTypeMap, keynoteTypeMap, numbersTypeMap, pagesTypeMap]) {
  for (const name of Object.values(mapping)) include(schema.lookup(name));
}

// Keep the full descriptor JSON for tooling. Preview only needs registered
// archives, their field dependencies and the namespaces that resolve names.
function previewDescriptor(node, path = '') {
  if (!node.nested) return node;
  const entries = Object.entries(node.nested).flatMap(([name, child]) => {
    const childPath = `${path}.${name}`;
    return included.has(childPath) ? [[name, previewDescriptor(child, childPath)]] : [];
  });
  return { ...node, nested: Object.fromEntries(entries) };
}
writeFileSync(outputTsFile, `import type { INamespace } from 'protobufjs/light.js';\nconst descriptor = ${JSON.stringify(previewDescriptor(descriptor))} as INamespace;\nexport default descriptor;\n`);

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
