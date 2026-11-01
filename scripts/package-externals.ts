import { readFileSync } from 'node:fs';

/** Let application bundlers share dependencies across format packages.
 * Asset/worker queries stay bundled so published packages carry their files. */
export function packageExternals(configUrl: string): (id: string) => boolean {
  const metadata = JSON.parse(readFileSync(new URL('./package.json', configUrl), 'utf8'));
  const dependencies = Object.keys({ ...metadata.dependencies, ...metadata.peerDependencies });
  return id => !id.includes('?') && dependencies.some(name => id === name || id.startsWith(`${name}/`));
}
