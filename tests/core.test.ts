import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { convertBBModel, rotateBoxes, shapeBoxes } from '../src/core/gen/model'
import { PROFILES } from '../src/core/gen/profiles'
import { ASSET_RE, ProjectSchema, toId, type Project } from '../src/core/project'
import { safeJoin } from '../src/main/services/builder'
import { writeFixture } from '../scripts/fixture'

const dir = mkdtempSync(join(tmpdir(), 'nkw-test-'))
const project = writeFixture(dir)
const read = { readText: (a: string) => readFileSync(join(dir, 'assets', a), 'utf8') }
const deps = { ...TOOL_VERSIONS, farmersDelight: 'maven.modrinth:farmers-delight:x', geckolib: 'maven.modrinth:geckolib:x', modMenu: 'maven.modrinth:modmenu:x' }

describe('project schema', () => {
  it('accepts the fixture', () => {
    expect(ProjectSchema.safeParse(project).success).toBe(true)
  })
  it('rejects bad mod ids and asset paths', () => {
    expect(ProjectSchema.safeParse({ ...project, meta: { ...project.meta, modId: 'Bad Id' } }).success).toBe(false)
    expect(ASSET_RE.test('textures/../../evil.png')).toBe(false)
    expect(ASSET_RE.test('textures/ok_1.png')).toBe(true)
  })
  it('makes ids from names', () => {
    expect(toId('Ruby Sword!')).toBe('ruby_sword')
    expect(toId('ดาบ')).toBe('unnamed')
    expect(toId('123 Go')).toBe('go')
  })
})

