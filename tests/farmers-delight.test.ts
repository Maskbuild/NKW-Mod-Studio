import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { enableFirstParty } from '../src/core/ext/firstparty'
import { extTestSlugs } from '../src/core/gen/extgen'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { getProfile } from '../src/core/gen/profiles'
import { javaPackage } from '../src/core/project'
import { writeFixture } from '../scripts/fixture'

enableFirstParty()
const dir = mkdtempSync(join(tmpdir(), 'nkw-fd-'))
const project = writeFixture(dir)
const read = { readText: (a: string) => readFileSync(join(dir, 'assets', a), 'utf8') }

const gen = (loader: 'fabric' | 'forge' | 'neoforge' | 'quilt', mc: string) => {
  const target = { loader, mc }
  const { ir, diagnostics } = compile(project, target)
  const files = generate(ir, target, { ...TOOL_VERSIONS, ...FALLBACK_DEPS[mc], gradle: '8.14.3' }, read)
  const slugs = extTestSlugs({ ir, p: getProfile(mc), loader, target, ns: ir.meta.modId, pkg: javaPackage(ir.meta) })
  return { ir, diagnostics, slugs, recipe: (name: string) => files.find((f) => f.path.endsWith(`/${name}.json`))?.text }
}

describe("Farmer's Delight extension", () => {
  it('writes cutting and cooking recipes in each version’s ingredient and stack layout', () => {
    const modern = gen('neoforge', '1.21.1')
    const names = modern.ir.ext['farmers-delight'].cuttingRecipes.map((r) => r.name as string)
    expect(names.length).toBeGreaterThan(0)
    const cut = JSON.parse(modern.recipe(names[0])!)
    expect(cut.type).toBe('farmersdelight:cutting')
    expect(cut.tool).toEqual(expect.objectContaining({ tag: 'c:tools/knife' }))
    expect(cut.ingredients).toEqual([modern.ir.ext['farmers-delight'].cuttingRecipes[0].input])
    const old = gen('forge', '1.20.1')
    const oldCut = JSON.parse(old.recipe(names[0])!)
    expect(oldCut.tool).toEqual({ tag: 'forge:tools/knives' })
    expect(oldCut.ingredients).toEqual(cut.ingredients)
    const cook = modern.ir.ext['farmers-delight'].cookingRecipes[0]
    expect(JSON.parse(modern.recipe(cook.name as string)!)).toMatchObject({ type: 'farmersdelight:cooking', result: { id: cook.result, count: cook.count } })
  })

  it('asks for the right Modrinth build per loader and skips unsupported targets with a warning', () => {
    expect(gen('forge', '1.20.1').slugs).toEqual(['farmers-delight'])
    expect(gen('fabric', '1.21.1').slugs).toEqual(['farmers-delight-refabricated'])
    const none = gen('fabric', '1.21.4')
    expect(none.slugs).toEqual([])
    expect(none.recipe(none.ir.ext['farmers-delight'].cuttingRecipes[0].name as string)).toBeUndefined()
    expect(none.diagnostics.some((d) => d.severity === 'warning' && /Farmer's Delight is not available for fabric 1\.21\.4/.test(d.message.en))).toBe(true)
  })
})
