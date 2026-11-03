import { execFileSync } from 'node:child_process'
// Snapshot the canonical engine without requiring adjacent repositories at runtime.
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = join(root, 'packages/media/src/engine-snapshot')
const hash = value => createHash('sha256').update(value).digest('hex')
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(directory, entry.name)).map(name => `${entry.name}/${name}`)
    : [entry.name]).sort()
}
if (process.argv.includes('--check')) {
  const lock = JSON.parse(readFileSync(join(destination, 'source-lock.json'), 'utf8'))
  const names = files(destination).filter(name => name !== 'source-lock.json')
  if (JSON.stringify(names) !== JSON.stringify(Object.keys(lock.artifacts).sort()))
    throw new Error('Media Engine artifact list differs from source-lock.json')
  for (const name of names) {
    if (hash(readFileSync(join(destination, name))) !== lock.artifacts[name])
      throw new Error(`Media Engine artifact changed: ${name}; regenerate from canonical source`)
  }
  console.log(`Media Engine snapshot verified (${names.length} files)`)
}
else {
  const source = resolve(process.env.MEDIA_ENGINE_SOURCE || join(root, '../ZimaOS-Photos'))
  if (!existsSync(join(source, 'scripts/build-media-engine.mjs')))
    throw new Error('Set MEDIA_ENGINE_SOURCE to the canonical Photos checkout')
  const temporary = mkdtempSync(join(tmpdir(), 'filens-media-engine-'))
  try {
    execFileSync(process.execPath, ['scripts/build-media-engine.mjs'], {
      cwd: source,
      env: { ...process.env, MEDIA_ENGINE_BUILD_DIR: temporary },
      stdio: 'inherit',
    })
    writeFileSync(join(temporary, 'index.d.ts'), 'export * from \'./types/index\';\n')
    writeFileSync(join(temporary, 'core.d.ts'), 'export * from \'./types/core\';\n')
    // Keep public declarations portable too; the parser itself is already bundled.
    const parserTypes = join(temporary, 'types/mp4box-types')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(parserTypes)
    for (const name of files(join(source, 'node_modules/mp4box/dist')).filter(name => name.endsWith('.d.mts')))
      cpSync(join(source, 'node_modules/mp4box/dist', name), join(parserTypes, name))
    for (const name of files(join(temporary, 'types')).filter(name => name.endsWith('.d.ts'))) {
      const file = join(temporary, 'types', name)
      const prefix = name.includes('/') ? '../' : './'
      writeFileSync(file, readFileSync(file, 'utf8').replace(/(['"])mp4box\1/g, (_match, quote) => `${quote}${prefix}mp4box-types/mp4box.all.mjs${quote}`))
    }
    const inputs = ['scripts/build-media-engine.mjs', 'tsconfig.media-engine.json', 'package-lock.json', 'pnpm-lock.yaml', ...files(join(source, 'src/lib/media-engine')).map(name => `src/lib/media-engine/${name}`)]
      .filter(name => existsSync(join(source, name)))
      .sort()
    const lock = {
      repository: 'ZimaOS-Photos',
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(),
      // A working-tree snapshot is explicit: no commits or resets in either repo.
      inputs: Object.fromEntries(inputs.map(name => [name, hash(readFileSync(join(source, name)))])),
      artifacts: Object.fromEntries(files(temporary).map(name => [name, hash(readFileSync(join(temporary, name)))])),
    }
    rmSync(destination, { recursive: true, force: true })
    cpSync(temporary, destination, { recursive: true })
    writeFileSync(join(destination, 'source-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
    console.log('Updated shared Media Engine snapshot')
  }
  finally { rmSync(temporary, { recursive: true, force: true }) }
}
