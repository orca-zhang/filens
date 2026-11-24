import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

// Serve the distributable skill from its source so the console and CLI cannot drift.
export function agentSkillAsset(): Plugin {
  const files = ['SKILL.md', 'references/reading.md', 'references/search.md', 'references/operations.md'];
  const assets = files.map(file => ({
    source: fileURLToPath(new URL(`../../skills/filens/${file}`, import.meta.url)),
    output: `skills/filens/${file}`
  }));
  let base = '/';
  return {
    name: 'filens-agent-skill',
    configResolved(config) {
      base = config.base;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = (request.url ?? '').split('?', 1)[0];
        const asset = assets.find(({ output }) => pathname === `${base}${output}` || pathname === `/${output}`);
        if (!asset) return next();
        try {
          response.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          response.setHeader('Cache-Control', 'no-cache');
          response.end(await readFile(asset.source));
        } catch (error) {
          next(error);
        }
      });
    },
    async generateBundle() {
      for (const { source, output } of assets) {
        this.addWatchFile(source);
        this.emitFile({ type: 'asset', fileName: output, source: await readFile(source) });
      }
    }
  };
}
