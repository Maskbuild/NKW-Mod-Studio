/** Generates the fixture for one target without building: npx tsx scripts/gen-dry.ts fabric 1.21.1 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import type { Loader } from '../src/core/project'
import { writeFixture } from './fixture'

const [loader, mc] = [process.argv[2] as Loader, process.argv[3]]
const root = resolve('.verify')
const projectDir = join(root, 'fixture')
mkdirSync(projectDir, { recursive: true })
const project = writeFixture(projectDir)
const { ir, diagnostics } = compile(project, { loader, mc })
for (const d of diagnostics) console.log(d.severity, d.nodeId ?? '', d.message.en)
const deps = {

  ...TOOL_VERSIONS,
  ...FALLBACK_DEPS[mc],
  farmersDelight: 'maven.modrinth:farmers-delight:x',
  geckolib: 'maven.modrinth:geckolib:x'
}
const files = generate(ir, { loader, mc }, deps, { readText: (a) => readFileSync(join(projectDir, 'assets', a), 'utf8') })
const out = join(root, 'dry', `${loader}-${mc}`)
rmSync(out, { recursive: true, force: true })
for (const f of files) {
  const p = join(out, f.path)
  mkdirSync(dirname(p), { recursive: true })
  if (f.copy) copyFileSync(join(projectDir, 'assets', f.copy), p)
  else writeFileSync(p, f.text ?? Buffer.from(f.base64 ?? '', 'base64'))
}
console.log(`${files.length} files → ${out}`)
