import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import dts, { type PluginOptions } from 'vite-plugin-dts';

// Node16/NodeNext require explicit file paths in ESM declarations too.
export function packageDeclarations(options: PluginOptions) {
  return dts({
    ...options,
    async afterBuild(files) {
      for (const [file, content] of files) {
        let updated = content;
        const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest);
        const references: ts.StringLiteral[] = [];
        const visit = (node: ts.Node) => {
          if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            references.push(node.moduleSpecifier);
          } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
            references.push(node.argument.literal);
          } else if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteral(node.expression)) {
            references.push(node.expression);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
        for (const reference of references.reverse()) {
          const specifier = reference.text;
          if (!/^\.{1,2}(?:\/|$)/.test(specifier)) continue;
          const target = path.resolve(path.dirname(file), specifier).replaceAll('\\', '/');
          let suffix = '';
          if (!specifier.endsWith('/') && files.has(`${target}.d.ts`)) suffix = '.js';
          else if (files.has(`${target}/index.d.ts`)) suffix = specifier.endsWith('/') ? 'index.js' : '/index.js';
          if (suffix) updated = updated.slice(0, reference.end - 1) + suffix + updated.slice(reference.end - 1);
        }
        if (updated !== content) {
          await writeFile(file, updated);
          files.set(file, updated);
        }
      }
    }
  });
}
