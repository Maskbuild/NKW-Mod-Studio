import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { convertBBModel, rotateBoxes, shapeBoxes } from '../src/core/gen/model'
import { PROFILES } from '../src/core/gen/profiles'
import { NODE_DEF_MAP, visibleInputs } from '../src/core/nodes/defs'
import { bbmodelToGeo } from '../src/core/gen/geo'
import { ASSET_RE, ProjectSchema, toId, type Project } from '../src/core/project'
import { safeJoin } from '../src/main/services/builder'
import { HAT_BBMODEL, writeFixture } from '../scripts/fixture'

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
    expect(ir.items.filter((i) => i.armor).length).toBe(13)
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
    expect(disc.disc!.onEnd).toBe('loop')
    expect(ir.tabs[0].items.slice(0, 3)).toEqual(['nkwtest:ruby', 'nkwtest:shiny_ruby', 'nkwtest:ruby_block'])
    expect(soup.food!.effects[2]).toMatchObject({ amplifier: 299, infinite: true })
  })
  it('trims shaped recipe patterns', () => {
    const { ir } = compile(project)
    const sword = ir.recipes.find((r) => r.kind === 'shaped' && r.result.endsWith('ruby_sword'))
    expect(sword && sword.kind === 'shaped' && sword.pattern).toEqual(['A', 'A', 'B'])
  })
  it('builds the shaped pattern from the grid, keeping old s1..s9 wires working', () => {
    const { ir } = compile(project)
    const old = ir.recipes.find((r) => r.kind === 'shaped' && r.result.endsWith('ruby_block'))
    expect(old && old.kind === 'shaped' && old.pattern).toEqual(['AAA', 'AAA', 'AAA'])
    // wired ingredients that were never placed on the grid → a clear hint
    const p = structuredClone(project)
    p.graph.nodes.find((n) => n.id === 'r2')!.data.grid = []
    expect(compile(p).diagnostics.some((d) => d.nodeId === 'r2' && /grid/.test(d.message.en))).toBe(true)
  })
  it('grows grouped pins one at a time and hides unwired legacy pins', () => {
    const def = NODE_DEF_MAP.recipeShaped
    const none = visibleInputs(def, () => false)
    expect(none.left.map((p) => p.id)).toEqual(['i1'])
    expect(none.right.map((p) => p.id)).toEqual(['result'])
    const two = visibleInputs(def, (id) => id === 'i1' || id === 'i2' || id === 's5')
    expect(two.left.map((p) => p.id)).toEqual(['i1', 'i2', 'i3', 's5'])
    const all = visibleInputs(def, (id) => /^i[1-9]$/.test(id))
    expect(all.left.length).toBe(9)
    expect(visibleInputs(NODE_DEF_MAP.creativeTab, () => false).left.map((p) => p.id)).toEqual(['logo', 'icon', 'item1'])
  })
  it('fits armor models: plain Blockbench models get armor bones, fit bones carry move/turn, animation carries size', () => {
    const { ir } = compile(project)
    const hat = ir.items.find((i) => i.id === 'top_hat')!
    expect(hat.armor!.geo!.fit).toEqual({ offset: [0, 1, 0], rotation: [0, 0, -8], scale: [1.25, 1.25, 1.25] })
    const files = generate(ir, { loader: 'fabric', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    const geo = JSON.parse(files.find((f) => f.path.endsWith('/geo/item/armor/top_hat.geo.json'))!.text!)
    const bones = geo['minecraft:geometry'][0].bones as { name: string; parent?: string; pivot: number[]; rotation?: number[]; cubes?: { origin: number[] }[] }[]
    expect(bones.map((b) => b.name)).toEqual(['armorHead', 'nkw_fit_armorHead', 'hat'])
    const fitBone = bones[1]
    expect(fitBone.parent).toBe('armorHead')
    expect(fitBone.rotation).toEqual([0, 0, -8])
    // brim rests on top of the head (y = 32), then moved up 1 pixel
    const brim = bones[2].cubes![0]
    expect(brim.origin[1]).toBe(33)
    expect(brim.origin[0]).toBe(-6)
    const anim = JSON.parse(files.find((f) => f.path.endsWith('/animations/item/armor/top_hat.animation.json'))!.text!)
    expect(anim.animations['animation.nkw.fit'].bones.nkw_fit_armorHead.scale).toEqual([1.25, 1.25, 1.25])
    // the looping animation of the boots keeps its own bones and gains the fit scale
    const boots = JSON.parse(files.find((f) => f.path.includes('/animations/item/armor/') && f.text?.includes('animation.ruby_armor.idle') && f.text.includes('nkw_fit_'))!.text!)
    expect(boots.animations['animation.ruby_armor.idle'].bones.armorHead).toBeTruthy()
    expect(boots.animations['animation.ruby_armor.idle'].bones.nkw_fit_armorRightBoot.scale).toEqual([1.1, 1.1, 1.1])
    const java = files.find((f) => f.path.endsWith('/ModItems.java'))!.text!
    expect(java).toContain('"animation.nkw.fit"')
  })
  it('converts .bbmodel like Blockbench does (x mirrored, x/y rotation negated, up/down uv flipped)', () => {
    const { geo } = bbmodelToGeo(HAT_BBMODEL)
    const [bone] = geo['minecraft:geometry'][0].bones!
    expect(bone.pivot).toEqual([0, 0, 0])
    const crown = bone.cubes![1]
    expect(crown.origin).toEqual([-4, 1, -4])
    expect(crown.rotation).toEqual([0, 0, 5])
    expect((crown.uv as Record<string, unknown>).up).toEqual({ uv: [8, 12], uv_size: [-8, -8] })
  })
  it('uses iron when a tool or armor piece has no material', () => {
    const { ir, diagnostics } = compile(project)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(ir.items.find((i) => i.id === 'plain_knife')!.tool!.material).toBe('nkw_iron')
    expect(ir.items.find((i) => i.id === 'iron_look_cap')!.armor!.material).toBe('nkw_iron')
    expect(ir.armorMats.find((m) => m.id === 'nkw_iron')!.vanillaLook).toBe('iron')
    const java = (loader: 'fabric' | 'forge', mc: string) =>
      generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read).find((f) => f.path.endsWith('/ModArmorMaterials.java'))!.text!
    expect(java('fabric', '1.20.1')).toContain('NKW_IRON("iron",')
    expect(java('fabric', '1.21.1')).toContain('ResourceLocation.withDefaultNamespace("iron")')
    expect(java('fabric', '1.21.4')).toContain('NKW_IRON_ASSET = EquipmentAssets.IRON')
  })
  it('wears a Java .json model as armor, with its textures merged into one sheet', () => {
    const { ir } = compile(project)
    const g = ir.items.find((i) => i.id === 'block_crown')!.armor!.geo!
    expect(g.java).toEqual({ textures: ['textures/ruby.png', 'textures/lamp.png'] })
    const files = generate(ir, { loader: 'neoforge', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    expect(files.find((f) => f.path.endsWith('/textures/item/armor/block_crown.png'))!.atlas).toEqual(['textures/ruby.png', 'textures/lamp.png'])
    const geo = JSON.parse(files.find((f) => f.path.endsWith('/geo/item/armor/block_crown.geo.json'))!.text!)
    const desc = geo['minecraft:geometry'][0].description
    expect([desc.texture_width, desc.texture_height]).toEqual([16, 32])
    const bones = geo['minecraft:geometry'][0].bones
    expect(bones[0].name).toBe('armorHead')
    const [base, gem] = bones[1].cubes
    // sits on the head, centred; second texture lives in the lower half of the sheet
    expect(base.origin).toEqual([-4, 32, -4])
    expect(gem.uv.north.uv).toEqual([0, 16])
    expect(gem.rotation).toEqual([0, -45, 0])
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
          expect(files.find((x) => x.path.endsWith('animations/item/armor/winged_boots.animation.json'))?.text).toContain('animation.ruby_armor.idle')
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