describe('compiler', () => {
  it('compiles the fixture without errors', () => {
    const { ir, diagnostics } = compile(project, { loader: 'fabric', mc: '1.21.1' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(ir.items.map((i) => i.id)).toContain('ruby_sword')
    expect(ir.items.filter((i) => i.armor).length).toBe(10)
    const soup = ir.items.find((i) => i.id === 'ruby_soup')!
    expect(soup.food!.effects.map((e) => e.effect)).toEqual(['REGENERATION', 'POISON', 'DAMAGE_BOOST'])
    expect(soup.food!.effects[0]).toMatchObject({ amplifier: 1, ticks: 100, chance: 0.8 })
    const boots = ir.items.find((i) => i.id === 'winged_boots')!
    expect(boots.armor!.geo!.animation).toEqual({ asset: 'animations/ruby_armor.json', name: 'animation.ruby_armor.idle' })
    expect(ir.textureAnims['textures/glow.png']).toEqual({ frametime: 4, interpolate: true })
    expect(ir.blocks.length).toBe(6)
    expect(ir.items.find((i) => i.id === 'ruby_seeds')!.places).toBe('ruby_crop')
    expect(ir.items.find((i) => i.id === 'lamp_trophy')!.separateIcon).toBe(true)
    expect(ir.tabs.map((tb) => tb.id)).toEqual(['main', 'gear'])
    expect(ir.tabs[1].items).toEqual(['nkwtest:ruby_sword', 'nkwtest:ruby_pickaxe', 'nkwtest:ruby_crown', 'nkwtest:ruby_helmet'])
    // by default items not wired to a tab are hidden (only /give)
    expect(ir.tabs.flatMap((tb) => tb.items)).not.toContain('nkwtest:glow_shard')
    // opt-in: collect them into the main tab; the item-less crop is never listed
    const withMain = compile({ ...project, meta: { ...project.meta, looseItems: 'main' } }).ir
    expect(withMain.tabs[0].items).toContain('nkwtest:glow_shard')
    expect(withMain.tabs[0].items).not.toContain('nkwtest:ruby_crop')
    const disc = ir.items.find((i) => i.id === 'music_disc_nkw')!
    expect(disc.disc!.length).toBe(124)
    expect(soup.food!.effects[2]).toMatchObject({ amplifier: 299, infinite: true })
  })
  it('trims shaped recipe patterns', () => {
    const { ir } = compile(project)
    const sword = ir.recipes.find((r) => r.kind === 'shaped' && r.result.endsWith('ruby_sword'))
    expect(sword && sword.kind === 'shaped' && sword.pattern).toEqual(['A', 'A', 'B'])
  })
  it('follows reroute nodes', () => {
    const { ir } = compile(project)
    expect(ir.toolMats[0].repair).toEqual({ item: 'nkwtest:ruby' })
  })
  it('reports duplicate ids and missing inputs', () => {
    const p: Project = structuredClone(project)
    p.graph.nodes.push({ id: 'dup', type: 'item', position: { x: 0, y: 0 }, data: { id: 'ruby', name: 'x' } })
    const { diagnostics } = compile(p)
    expect(diagnostics.some((d) => d.nodeId === 'dup' && /Duplicate/.test(d.message.en))).toBe(true)
    expect(diagnostics.some((d) => d.nodeId === 'dup' && /texture/.test(d.message.en))).toBe(true)
  })
  it('warns when Farmer\'s Delight is unavailable', () => {
    const { diagnostics } = compile(project, { loader: 'fabric', mc: '1.16.5' })
    expect(diagnostics.some((d) => /Farmer's Delight/.test(d.message.en))).toBe(true)
  })
})

describe('generators', () => {
  for (const p of PROFILES)
    for (const loader of p.loaders)
      it(`${loader} ${p.mc}`, () => {
        const target = { loader, mc: p.mc }
        const { ir } = compile(project, target)
        const files = generate(ir, target, { ...deps, ...FALLBACK_DEPS[p.mc], gradle: '8.14.3' }, read)
        const paths = files.map((f) => f.path)
        expect(paths).toContain('build.gradle')
        expect(paths.some((x) => x.endsWith('NkwMod.java'))).toBe(true)
        const recipeDir = p.pluralDataDirs ? 'recipes' : 'recipe'
        expect(paths).toContain(`src/main/resources/data/nkwtest/${recipeDir}/ruby_block_shaped.json`)
        for (const f of files) {
          if (f.text === undefined) continue
          expect(f.text, f.path).not.toMatch(/undefined|\[object Object\]|NaN/)
          if (f.path.endsWith('.json')) expect(() => JSON.parse(f.text!), f.path).not.toThrow()
        }
        const recipe = JSON.parse(files.find((f) => f.path.endsWith('/ruby_block_shaped.json'))!.text!)
        if (p.stackId) expect(recipe.result.id).toBe('nkwtest:ruby_block')
        else expect(recipe.result.item).toBe('nkwtest:ruby_block')
        if (p.stringIngredients) expect(recipe.key.A).toBe('nkwtest:ruby')
        else expect(recipe.key.A).toEqual({ item: 'nkwtest:ruby' })
        if (p.jukeboxSongs) expect(paths).toContain('src/main/resources/data/nkwtest/jukebox_song/music_disc_nkw.json')
        if (p.itemDefinitions) expect(paths).toContain('src/main/resources/assets/nkwtest/items/ruby.json')
        // placeable items, tabs, copyright label
        const javaAll = files.filter((x) => x.path.endsWith('.java')).map((x) => x.text).join('\n')
        expect(javaAll).toMatch(p.propertiesId ? /new BlockItem\(ModBlocks\.RUBY_CROP(\.get\(\))?, props\("ruby_seeds"\)[^)]*\.useItemDescriptionPrefix\(\)/ : /new (ItemNameBlockItem|BlockNamedItem)\(ModBlocks\.RUBY_CROP/)
        expect(javaAll).not.toMatch(/"ruby_crop", (\(\) -> )?new BlockItem/)
        expect(javaAll).toMatch(/\bGEAR\b/)
        expect(javaAll).toContain('MAIN_TAB_ICON')
        const en = JSON.parse(files.find((x) => x.path.endsWith('lang/en_us.json'))!.text!)
        expect(Object.values(en)).toContain('NKW - Theme (Copyright-free)')
        expect(en['itemGroup.nkwtest.gear']).toBe('NKW Gear')
        // effects, animated textures and GeckoLib animations
        const java = files.filter((x) => x.path.endsWith('.java')).map((x) => x.text).join('\n')
        expect(java).toMatch(/\b(Mob)?Effects\.POISON\b/)
        expect(java).toContain('hurtEnemy')
        expect(java).toContain('inventoryTick')
        expect(paths).toContain('src/main/resources/assets/nkwtest/textures/item/glow_shard.png.mcmeta')
        if (p.foodApi === 'consumable') expect(java).toContain('ApplyStatusEffectsConsumeEffect')
        else expect(java).toMatch(/\.effect\(new (Mob)?EffectInstance\((Mob)?Effects\.REGENERATION, 100, 1, false, true, true\), 0\.8F\)/)
        expect(java).toContain(p.smithingTransform ? 'DAMAGE_BOOST, -1, 299' : 'DAMAGE_BOOST, Integer.MAX_VALUE, 299')
        if (p.geckoArmor) {
          expect(java).toContain('"animation.ruby_armor.idle"')
          expect(files.find((x) => x.path.endsWith('animations/item/armor/winged_boots.animation.json'))?.copy).toBe('animations/ruby_armor.json')
        }
        if (loader === 'fabric' || loader === 'quilt') expect(files.find((x) => x.path === 'build.gradle')!.text).toContain('maven.modrinth:modmenu:x')
        // Java string escaping of the description in metadata
        const meta = files.find((f) => /fabric\.mod\.json|quilt\.mod\.json|mods\.toml/.test(f.path))!
        expect(meta.text).toContain('Fixture \\"quoted\\" \\\\ mod')
      })
})

describe('models', () => {
  it('computes and rotates hitboxes', () => {
    const boxes = shapeBoxes({ elements: [{ from: [0, 0, 0], to: [16, 8, 4], faces: {} }] })
    expect(boxes).toEqual([[0, 0, 0, 16, 8, 4]])
    expect(rotateBoxes(boxes, 90)).toEqual([[12, 0, 0, 16, 8, 16]])
    expect(rotateBoxes(boxes, 180)).toEqual([[0, 0, 12, 16, 8, 16]])
  })
  it('converts .bbmodel files', () => {
    const bb = {
      resolution: { width: 32, height: 32 },
      textures: [{ name: 'a.png', source: 'data:image/png;base64,AAAA' }],
      elements: [{ from: [0, 0, 0], to: [8, 8, 8], rotation: [0, 30, 0], origin: [4, 4, 4], faces: { north: { uv: [0, 0, 16, 16], texture: 0 }, up: { uv: [0, 0, 8, 8], texture: null } } }]
    }
    const c = convertBBModel(JSON.stringify(bb))
    expect(c.textures[0].base64).toBe('AAAA')
    const el = c.model.elements![0]
    expect(el.faces.north.uv).toEqual([0, 0, 8, 8])
    expect(el.faces.up).toBeUndefined()
    expect(el.rotation).toEqual({ angle: 22.5, axis: 'y', origin: [4, 4, 4] })
  })
})

describe('path safety', () => {
  it('refuses traversal', () => {
    expect(() => safeJoin(dir, '../x')).toThrow()
    expect(() => safeJoin(dir, 'a/../../x')).toThrow()
    expect(() => safeJoin(dir, 'C:/Windows/x')).toThrow()
    expect(safeJoin(dir, 'src/main/A.java')).toContain('A.java')
  })
})
