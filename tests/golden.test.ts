import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { PROFILES } from '../src/core/gen/profiles'
import { writeFixture } from '../scripts/fixture'

/**
 * Golden snapshot: a hash of every file generated from the fixture project for every loader × Minecraft
 * version. The extension restructure moves features around without changing what a mod looks like, so this
 * must stay identical while code moves (update on purpose with `UPDATE_GOLDEN=1 npx vitest run tests/golden.test.ts`
 * and review the diff of tests/golden/generated.json).
 */
const FILE = join(__dirname, 'golden', 'generated.json')
const dir = mkdtempSync(join(tmpdir(), 'nkw-golden-'))
const project = writeFixture(dir)
const read = { readText: (a: string) => readFileSync(join(dir, 'assets', a), 'utf8') }
const deps = {
  ...TOOL_VERSIONS,
  farmersDelight: 'maven.modrinth:farmers-delight:x',
  geckolib: 'maven.modrinth:geckolib:x',
  modMenu: 'maven.modrinth:modmenu:x'
}
const sha = (v: string | Buffer) => createHash('sha1').update(v).digest('hex').slice(0, 16)

type Snapshot = Record<string, Record<string, string>>

function snapshot(): Snapshot {
  const out: Snapshot = {}
  for (const p of PROFILES)
    for (const loader of p.loaders) {
      const target = { loader, mc: p.mc }
      const { ir } = compile(project, target)
      const files = generate(ir, target, { ...deps, ...FALLBACK_DEPS[p.mc], gradle: '8.14.3' }, read)
      const hashes: Record<string, string> = {}
      for (const f of files)
        hashes[f.path] =
          f.text !== undefined
            ? sha(f.text)
            : f.base64 !== undefined
              ? sha(Buffer.from(f.base64, 'base64'))
              : f.copy !== undefined
                ? `copy:${f.copy}`
                : `atlas:${(f.atlas ?? []).join(',')}`
      out[`${loader}-${p.mc}`] = Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))
    }
  return out
}

describe('golden snapshot of generated mods', () => {
  const now = snapshot()
  if (process.env.UPDATE_GOLDEN) {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(now, null, 1) + '\n')
  }
  const golden: Snapshot = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as Snapshot) : {}
  for (const key of Object.keys(now))
    it(key, () => {
      const want = golden[key] ?? {}
      const got = now[key]
      // list what changed first: a readable diff beats one hash mismatch
      const changed = [...new Set([...Object.keys(want), ...Object.keys(got)])].filter((f) => want[f] !== got[f])
      expect(changed).toEqual([])
    })
  it('has a snapshot for every target', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(now).sort())
  })
})
