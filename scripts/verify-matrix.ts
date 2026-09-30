/**
 * Generates the fixture project for every supported loader × version and runs a Gradle task on it.
 *   npx tsx scripts/verify-matrix.ts [task] [filter...]
 *   e.g. npx tsx scripts/verify-matrix.ts compileJava fabric-1.21.1 forge-1.20.1
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PROFILES } from '../src/core/gen/profiles'
import { startBuild } from '../src/main/services/builder'
import { writeFixture } from './fixture'

const task = (process.argv[2] ?? 'compileJava') as 'compileJava'
const filters = process.argv.slice(3)
const root = resolve(process.env.NKW_VERIFY_DIR ?? '.verify')
const toolsDir = resolve(process.env.NKW_TOOLS_DIR ?? join(root, 'tools'))
const projectDir = join(root, 'fixture')
mkdirSync(projectDir, { recursive: true })
const project = writeFixture(projectDir)

const targets = PROFILES.flatMap((p) => p.loaders.map((loader) => ({ loader, mc: p.mc }))).filter(
  (t) => !filters.length || filters.some((f) => `${t.loader}-${t.mc}`.includes(f))
)

const results: { target: string; ok: boolean; secs: number; tail: string[] }[] = []
async function main() {
for (const target of targets) {
  const name = `${target.loader}-${target.mc}`
  const t0 = Date.now()
  const lines: string[] = []
  process.stdout.write(`▶ ${name} … `)
  try {
    const run = await startBuild({
      projectDir,
      project: { ...project, targets: [target] },
      target,
      toolsDir,
      allowDownload: true,
      task,
      log: (l) => {
        lines.push(l)
        if (process.env.VERBOSE) console.log(l)
      },
      progress: () => {}
    })
    const code = await run.done
    const ok = code === 0
    results.push({ target: name, ok, secs: (Date.now() - t0) / 1000, tail: ok ? [] : lines.filter((l) => /error|FAILED|What went wrong|\.java:\d+/i.test(l)).slice(0, 40) })
    console.log(ok ? `OK (${((Date.now() - t0) / 1000).toFixed(0)}s)` : `FAILED (exit ${code})`)
  } catch (e) {
    results.push({ target: name, ok: false, secs: 0, tail: [(e as Error).stack ?? String(e)] })
    console.log('ERROR', (e as Error).message)
  }
}
console.log('\n──────── summary ────────')
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✘'} ${r.target}`)
  for (const l of r.tail) console.log('    ' + l)
}
process.exit(results.every((r) => r.ok) ? 0 : 1)
}
void main()
