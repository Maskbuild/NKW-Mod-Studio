/**
 * Runtime smoke test: launches the Minecraft client for each target, waits until the title screen
 * has loaded (or a crash), checks our registration log line, then closes the game.
 *   npx tsx scripts/smoke-client.ts fabric-1.21.1 neoforge-1.21.1
 */
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { startBuild } from '../src/main/services/builder'
import type { Loader } from '../src/core/project'
import { writeFixture } from './fixture'
import { scriptAppliesTo } from '../src/core/scriptApi'

const root = resolve(process.env.NKW_VERIFY_DIR ?? '.verify')
const toolsDir = resolve(process.env.NKW_TOOLS_DIR ?? join(root, 'tools'))
const projectDir = join(root, 'fixture')
mkdirSync(projectDir, { recursive: true })
const project = writeFixture(projectDir)

const READY = /Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/
const BAD =
  /---- Minecraft Crash Report|Crashed! The full crash report|Exception in thread "main"|Failed to load|Missing texture|Unable to load model|Registry freeze|\[main\/ERROR\].*nkwtest|ModLoadingException|Exception loading blockstate|Couldn't parse|Unable to parse animation|GeckoLibException|Error loading animation file/i

async function smoke(name: string): Promise<boolean> {
  const [loader, mc] = name.split('-') as [Loader, string]
  const target = { loader, mc }
  const problems: string[] = []
  let registered = false
  let ready = false
  let scripts = !project.graph.nodes.some((n) => n.type === 'script' && scriptAppliesTo((n.data.targets as string[]) ?? [], target))
  const run = await startBuild({
    projectDir,
    project: { ...project, targets: [target] },
    target,
    toolsDir,
    allowDownload: true,
    task: 'runClient',
    memoryMb: 3072,
    log: (l) => {
      if (process.env.VERBOSE) console.log(l)
      if (/\[NKW\] nkwtest registered/.test(l)) registered = true
      if (/\[NKW\] script loaded: \w+/.test(l)) scripts = true
      if (BAD.test(l) && !/Unable to load model: 'minecraft:/.test(l)) problems.push(l.slice(0, 300))
      if (READY.test(l)) ready = true
    },
    progress: () => {}
  })
  const deadline = Date.now() + 20 * 60 * 1000
  while (!ready && Date.now() < deadline && run.done !== undefined) {
    const finished = await Promise.race([run.done.then(() => true), new Promise<false>((r) => setTimeout(() => r(false), 2000))])
    if (finished) break
  }
  if (ready) await new Promise((r) => setTimeout(r, 15000)) // let resource reload finish and log any model errors
  run.stop()
  await run.done
  const ok = registered && ready && scripts && problems.length === 0
  console.log(`${ok ? '✔' : '✘'} ${name}  registered=${registered} ready=${ready} scripts=${scripts}`)
  for (const p of problems.slice(0, 25)) console.log('    ' + p)
  return ok
}

async function main() {
  let all = true
  for (const t of process.argv.slice(2)) all = (await smoke(t)) && all
  process.exit(all ? 0 : 1)
}
void main()
