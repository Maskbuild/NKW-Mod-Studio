import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { enableFirstParty } from '../src/core/ext/firstparty'
import { extHost } from '../src/core/ext/host'
import { extTestSlugs } from '../src/core/gen/extgen'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { PROFILES, getProfile } from '../src/core/gen/profiles'
import { javaPackage } from '../src/core/project'
import { skinsProject } from './helpers/skinsProject'
import { writeFixture } from '../scripts/fixture'

enableFirstParty()
const hasJdk = spawnSync('javac', ['-version']).status === 0
const dir = mkdtempSync(join(tmpdir(), 'nkw-syntax-'))
const project = writeFixture(join(dir, 'fixture'))
const read = { readText: (a: string) => readFileSync(join(dir, 'fixture', 'assets', a), 'utf8') }

/** Every Java file generated for every loader × version must at least parse (the compiler would stop on a typo). */
describe.skipIf(!hasJdk)('generated Java parses', () => {
  for (const p of PROFILES)
    for (const loader of p.loaders)
      it(`${loader} ${p.mc}`, () => {
        const target = { loader, mc: p.mc }
        const { ir } = compile(project, target)
        const extMods = extTestSlugs({ ir, p: getProfile(p.mc), loader, target, ns: ir.meta.modId, pkg: javaPackage(ir.meta) }).map(
          (s) => `maven.modrinth:${s}:x`
        )
        const files = generate(ir, target, { ...TOOL_VERSIONS, ...FALLBACK_DEPS[p.mc], gradle: '8.14.3', extMods }, read).filter(
          (f) => f.path.endsWith('.java') && f.text !== undefined
        )
        expect(files.length).toBeGreaterThan(5)
        const root = join(dir, `${loader}-${p.mc}`)
        const list: string[] = []
        for (const f of files) {
          const path = join(root, f.path)
          mkdirSync(dirname(path), { recursive: true })
          writeFileSync(path, f.text!)
          list.push(path)
        }
        writeFileSync(join(root, 'list.txt'), list.join('\n'))
        const r = spawnSync('java', ['tests/helpers/JavaSyntax.java', join(root, 'list.txt')], { encoding: 'utf8' })
        expect(r.stdout, r.stderr).toMatch(/^OK \d+/m)
      }, 60_000)

  for (const [loader, mc] of [
    ['fabric', '1.20.1'],
    ['fabric', '1.20.4'],
    ['fabric', '1.21.1'],
    ['quilt', '1.21.1'],
    ['neoforge', '1.20.4'],
    ['neoforge', '1.21.1']
  ] as const)
    it(`skins on ${loader} ${mc}`, () => {
      const target = { loader, mc }
      const { ir } = compile(skinsProject(), target)
      const files = generate(ir, target, { ...TOOL_VERSIONS, ...FALLBACK_DEPS[mc], gradle: '8.14.3' }, { readText: () => '' }).filter(
        (f) => f.path.endsWith('.java') && f.text !== undefined
      )
      expect(files.some((f) => f.path.endsWith('/NkwWardrobeScreen.java'))).toBe(true)
      const root = join(dir, `skins-${loader}-${mc}`)
      const list: string[] = []
      for (const f of files) {
        const path = join(root, f.path)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, f.text!)
        list.push(path)
      }
      writeFileSync(join(root, 'list.txt'), list.join('\n'))
      const r = spawnSync('java', ['tests/helpers/JavaSyntax.java', join(root, 'list.txt')], { encoding: 'utf8' })
      expect(r.stdout, r.stderr).toMatch(/^OK \d+/m)
    }, 60_000)

  it('is not skipped while extensions are loaded', () => {
    expect(extHost.list().length).toBeGreaterThan(0)
  })
})
