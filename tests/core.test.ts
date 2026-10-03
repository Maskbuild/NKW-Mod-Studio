import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile, scriptBracketProblem } from '../src/core/compile/compile'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { convertBBModel, rotateBoxes, shapeBoxes } from '../src/core/gen/model'
import { PROFILES } from '../src/core/gen/profiles'
import { NODE_DEF_MAP, gameCropIds, visibleInputs } from '../src/core/nodes/defs'
import { bbmodelToGeo } from '../src/core/gen/geo'
import { isReservedClass, importInsertPos, parseJavacError, scriptClassName, scriptEntrypoints, scriptSource } from '../src/core/scriptApi'
import { ASSET_RE, ProjectSchema, overrideKey, toId, type Project } from '../src/core/project'
import { safeJoin } from '../src/main/services/builder'
import { applyOverrides } from '../src/core/gen/overrides'
import { CONTROL_PRESETS, ModelControlsSchema, gestureFor, keyName } from '../src/core/modelControls'
import { boxUnwrap, faceQuad, faceUv, floodFill, moveBy, newCube, newModel, normalize, toSaved, uvToPixel } from '../src/core/modelEdit'
import { GameOptionsSchema, keyLabel, mcKeyFromCode, mcKeyFromMouse, mergeOptionsTxt, optionsEntries } from '../src/core/gameOptions'
import { HAT_BBMODEL, writeFixture } from '../scripts/fixture'

const dir = mkdtempSync(join(tmpdir(), 'nkw-test-'))
const project = writeFixture(dir)
const read = { readText: (a: string) => readFileSync(join(dir, 'assets', a), 'utf8') }
const deps = {
  ...TOOL_VERSIONS,
  farmersDelight: 'maven.modrinth:farmers-delight:x',
  geckolib: 'maven.modrinth:geckolib:x',
  modMenu: 'maven.modrinth:modmenu:x'
}

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
    expect(ir.items.filter((i) => i.armor).length).toBe(14)
    const soup = ir.items.find((i) => i.id === 'ruby_soup')!
    expect(soup.food!.effects.map((e) => e.effect)).toEqual(['REGENERATION', 'POISON', 'DAMAGE_BOOST'])
    expect(soup.food!.effects[0]).toMatchObject({ amplifier: 1, ticks: 100, chance: 0.8 })
    const boots = ir.items.find((i) => i.id === 'winged_boots')!
    expect(boots.armor!.geo!.animation).toEqual({ asset: 'animations/ruby_armor.json', name: 'animation.ruby_armor.idle' })
    expect(ir.textureAnims['textures/glow.png']).toEqual({ frametime: 4, interpolate: true })
    // 8 blocks + 5 Regenerating Blocks, each with its depleted form
    expect(ir.blocks.length).toBe(18)
    expect(ir.items.find((i) => i.id === 'ruby_seeds')!.places).toBe('ruby_crop')
    expect(ir.items.find((i) => i.id === 'lamp_trophy')!.separateIcon).toBe(true)
    expect(ir.tabs.map((tb) => tb.id)).toEqual(['main', 'gear', 'regen_blocks', 'node_blocks'])
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
    const bones = geo['minecraft:geometry'][0].bones as {
      name: string
      parent?: string
      pivot: number[]
      rotation?: number[]
      cubes?: { origin: number[] }[]
    }[]
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
    const boots = JSON.parse(
      files.find((f) => f.path.includes('/animations/item/armor/') && f.text?.includes('animation.ruby_armor.idle') && f.text.includes('nkw_fit_'))!.text!
    )
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
  it('shows armor as its 3D model in the inventory when chosen', () => {
    const { ir } = compile(project)
    const crown = ir.items.find((i) => i.id === 'block_crown')!
    expect(crown.model).toEqual({ asset: 'models/crown.json', textures: ['textures/ruby.png', 'textures/lamp.png'] })
    expect(ir.items.find((i) => i.id === 'top_hat')!.geoIcon).toBe(true)
    const files = generate(ir, { loader: 'fabric', mc: '1.21.4' }, { ...FALLBACK_DEPS['1.21.4'], ...deps } as never, read)
    const hat = JSON.parse(files.find((f) => f.path.endsWith('/models/item/top_hat.json'))!.text!)
    expect(hat.textures['0']).toBe('nkwtest:item/armor/top_hat')
    expect(hat.display.gui.rotation).toEqual([30, 225, 0])
    // fitted into the block: widest side spans 0…16
    const xs = hat.elements.flatMap((e: { from: number[]; to: number[] }) => [e.from[0], e.to[0]])
    expect(Math.min(...xs)).toBe(0)
    expect(Math.max(...xs)).toBe(16)
    // Java models turn in 22.5° steps: the crown's 5° tilt rounds to none
    expect(hat.elements.every((e: { rotation?: unknown }) => !e.rotation)).toBe(true)
    expect(files.some((f) => f.path.endsWith('/textures/item/armor/top_hat.png'))).toBe(true)
    // the .json crown uses its own model with its textures
    const crownModel = JSON.parse(files.find((f) => f.path.endsWith('/models/item/block_crown.json'))!.text!)
    expect(crownModel.textures).toMatchObject({ '0': 'nkwtest:item/block_crown_0', '1': 'nkwtest:item/block_crown_1' })
    const boots = JSON.parse(files.find((f) => f.path.endsWith('/models/item/winged_boots.json'))!.text!)
    expect(boots.elements.length).toBeGreaterThan(0)
  })
  it('wears items on the head and keeps the .json model in hand', () => {
    const { ir } = compile(project)
    expect(ir.items.find((i) => i.id === 'lamp_statue')!.headwear).toBe(true)
    const knife = ir.items.find((i) => i.id === 'plain_knife')!
    expect(knife.headwear).toBe(true)
    expect(knife.separateIcon).toBe(true)
    const flat = ir.items.find((i) => i.id === 'block_crown_flat')!
    expect(flat.model?.asset).toBe('models/crown.json')
    expect(flat.separateIcon).toBe(true)
    const old = generate(ir, { loader: 'forge', mc: '1.20.1' }, { ...FALLBACK_DEPS['1.20.1'], ...deps } as never, read)
    const head = old.find((f) => f.path.endsWith('/NkwHeadwear.java'))!.text!
    expect(head).toContain('ModItems.LAMP_STATUE.get()')
    // the knife is set to slot-only: no right-click equip
    expect(head).not.toContain('ModItems.PLAIN_KNIFE.get()')
    expect(old.find((f) => f.path.endsWith('/NkwMod.java'))!.text).toContain('NkwHeadwear.init();')
    // drag into the helmet slot + coloured tooltip line
    const items = old.find((f) => f.path.endsWith('/ModItems.java'))!.text!
    expect(items).toContain('public EquipmentSlot getEquipmentSlot(ItemStack stack)')
    expect(items).toContain('Component.translatable("tooltip.nkwtest.wearable_head").withStyle(ChatFormatting.LIGHT_PURPLE)')
    const fab = generate(ir, { loader: 'fabric', mc: '1.20.1' }, { ...FALLBACK_DEPS['1.20.1'], ...deps } as never, read)
    expect(fab.find((f) => f.path.endsWith('/ModItems.java'))!.text).toContain('new FabricItemSettings().equipmentSlot(stack -> EquipmentSlot.HEAD)')
    const fab21 = generate(ir, { loader: 'fabric', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    expect(fab21.find((f) => f.path.endsWith('/ModItems.java'))!.text).toContain('.equipmentSlot((entity, stack) -> EquipmentSlot.HEAD)')
    expect(JSON.parse(fab21.find((f) => f.path.endsWith('/lang/th_th.json'))!.text!)['tooltip.nkwtest.wearable_head']).toBe('สวมบนหัวได้')
    const modern = generate(ir, { loader: 'neoforge', mc: '1.21.4' }, { ...FALLBACK_DEPS['1.21.4'], ...deps } as never, read)
    expect(modern.some((f) => f.path.endsWith('/NkwHeadwear.java'))).toBe(false)
    expect(modern.find((f) => f.path.endsWith('/ModItems.java'))!.text).toContain('.equippable(EquipmentSlot.HEAD)')
    expect(modern.find((f) => f.path.endsWith('/ModItems.java'))!.text).toContain('.equippableUnswappable(EquipmentSlot.HEAD)')
    // the .json model (with its Blockbench display settings) is the hand model; the icon stays 2D
    const def = JSON.parse(modern.find((f) => f.path.endsWith('/items/block_crown_flat.json'))!.text!)
    expect(def.model.type).toBe('minecraft:select')
  })
  it('makes drinks drink like a potion, before and after the consumable component', () => {
    const { ir } = compile(project)
    expect(ir.items.find((i) => i.id === 'ruby_juice')!.food!.drink).toBe(true)
    expect(ir.items.find((i) => i.id === 'ruby_soup')!.food!.drink).toBe(false)
    const gen = (loader: 'fabric' | 'forge' | 'neoforge', mc: string) =>
      generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read).find((f) => f.path.endsWith('/ModItems.java'))!.text!
    const old = gen('forge', '1.20.1')
    expect(old).toContain('return UseAnim.DRINK;')
    expect(old).toContain('public SoundEvent getEatingSound() {\n                return SoundEvents.GENERIC_DRINK;')
    expect(old).toContain('import net.minecraft.world.item.UseAnim;')
    // only the juice drinks
    expect(old.match(/UseAnim\.DRINK/g)!.length).toBe(1)
    expect(gen('forge', '1.16.5')).toContain('import net.minecraft.item.UseAction;')
    const modern = gen('fabric', '1.21.4')
    expect(modern).toContain('Consumables.defaultDrink()')
    expect(modern).not.toContain('UseAnim')
  })
  it('gives thirst values to every supported thirst mod without depending on them', () => {
    const { ir } = compile(project)
    expect(ir.items.find((i) => i.id === 'ruby_juice')!.food!.thirst).toEqual({ thirst: 8, hydration: 6 })
    const gen = (loader: 'fabric' | 'quilt' | 'forge' | 'neoforge', mc: string) =>
      generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read)
    const text = (files: ReturnType<typeof gen>, end: string) => files.find((f) => f.path.endsWith(end))?.text
    const f21 = gen('fabric', '1.21.1')
    // Tough As Nails tags (singular folder on 1.21), hydration rounded to its 10 % steps
    expect(JSON.parse(text(f21, '/data/toughasnails/tags/item/thirst/8_thirst_drinks.json')!).values).toEqual(['nkwtest:ruby_juice'])
    expect(JSON.parse(text(f21, '/data/toughasnails/tags/item/hydration/30_hydration_drinks.json')!).values).toEqual(['nkwtest:ruby_juice'])
    expect(f21.some((f) => f.path.includes('hydration') && f.text?.includes('ruby_soup'))).toBe(false)
    // Thirst Was Taken 2 and Legendary Survival Overhaul data files
    expect(JSON.parse(text(f21, '/data/nkwtest/thirstwastaken2/drinks/nkwtest.json')!).values).toEqual({
      'nkwtest:ruby_juice': { thirst: 8, quenched: 6 },
      'nkwtest:ruby_soup': { thirst: 3, quenched: 0 }
    })
    expect(JSON.parse(text(f21, '/legendarysurvivaloverhaul/thirst/consumables/ruby_juice.json')!)).toEqual([
      { effects: [], hydration: 8, properties: {}, saturation: 6 }
    ])
    expect(text(f21, '/NkwThirst.java')).toBeUndefined()
    const f20 = gen('forge', '1.20.1')
    expect(text(f20, '/data/toughasnails/tags/items/thirst/3_thirst_drinks.json')).toContain('nkwtest:ruby_soup')
    // Thirst Was Taken: drinks vs foods through its event, by reflection
    const twt = text(f20, '/NkwThirst.java')!
    expect(twt).toContain('ModList.get().isLoaded("thirst")')
    expect(twt).toContain('drink.invoke(event, ModItems.RUBY_JUICE.get(), 8, 6);')
    expect(twt).toContain('food.invoke(event, ModItems.RUBY_SOUP.get(), 3, 0);')
    expect(text(f20, '/NkwMod.java')).toContain('NkwThirst.init();')
    expect(text(gen('neoforge', '1.21.1'), '/NkwThirst.java')).toContain('NeoForge.EVENT_BUS.addListener(EventPriority.NORMAL, false, event')
    // Thirsty (Fabric 1.20.1)
    expect(text(gen('quilt', '1.20.1'), '/NkwThirst.java')).toContain('add(items, entry, itemId, "nkwtest:ruby_juice", 8, 6);')
    expect(text(gen('forge', '1.21.4'), '/NkwThirst.java')).toBeUndefined()
  })
  it('writes the license and credits into the mod metadata and the jar', () => {
    const { ir } = compile(project)
    const gen = (loader: 'fabric' | 'quilt' | 'forge' | 'neoforge', mc: string) =>
      generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read)
    const fab = gen('fabric', '1.21.1')
    const fmj = JSON.parse(fab.find((f) => f.path.endsWith('/fabric.mod.json'))!.text!)
    expect(fmj.license).toBe('MIT')
    // empty names are left out, bad links dropped
    // shown in Mod Menu as "Name - what they made (site)"
    expect(fmj.contributors).toEqual([
      { name: 'Ruby "Artist" - Ruby texture (example.com/ruby)', contact: { homepage: 'https://example.com/ruby' } },
      'No Link'
    ])
    expect(fmj.contact).toEqual({ homepage: 'https://example.com/nkw', issues: 'https://example.com/nkw/issues' })
    const credits = fab.find((f) => f.path.endsWith('/resources/CREDITS.txt'))!.text!
    expect(credits).toContain('Ruby "Artist": Ruby texture\n  folders: textures/\n  files: textures/ruby.png\n  https://example.com/ruby')
    expect(credits).not.toContain('half-typed')
    expect(fab.find((f) => f.path.endsWith('/resources/LICENSE.txt'))!.text).toContain('https://spdx.org/licenses/MIT.html')
    const qmj = JSON.parse(gen('quilt', '1.20.1').find((f) => f.path.endsWith('/quilt.mod.json'))!.text!)
    expect(qmj.quilt_loader.metadata.license).toBe('MIT')
    expect(qmj.quilt_loader.metadata.contributors['Ruby "Artist"']).toBe('Ruby texture (example.com/ruby)')
    expect(qmj.quilt_loader.metadata.contact.issues).toBe('https://example.com/nkw/issues')
    const toml = gen('neoforge', '1.21.1').find((f) => f.path.endsWith('mods.toml'))!.text!
    expect(toml).toContain('license="MIT"')
    // one credit per line under "Credits:" in the mod list
    expect(toml).toContain('credits="\\nRuby \\"Artist\\" - Ruby texture (https://example.com/ruby)\\nNo Link"')
    expect(toml).toContain('displayURL="https://example.com/nkw"')
    expect(toml).toContain('issueTrackerURL="https://example.com/nkw/issues"')
    // defaults: all rights reserved, no extra files
    const plain = compile({ ...project, meta: { ...project.meta, license: undefined, credits: undefined } }).ir
    const pf = generate(plain, { loader: 'forge', mc: '1.20.1' }, { ...FALLBACK_DEPS['1.20.1'], ...deps } as never, read)
    expect(pf.find((f) => f.path.endsWith('mods.toml'))!.text).toContain('license="All Rights Reserved"')
    expect(pf.some((f) => /(LICENSE|CREDITS)\.txt$/.test(f.path))).toBe(false)
  })
  it('gives weapons hit abilities, their own durability or no durability at all', () => {
    const gen = (loader: 'fabric' | 'forge' | 'neoforge', mc: string) => {
      const { ir } = compile(project, { loader, mc })
      return generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read)
    }
    const text = (files: ReturnType<typeof gen>, end: string) => files.find((f) => f.path.endsWith(end))!.text!
    const { ir } = compile(project)
    const sword = ir.items.find((i) => i.id === 'ruby_sword')!.tool!
    expect(sword.hits).toEqual([
      { ability: 'fire', ticks: 80, chance: 1 },
      { ability: 'lightning', ticks: 80, chance: 0.25 }
    ])
    expect(sword.durability).toBe(3000)
    const f20 = gen('forge', '1.20.1')
    const items = text(f20, '/ModItems.java')
    expect(items).toContain('new NkwEffect(NkwEffect.FIRE, 80, 1.0F), new NkwEffect(NkwEffect.LIGHTNING, 80, 0.25F)')
    expect(items).toContain('.durability(3000)')
    expect(items).toContain('stack.getOrCreateTag().putBoolean("Unbreakable", true);')
    const effect = text(f20, '/NkwEffect.java')
    expect(effect).toContain('target.setSecondsOnFire(Math.max(1, ticks / 20));')
    expect(effect).toContain('EntityType.LIGHTNING_BOLT.create(level)')
    expect(effect).toContain('target.setTicksFrozen(')
    const n21 = gen('neoforge', '1.21.1')
    expect(text(n21, '/ModItems.java')).toContain('NkwTiers.withUses(ModToolTiers.RUBY, 3000)')
    expect(text(n21, '/ModItems.java')).toContain('.component(DataComponents.UNBREAKABLE, new Unbreakable(true))')
    expect(text(n21, '/NkwTiers.java')).toContain('public int getUses() {\n                return uses;')
    expect(text(n21, '/NkwEffect.java')).toContain('target.igniteForSeconds(ticks / 20F);')
    const f214 = gen('fabric', '1.21.4')
    expect(text(f214, '/NkwTiers.java')).toContain('new ToolMaterial(material.incorrectBlocksForDrops(), uses,')
    expect(text(f214, '/NkwEffect.java')).toContain('EntityType.LIGHTNING_BOLT.create(level, EntitySpawnReason.TRIGGERED)')
    // abilities when eaten happen to the eater, on the server
    const food = text(f20, '/ModItems.java')
    expect(food).toContain(
      'public ItemStack finishUsingItem(ItemStack stack, Level level, LivingEntity entity) {\n                if (!level.isClientSide) {\n                    new NkwEffect(NkwEffect.FREEZE, 60, 1.0F).apply(entity);\n                    new NkwEffect(NkwEffect.CLEAR, 80, 1.0F).apply(entity);'
    )
    expect(food).toContain('new NkwEffect(NkwEffect.TELEPORT, 80, 1.0F).apply(entity);')
    expect(effect).toContain('target.randomTeleport(x, y, z, true)')
    expect(effect).toContain('target.removeAllEffects();')
    expect(text(f214, '/ModItems.java')).toContain('new NkwEffect(NkwEffect.FIRE, 80, 1.0F).apply(entity);')
    // 1.16.5 has no freezing
    expect(text(gen('forge', '1.16.5'), '/NkwEffect.java')).not.toContain('setTicksFrozen')
  })
  it('adds stat bonuses while items are held, worn or carried', () => {
    const gen = (loader: 'fabric' | 'forge' | 'neoforge', mc: string) => {
      const res = compile(project, { loader, mc })
      return { ...res, files: generate(res.ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read) }
    }
    const text = (files: { path: string; text?: string }[], end: string) => files.find((f) => f.path.endsWith(end))!.text!
    // block reach needs 1.20.5+: left out (with a warning) on 1.20.1
    const old = gen('forge', '1.20.1')
    expect(old.ir.items.find((i) => i.id === 'ruby_pickaxe')!.attributes).toEqual([])
    expect(old.diagnostics.some((d) => d.severity === 'warning' && d.message.en.includes('needs Minecraft 1.21.1'))).toBe(true)
    const attrs = text(old.files, '/NkwAttributes.java')
    expect(attrs).toContain('list.add(new Bonus(ModItems.RUBY_SWORD.get(), MAINHAND, Attributes.MAX_HEALTH, new AttributeModifier(UUID.nameUUIDFromBytes(')
    expect(attrs).toContain('Attributes.MOVEMENT_SPEED, new AttributeModifier(UUID.nameUUIDFromBytes("nkwtest:bonus/shiny_ruby/0"')
    expect(attrs).toContain('AttributeModifier.Operation.MULTIPLY_BASE')
    // armor bonuses default to the piece's slot
    expect(attrs).toContain('ModItems.RUBY_CROWN.get(), HEAD, Attributes.ARMOR')
    expect(attrs).toContain('MinecraftForge.EVENT_BUS.addListener(NkwAttributes::onTick);')
    expect(text(old.files, '/NkwMod.java')).toContain('NkwAttributes.init();')
    const items = text(old.files, '/ModItems.java')
    expect(items).toContain('Component.translatable("tooltip.nkwtest.when.mainhand").withStyle(ChatFormatting.GRAY)')
    expect(items).toContain(
      'Component.translatable("attribute.modifier.plus.0", "4", Component.translatable(Attributes.MAX_HEALTH.getDescriptionId())).withStyle(ChatFormatting.BLUE)'
    )
    expect(items).toContain('"attribute.modifier.plus.1", "20"')
    // hidden from the tooltip
    expect(items).not.toContain('Attributes.LUCK')
    expect(JSON.parse(text(old.files, '/lang/th_th.json'))['tooltip.nkwtest.when.hand']).toBe('เมื่อถือในมือ:')
    const modern = gen('neoforge', '1.21.1')
    const m = text(modern.files, '/NkwAttributes.java')
    expect(m).toContain(
      'Attributes.BLOCK_INTERACTION_RANGE, new AttributeModifier(NkwMod.id("bonus/ruby_pickaxe/0"), 2, AttributeModifier.Operation.ADD_VALUE)'
    )
    expect(m).toContain('instance.getModifier(bonus.modifier.id())')
    expect(text(modern.files, '/ModItems.java')).toContain('Attributes.MAX_HEALTH.value().getDescriptionId()')
    expect(text(gen('fabric', '1.16.5').files, '/NkwAttributes.java')).toContain(
      'for (ItemStack stack : player.inventory.items) if (stack.getItem() == item) return true;'
    )
    expect(text(gen('forge', '1.16.5').files, '/NkwAttributes.java')).toContain('ModifiableAttributeInstance instance')
  })
  it('leaves disabled nodes (and their wires) out of the mod', () => {
    const p = structuredClone(project)
    p.graph.nodes.find((n) => n.id === 'glow_item')!.data.disabled = true
    p.graph.nodes.find((n) => n.id === 'r3')!.data.disabled = true
    const { ir, diagnostics } = compile(p)
    expect(ir.items.some((i) => i.id === 'glow_shard')).toBe(false)
    expect(ir.recipes.length).toBe(compile(project).ir.recipes.length - 1)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })
  it('writes Script nodes as Java files of the mod (package set, per target, Fabric entrypoints)', () => {
    const fab = compile(project, { loader: 'fabric', mc: '1.20.1' })
    expect(fab.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(fab.ir.scripts.map((s) => s.className).sort()).toEqual(['MagicWand', 'Welcome'])
    const files = generate(fab.ir, { loader: 'fabric', mc: '1.20.1' }, { ...FALLBACK_DEPS['1.20.1'], ...deps } as never, read)
    const wand = files.find((f) => f.path.endsWith('/nkwtest/MagicWand.java'))!.text!
    expect(wand.startsWith('package com.nkw.nkwtest;')).toBe(true)
    const meta = JSON.parse(files.find((f) => f.path.endsWith('fabric.mod.json'))!.text!)
    expect(meta.entrypoints.main[0]).toBe('com.nkw.nkwtest.NkwMod')
    expect([...meta.entrypoints.main].sort()).toEqual(['com.nkw.nkwtest.MagicWand', 'com.nkw.nkwtest.NkwMod', 'com.nkw.nkwtest.Welcome'])
    // Forge finds @EventBusSubscriber classes itself: no entrypoints, the file is just there
    const forge = compile(project, { loader: 'forge', mc: '1.20.1' })
    const ff = generate(forge.ir, { loader: 'forge', mc: '1.20.1' }, { ...FALLBACK_DEPS['1.20.1'], ...deps } as never, read)
    expect(ff.find((f) => f.path.endsWith('/Welcome.java'))!.text).toContain('@Mod.EventBusSubscriber(modid = NkwMod.MOD_ID)')
    // a file for another target is left out
    expect(ff.filter((f) => f.path.endsWith('/Welcome.java')).length).toBe(1)
  })
  it('reserves every class name the generator writes', () => {
    for (const p of PROFILES)
      for (const loader of p.loaders) {
        const target = { loader, mc: p.mc }
        const { ir } = compile(project, target)
        const scripts = new Set(ir.scripts.map((s) => s.className))
        for (const f of generate(ir, target, { ...FALLBACK_DEPS[p.mc], ...deps } as never, read)) {
          const m = /\/([A-Za-z]+)\.java$/.exec(f.path)
          if (m && !scripts.has(m[1])) expect(isReservedClass(m[1]), `${m[1]} (${loader} ${p.mc})`).toBe(true)
        }
      }
  })
  it('keeps Java line numbers when setting the package, and parses javac errors', () => {
    expect(scriptSource('package x.y;\nclass A {}', 'com.m')).toBe('package com.m;\nclass A {}')
    expect(scriptSource('// hi\npublic class A {}', 'com.m')).toBe('package com.m; // hi\npublic class A {}')
    expect(scriptClassName('// public class Wrong\nimport a.b;\n@Foo\npublic final class Right implements X {}')).toBe('Right')
    expect(scriptEntrypoints('public class A implements ClientModInitializer {')).toEqual({ main: false, client: true })
    expect(parseJavacError('I:\\x\\src\\main\\java\\com\\nkw\\m\\Welcome.java:12: error: cannot find symbol')).toEqual({
      cls: 'Welcome',
      line: 12,
      message: 'cannot find symbol',
      severity: 'error'
    })
    expect(importInsertPos('package a;\nimport b.C;\n\nclass X {}', 'd.E')).toEqual({ pos: 22, text: '\nimport d.E;' })
    expect(importInsertPos('package a;\nimport d.E;\nclass X {}', 'd.E')).toBeNull()
  })
  it('catches unbalanced brackets and quotes in scripts', () => {
    expect(scriptBracketProblem('if (a) { b(); }')).toBeNull()
    expect(scriptBracketProblem('// )))\nx("}");')).toBeNull()
    expect(scriptBracketProblem('if (a) {\n  b();')?.line).toBe(1)
    expect(scriptBracketProblem('x("abc);')?.en).toContain('unclosed string')
    expect(scriptBracketProblem('a());')?.en).toContain('unexpected ")"')
  })
  it('imports MobEffects for weapon effects even when no food uses effects', () => {
    const p = structuredClone(project)
    p.graph.nodes = p.graph.nodes.filter((n) => n.type !== 'food')
    const { ir } = compile(p)
    for (const [loader, mc] of [
      ['fabric', '1.21.1'],
      ['forge', '1.20.1'],
      ['neoforge', '1.21.4']
    ] as const) {
      const items = generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read).find((f) => f.path.endsWith('/ModItems.java'))!.text!
      expect(items).toContain('MobEffects.')
      expect(items).toContain('import net.minecraft.world.effect.MobEffects;')
    }
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
  it("warns when Farmer's Delight is unavailable", () => {
    const { diagnostics } = compile(project, { loader: 'fabric', mc: '1.16.5' })
    expect(diagnostics.some((d) => /Farmer's Delight/.test(d.message.en))).toBe(true)
  })
  it('collects Break Rules: picked game / other-mod blocks, #tags and wired mod blocks, with a message', () => {
    const { ir, diagnostics } = compile(project)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const iron = ir.breakRules.find((r) => r.nodeId === 'rule_iron')!
    expect(iron.blocks).toEqual([
      'minecraft:stone',
      'minecraft:deepslate',
      'othermod:ruby_ore',
      'nkwtest:ruby_pillar',
      'nkwtest:ruby_block',
      'nkwtest:ruby_lamp'
    ])
    expect(iron.tags).toEqual(['minecraft:logs'])
    expect(iron).toMatchObject({ tool: 'pickaxe', level: 'iron', onFail: 'noDrop' })
    expect(iron.message).toEqual({ en: 'Needs an iron pickaxe or better to drop anything', th: 'ต้องใช้อีเต้อเหล็ก 100%' })
    expect(ir.breakRules.find((r) => r.nodeId === 'rule_axe')!.message!.th).toBe('ต้องใช้ขวานระดับเพชรขึ้นไปถึงจะทุบได้')
    expect(ir.breakRules.find((r) => r.nodeId === 'rule_shears')).toMatchObject({ level: 'wood', message: null })
    // plants: what breaking them gives
    expect(ir.blocks.find((b) => b.id === 'ruby_wheat')!.crop!.breakDrops).toBe('grown')
    expect(ir.blocks.find((b) => b.id === 'ruby_bush')!.crop!.breakDrops).toBe('none')
    expect(ir.gameCrops.find((g) => g.block === 'minecraft:carrots')!.breakDrops).toBe('none')
    expect(ir.gameCrops.find((g) => g.block === 'minecraft:wheat')!.breakDrops).toBe('normal')
  })
  it('makes Regenerating Blocks: a copy per picked block, its depleted form and an own creative tab', () => {
    const { ir, diagnostics } = compile(project)
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const iron = ir.blocks.find((b) => b.id === 'regen_iron_ore')!
    expect(iron).toMatchObject({ kind: 'regen', hasItem: true, hardness: 3, tool: 'pickaxe', resistance: 3600000 })
    expect(iron.regen).toMatchObject({ original: 'minecraft:iron_ore', depleted: 'regen_iron_ore_depleted', input: 'break', timer: true })
    expect(ir.blocks.find((b) => b.id === 'regen_iron_ore_depleted')).toMatchObject({
      kind: 'depleted',
      hasItem: false,
      hardness: -1,
      depleted: { look: 'minecraft:bedrock', restore: 'regen_iron_ore', ticks: 600 }
    })
    expect(ir.blocks.some((b) => b.id === 'regen_othermod_ruby_ore')).toBe(true)
    // right-click harvests: the block itself cannot be mined
    const node = ir.blocks.find((b) => b.id === 'node_amethyst_block')!
    expect(node).toMatchObject({ hardness: -1, tool: 'none' })
    expect(node.regen).toMatchObject({ input: 'hold', harvestTicks: 60, give: true, adventure: false })
    expect(ir.blocks.find((b) => b.id === 'node_amethyst_block_depleted')!.depleted!.look).toBe('minecraft:cobblestone')
    expect(ir.tabs.find((t) => t.id === 'regen_blocks')).toMatchObject({
      title: 'Regenerating Blocks',
      items: ['nkwtest:regen_iron_ore', 'nkwtest:regen_oak_log', 'nkwtest:regen_othermod_ruby_ore', 'nkwtest:regen_ruby_block']
    })
    // a block of this mod (wired in), and a mod item dropped instead of the original's loot
    expect(ir.blocks.find((b) => b.id === 'regen_ruby_block')!.regen).toMatchObject({ original: 'nkwtest:ruby_block', drop: null })
    expect(node.regen!.drop).toEqual({ item: 'nkwtest:ruby', min: 2, max: 4 })
    expect(ir.tabs.find((t) => t.id === 'node_blocks')!.title).toBe('Resource Nodes')
    // tags cannot be regenerating blocks
    const p = structuredClone(project) as Project
    p.graph.nodes.find((n) => n.id === 'regen_ores')!.data.blocks = ['#minecraft:logs']
    expect(compile(p).diagnostics.some((d) => d.nodeId === 'regen_ores' && /tags cannot be used/.test(d.message.en))).toBe(true)
  })
  it('checks Break Rules', () => {
    const p = structuredClone(project) as Project
    const rule = p.graph.nodes.find((n) => n.id === 'rule_any')!
    rule.data.blocks = ['Not An Id', 'nkwtest:missing_block']
    const crop = p.graph.nodes.find((n) => n.id === 'wheat')!
    crop.data.breakDrops = 'none'
    crop.data.input = 'break'
    const { diagnostics } = compile(p)
    const of = (id: string) => diagnostics.filter((d) => d.nodeId === id).map((d) => d.message.en)
    expect(of('rule_any').some((m) => /not a block ID/.test(m))).toBe(true)
    expect(of('rule_any').some((m) => /not a block of this mod/.test(m))).toBe(true)
    expect(of('wheat').some((m) => /breaking gives nothing/.test(m))).toBe(true)
    rule.data.blocks = []
    expect(compile(p).diagnostics.some((d) => d.nodeId === 'rule_any' && /at least one block/.test(d.message.en))).toBe(true)
    // tags need 1.18.2+, swords have no level on 1.21.4
    expect(compile(project, { loader: 'forge', mc: '1.16.5' }).diagnostics.some((d) => d.nodeId === 'rule_iron' && /1\.18\.2/.test(d.message.en))).toBe(true)
    expect(
      compile(project, { loader: 'fabric', mc: '1.21.4' }).diagnostics.some((d) => d.nodeId === 'rule_sword' && /no mining level/.test(d.message.en))
    ).toBe(true)
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
        const javaAll = files
          .filter((x) => x.path.endsWith('.java'))
          .map((x) => x.text)
          .join('\n')
        expect(javaAll).toMatch(
          p.propertiesId
            ? /new BlockItem\(ModBlocks\.RUBY_CROP(\.get\(\))?, props\("ruby_seeds"\)[^)]*\.useItemDescriptionPrefix\(\)/
            : /new (ItemNameBlockItem|BlockNamedItem)\(ModBlocks\.RUBY_CROP/
        )
        expect(javaAll).not.toMatch(/"ruby_crop", (\(\) -> )?new BlockItem/)
        expect(javaAll).toMatch(/\bGEAR\b/)
        expect(javaAll).toContain('MAIN_TAB_ICON')
        const en = JSON.parse(files.find((x) => x.path.endsWith('lang/en_us.json'))!.text!)
        expect(Object.values(en)).toContain('NKW - Theme (Copyright-free)')
        expect(en['itemGroup.nkwtest.gear']).toBe('NKW Gear')
        // effects, animated textures and GeckoLib animations
        const java = files
          .filter((x) => x.path.endsWith('.java'))
          .map((x) => x.text)
          .join('\n')
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
        // Break Rules and plants that give nothing when broken
        const rules = files.find((x) => x.path.endsWith('/NkwBreakRules.java'))!.text!
        expect(java).toContain('NkwBreakRules.init();')
        expect(rules).toMatch(/Rule RULE_0 = new Rule\(0, 2, false, false, "message\.nkwtest\.break_rule_0", [1-9]\d*\);/)
        expect(rules).toContain('add("othermod:ruby_ore", RULE_0);')
        expect(rules).toContain('add("nkwtest:ruby_block", RULE_0);')
        expect(rules).toContain('new Rule(1, 3, true, false, "message.nkwtest.break_rule_1", 0)')
        expect(rules).toContain('new Rule(4, 4, false, false, "message.nkwtest.break_rule_3", -1)')
        // breaking timer on screen
        const hud = files.find((x) => x.path.endsWith('/NkwHarvestHud.java'))!.text!
        expect(hud).toContain('NkwBreakRules.timerLook(state)')
        expect(hud).toContain('mc.gameMode.isDestroying()')
        expect(en['message.nkwtest.breaking']).toBe('Breaking %s %s s')
        // adventure mode: hidden "can break" list on tools that pass the rule
        expect(rules).toContain(p.stackId ? 'DataComponents.CAN_BREAK' : 'tag.put("CanDestroy", list);')
        expect(rules).toMatch(/ADVENTURE\.put\(RULE_0, new String\[\] \{"minecraft:stone"/)
        expect(rules.includes('"#minecraft:logs"})')).toBe(p.mc !== '1.16.5')
        expect(rules).not.toMatch(/ADVENTURE\.put\(RULE_1/)
        expect(java).toContain('if (!rule.adventure && !player.mayBuild()) return false;')
        expect(java).toMatch(/GAME\.put\("minecraft:wheat", new Rule\([^)]*, true, false\)\);/)
        expect(rules).toContain('add("nkwtest:ruby_wheat", PLANT_YOUNG);')
        expect(rules).toContain('add("nkwtest:ruby_bush", PLANT_NONE);')
        expect(rules).toContain('add("minecraft:carrots", PLANT_NONE);')
        expect(rules.includes('TagKey.create(')).toBe(p.mc !== '1.16.5')
        expect(rules).toContain(
          p.toolApi === 'tierLevel' ? 'getTier().getLevel()' : p.toolApi === 'tierTag' ? 'getIncorrectBlocksForDrops()' : 'stack.get(DataComponents.TOOL)'
        )
        expect(rules).toContain(loader === 'fabric' || loader === 'quilt' ? 'PlayerBlockBreakEvents.BEFORE' : 'PlayerEvent.HarvestCheck')
        if (p.mc === '1.16.5' && loader === 'forge') expect(rules).toMatch(/PlayerEntity player[^]*TextFormatting\.RED/)
        expect(en['message.nkwtest.break_rule_0']).toBe('Needs an iron pickaxe or better to drop anything')
        const thLang = JSON.parse(files.find((x) => x.path.endsWith('lang/th_th.json'))!.text!)
        expect(thLang['message.nkwtest.break_rule_0']).toBe('ต้องใช้อีเต้อเหล็ก 100%%')
        expect(en['message.nkwtest.break_rule_2']).toBeUndefined()
        // Regenerating Blocks: look like the original, operators place them, the depleted form grows back
        const text = (all: typeof files, end: string) => all.find((f) => f.path.endsWith(end))?.text
        const regenBlocks = files.find((x) => x.path.endsWith('/ModBlocks.java'))!.text!
        expect(regenBlocks).toMatch(
          /new NkwRegenBlock\([^\n]*"minecraft:iron_ore", \(\) -> ModBlocks\.REGEN_IRON_ORE_DEPLETED(\.get\(\))?, 0, 40, 0, 0, false, true, 0, null, 0, 0\)/
        )
        // its Timer window (the bar) is used, not the default text (index 0)
        expect(regenBlocks).toMatch(/"minecraft:amethyst_block", [^\n]*, 2, 60, [1-9]\d*, -1, true, false, 3, "nkwtest:ruby", 2, 4\)/)
        // a left-button harvest wears the tool in the main hand (mining wears it like the game)
        expect(text(files, '/NkwRegenBlock.java')).toContain(
          p.stackId
            ? 'if (wear > 0 && !tool.isEmpty()) tool.hurtAndBreak(wear, player, EquipmentSlot.MAINHAND);'
            : `if (wear > 0 && !tool.isEmpty()) tool.hurtAndBreak(wear, player, broken -> broken.broadcastBreakEvent(${p.mc === '1.16.5' && loader === 'forge' ? 'EquipmentSlotType' : 'EquipmentSlot'}.MAINHAND));`
        )
        // adventure mode cannot mine: no swing code unless some block is picked there with the left button
        expect(text(files, '/NkwHarvestHud.java')).not.toContain('mc.player.swing(')
        // picked with the left button: from the arm swing, where the player looks
        expect(java).toContain('if (!player.swinging || player.isSpectator()) return null;')
        expect(java).toContain(p.stackId ? 'player.pick(player.blockInteractionRange(), 1.0F, false)' : 'player.pick(4.5, 1.0F, false)')
        expect(java).toContain('if (r.input > 0) rule = new Rule(r.input, r.harvestTicks, 3, 0, r.ui, r.give, r.adventure, true);')
        expect(en['message.nkwtest.harvest_released_left']).toBe('Keep holding left-click to harvest')
        // placing a block / using an item swings the arm too: that is no left click
        expect(java).toContain('long started = level.getGameTime() - Math.max(0, player.swingTime) - right;')
        expect(java).toContain('if (started >= -1 && started <= 2) return null;')
        expect(java).toMatch(/static boolean use\([^)]*\) \{\s+rightClicked\(player, level\);/)
        if (loader === 'fabric' || loader === 'quilt') {
          expect(java).toContain('UseEntityCallback.EVENT.register')
          expect(java).toContain(
            p.propertiesId
              ? 'rightClicked(player, level);\n            return InteractionResult.PASS;'
              : 'InteractionResultHolder.pass(player.getItemInHand(hand))'
          )
        } else expect(java).toContain('private static void onUseItem(PlayerInteractEvent.RightClickItem event)')
        expect(regenBlocks).toMatch(/new NkwDepletedBlock\([^\n]*strength\(-1\.0F, 3600000\.0F\)[^\n]*\(\) -> ModBlocks\.REGEN_IRON_ORE(\.get\(\))?, 600\)/)
        expect(files.find((x) => x.path.endsWith('/ModItems.java'))!.text).toContain('new NkwRegenBlockItem(ModBlocks.REGEN_IRON_ORE')
        expect(text(files, '/NkwRegenBlockItem.java')).toContain('player.hasPermissions(2)')
        expect(text(files, '/NkwRegenBlock.java')).toContain('player.hasCorrectToolForDrops(from)')
        expect(text(files, p.blockMaterial ? '/NkwDepletedBlock.java' : '/ModBlocks.java')).toContain(
          p.blockMaterial ? 'PushReaction.BLOCK' : '.pushReaction(PushReaction.BLOCK)'
        )
        expect(JSON.parse(text(files, '/models/block/regen_iron_ore.json')!).parent).toBe('minecraft:block/iron_ore')
        expect(JSON.parse(text(files, '/models/block/regen_iron_ore_depleted.json')!).parent).toBe('minecraft:block/bedrock')
        expect(en['item.nkwtest.regen_name']).toBe('%s (Regenerating)')
        expect(en['itemGroup.nkwtest.regen_blocks']).toBe('Regenerating Blocks')
        expect(JSON.parse(text(files, `/${p.pluralDataDirs ? 'loot_tables' : 'loot_table'}/blocks/regen_iron_ore.json`)!).pools).toEqual([])
        expect(java).toContain('((NkwRegenBlock) state.getBlock()).harvest(level, pos, player, player.getMainHandItem(), false);')
        expect(text(files, '/NkwHarvestHud.java')).toContain(
          'state.getBlock() instanceof NkwRegenBlock ? ((NkwRegenBlock) state.getBlock()).breakUi : NkwBreakRules.timerLook(state)'
        )
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
      elements: [
        {
          from: [0, 0, 0],
          to: [8, 8, 8],
          rotation: [0, 30, 0],
          origin: [4, 4, 4],
          faces: { north: { uv: [0, 0, 16, 16], texture: 0 }, up: { uv: [0, 0, 8, 8], texture: null } }
        }
      ]
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

describe('test game settings', () => {
  it('maps keys and writes options.txt entries, keeping other lines', () => {
    expect(mcKeyFromCode('KeyW')).toBe('key.keyboard.w')
    expect(mcKeyFromCode('ShiftLeft')).toBe('key.keyboard.left.shift')
    expect(mcKeyFromCode('F5')).toBe('key.keyboard.f5')
    expect(mcKeyFromCode('MetaLeft')).toBe(null)
    expect(mcKeyFromMouse(2)).toBe('key.mouse.right')
    expect(keyLabel('key.keyboard.left.shift')).toBe('Left Shift')
    const o = GameOptionsSchema.parse({ maxFps: 60, keys: { 'key.jump': 'key.keyboard.j' } })
    expect(o.width).toBe(1280)
    const e = optionsEntries(o, 'th')
    expect(e).toMatchObject({ maxFps: '60', lang: 'th_th', 'key_key.jump': 'key.keyboard.j', 'key_key.forward': 'key.keyboard.w', overrideWidth: '1280' })
    const merged = mergeOptionsTxt('version:3955\nmaxFps:120\nfov:0.5\r\n', { maxFps: '60', lang: 'th_th' })
    expect(merged).toBe('version:3955\nmaxFps:60\nfov:0.5\nlang:th_th\n')
    // a bad value falls back to defaults instead of breaking the settings file
    expect(() => GameOptionsSchema.parse({ keys: { 'key.jump': 'rm -rf' } })).toThrow()
  })
})

describe('model editor', () => {
  it('keeps cubes valid, rotates face UVs like Minecraft and fills areas', () => {
    const c = newCube('a')
    expect(c.from).toEqual([4, 0, 4])
    // from/to swapped back, snapped to 0.25 px, kept inside −16…32
    expect(normalize({ ...c, from: [10, 0, 40], to: [2.1, 3.3, 0] })).toMatchObject({ from: [2, 0, 0], to: [10, 3.25, 32] })
    // rotation snaps to the allowed angles; 0° removes it
    expect(normalize({ ...c, rotation: { axis: 'y', angle: 30, origin: [8, 8, 8] } }).rotation!.angle).toBe(22.5)
    expect(normalize({ ...c, rotation: { axis: 'y', angle: 5, origin: [8, 8, 8] } }).rotation).toBeUndefined()
    expect(moveBy(c, [1, 2, 3])).toMatchObject({ from: [5, 2, 7], to: [13, 10, 15] })
    // automatic UV (no "uv" key) = Minecraft's default for the face
    expect(faceUv(c, 'north')).toEqual([4, 8, 12, 16])
    const plain = faceQuad({ ...c, faces: { north: { texture: '#0', uv: [0, 0, 16, 16] } } }, 'north').uv
    expect(plain).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ])
    const turned = faceQuad({ ...c, faces: { north: { texture: '#0', uv: [0, 0, 16, 16], rotation: 90 } } }, 'north').uv
    expect(turned[0]).toEqual([0, 1])
    expect(uvToPixel(0.999, 0.5, 16, 16)).toEqual([15, 8])
    const px = new Uint8ClampedArray(4 * 4 * 4)
    px.set([255, 0, 0, 255], 0) // one red pixel in the corner
    floodFill(px, 4, 4, 2, 2, [0, 0, 255, 255])
    expect(Array.from(px.slice(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(px.slice(4, 8))).toEqual([0, 0, 255, 255])
    const saved = toSaved({ ...newModel('textures/x'), elements: [{ ...c, faces: { ...c.faces, up: undefined as never } }] })
    expect(Object.keys(saved.elements![0].faces)).not.toContain('up')
    expect(saved.textures).toEqual({ '0': 'textures/x', particle: 'textures/x' })
  })
})

describe('editing generated code', () => {
  it('uses edited files instead of generated ones, only for files the generator makes', () => {
    const target = { loader: 'fabric' as const, mc: '1.21.1' }
    const { ir } = compile(project, target)
    const files = generate(ir, target, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    const mod = files.find((f) => f.path.endsWith('/NkwMod.java'))!
    const p = {
      ...project,
      overrides: {
        [overrideKey(target, mod.path)]: '// mine\n',
        [overrideKey(target, 'src/main/java/Evil.java')]: 'x',
        [overrideKey({ loader: 'forge', mc: '1.20.1' }, mod.path)]: 'other target'
      }
    }
    const { files: out, edited } = applyOverrides(files, p, target)
    expect(out.find((f) => f.path === mod.path)!.text).toBe('// mine\n')
    expect(out.some((f) => f.path.endsWith('Evil.java'))).toBe(false)
    expect([...edited]).toEqual([mod.path])
    expect(ProjectSchema.safeParse(p).success).toBe(true)
    // no ".." paths
    expect(ProjectSchema.safeParse({ ...project, overrides: { 'fabric-1.21.1:../x.java': 'x' } }).success).toBe(false)
  })
  it('unwraps cubes as unfolded boxes that fit the texture', () => {
    const a = { ...newCube('a'), from: [0, 0, 0], to: [4, 2, 4] }
    const b = { ...newCube('b'), from: [0, 0, 0], to: [2, 2, 2] }
    const [ua, ub] = boxUnwrap([a, b], [0, 1], '#0')
    expect(ua.faces.up!.uv).toEqual([4, 0, 8, 4])
    expect(ua.faces.north!.uv).toEqual([4, 4, 8, 6])
    expect(ua.faces.south!.uv).toEqual([12, 4, 16, 6])
    // the second net goes to the next row
    expect(ub.faces.east!.uv).toEqual([0, 8, 2, 10])
    // too big for 16×16: everything scaled down to fit
    const big = { ...newCube('c'), from: [-16, -16, -16], to: [32, 32, 32] }
    const [uc] = boxUnwrap([big], [0], '#0')
    expect(Math.max(...Object.values(uc.faces).flatMap((f) => f!.uv!))).toBeLessThanOrEqual(16)
  })
})

describe('model editor controls', () => {
  it('matches mouse gestures of the Blockbench, Maya and Blender presets', () => {
    const none = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false }
    expect(gestureFor(CONTROL_PRESETS.blockbench, 0, none)).toBe('orbit')
    expect(gestureFor(CONTROL_PRESETS.blockbench, 2, none)).toBe('pan')
    expect(gestureFor(CONTROL_PRESETS.maya, 0, none)).toBe(null)
    expect(gestureFor(CONTROL_PRESETS.maya, 0, { ...none, altKey: true })).toBe('orbit')
    expect(gestureFor(CONTROL_PRESETS.maya, 2, { ...none, altKey: true })).toBe('zoom')
    expect(gestureFor(CONTROL_PRESETS.blender, 1, none)).toBe('orbit')
    expect(gestureFor(CONTROL_PRESETS.blender, 1, { ...none, shiftKey: true })).toBe('pan')
    expect(CONTROL_PRESETS.maya.keys).toMatchObject({ move: 'w', rotate: 'e', scale: 'r' })
    expect(CONTROL_PRESETS.blender.keys.frame).toBe('.')
    expect(keyName('Home')).toBe('home')
    // bad bindings are refused
    expect(ModelControlsSchema.safeParse({ keys: { move: 'ctrl+w' } }).success).toBe(false)
  })
})

describe('crops', () => {
  it('replants a crop by itself after a hand harvest (one seed used)', () => {
    const p = structuredClone(project) as Project
    const wheatNode = p.graph.nodes.find((n) => n.id === 'wheat')!
    wheatNode.data.mode = 'auto'
    const { ir } = compile(p, { loader: 'fabric', mc: '1.21.1' })
    const wheat = ir.blocks.find((b) => b.id === 'ruby_wheat')!.crop!
    expect(wheat.mode).toBe('auto')
    const files = generate(ir, { loader: 'fabric', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    const java = files
      .filter((f) => f.path.endsWith('.java'))
      .map((f) => f.text)
      .join('\n')
    expect(java).toMatch(/"ruby_wheat", new NkwCropBlock\([^\n]*, true\)/)
    expect(java).toContain('crop.regrow ? 2 : crop.replant ? 1 : 0, crop.replant ? 0 : crop.regrowAge')
    // grown: the harvest and seeds back (one goes back into the ground)
    const loot = JSON.parse(files.find((f) => f.path.endsWith('/loot_table/blocks/ruby_wheat.json'))!.text!)
    expect(loot.pools[1].entries[0].children).toHaveLength(2)
    // breaking is no harvest for it: right-click is used
    wheatNode.data.input = 'break'
    expect(compile(p).diagnostics.some((d) => d.nodeId === 'wheat' && /replants itself/.test(d.message.en))).toBe(true)
  })
  it('makes growing crops with stage models, loot and hand harvesting', () => {
    const gen = (loader: 'fabric' | 'forge' | 'neoforge', mc: string) => {
      const { ir, diagnostics } = compile(project, { loader, mc })
      return { ir, diagnostics, files: generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read) }
    }
    const text = (files: { path: string; text?: string }[], end: string) => files.find((f) => f.path.endsWith(end))?.text
    const { ir, files, diagnostics } = gen('fabric', '1.21.1')
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const wheat = ir.blocks.find((b) => b.id === 'ruby_wheat')!.crop!
    expect(wheat).toMatchObject({ mode: 'replant', input: 'hold', harvestTicks: 30, growStep: 0, stages: expect.any(Array) })
    const bush = ir.blocks.find((b) => b.id === 'ruby_bush')!.crop!
    // 120 s over 7 steps; 30 s cooldown back from age 4
    expect(bush).toMatchObject({ mode: 'regrow', input: 'stand', growStep: 343, regrowAge: 4, regrowTicks: 600, look: 'cross', soil: 'dirt', adventure: false })
    // ages 0–7 spread over the 4 stage models
    const states = JSON.parse(text(files, '/blockstates/ruby_wheat.json')!)
    expect(states.variants['age=0'].model).toBe('nkwtest:block/ruby_wheat_stage0')
    expect(states.variants['age=7'].model).toBe('nkwtest:block/ruby_wheat_stage3')
    expect(JSON.parse(text(files, '/models/block/ruby_bush_stage1.json')!).parent).toBe('minecraft:block/cross')
    // loot: the harvest when grown, seeds back when grown, one seed when not
    const loot = JSON.parse(text(files, '/loot_table/blocks/ruby_wheat.json')!)
    expect(loot.pools[0].entries[0]).toMatchObject({ name: 'nkwtest:ruby', functions: [{ count: { min: 1, max: 3 } }] })
    expect(loot.pools[1].entries[0].children.map((c: { name: string }) => c.name)).toEqual(['nkwtest:ruby_wheat_seeds', 'nkwtest:ruby_wheat_seeds'])
    // a regrowing bush gives no seeds back when grown
    expect(JSON.parse(text(files, '/loot_table/blocks/ruby_bush.json')!).pools[1].entries[0].children).toHaveLength(1)
    const blocks = text(files, '/ModBlocks.java')!
    expect(blocks).toContain(
      'new NkwCropBlock(BlockBehaviour.Properties.of().noCollission().randomTicks().instabreak().sound(SoundType.CROP), false, 0, false, 0, 1200, 2, 30, 1, false, true, false)'
    )
    expect(blocks).toContain('return ModItems.RUBY_WHEAT_SEEDS;')
    expect(text(files, '/NkwCropBlock.java')).toContain('level.scheduleTick(pos, this, ticks);')
    expect(text(files, '/NkwHarvest.java')).toContain('UseBlockCallback.EVENT.register')
    expect(text(files, '/NkwClient.java')).toContain('BlockRenderLayerMap.INSTANCE.putBlock(ModBlocks.RUBY_WHEAT, RenderType.cutout());')
    expect(JSON.parse(text(files, '/lang/th_th.json')!)['message.nkwtest.harvest_moved']).toContain('ขยับ')
    // old versions: Random, getBlockTicks, Material.PLANT
    const old = gen('forge', '1.16.5').files
    expect(text(old, '/NkwCropBlock.java')).toContain('level.getBlockTicks().scheduleTick(pos, this, ticks);')
    expect(text(old, '/NkwCropBlock.java')).toContain('extends CropsBlock')
    expect(text(old, '/ModBlocks.java')).toContain('AbstractBlock.Properties.of(Material.PLANT)')
    // render type in the model on Forge 1.20.1
    expect(JSON.parse(text(gen('forge', '1.20.1').files, '/models/block/ruby_wheat_stage0.json')!).render_type).toBe('minecraft:cutout')
  })
  it("picks game and Farmer's Delight crops by hand and draws the timer looks", () => {
    const gen = (loader: 'fabric' | 'forge' | 'neoforge', mc: string) => {
      const { ir, diagnostics } = compile(project, { loader, mc })
      return { ir, diagnostics, files: generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read) }
    }
    const text = (files: { path: string; text?: string }[], end: string) => files.find((f) => f.path.endsWith(end))?.text
    const { ir, files } = gen('fabric', '1.21.1')
    const byBlock = Object.fromEntries(ir.gameCrops.map((g) => [g.block, g]))
    // "like the game": wheat breaks, berries go back to their picked stage
    expect(byBlock['minecraft:wheat']).toMatchObject({ input: 'hold', harvestTicks: 20, after: 'break' })
    expect(byBlock['minecraft:sweet_berry_bush']).toMatchObject({ input: 'click', after: 'regrow', back: 1 })
    expect(byBlock['minecraft:carrots']).toMatchObject({ after: 'replant', back: 0 })
    const harvest = text(files, '/NkwHarvest.java')!
    expect(harvest).toContain('GAME.put("minecraft:wheat", new Rule(2, 20, 0, 1, 2, true, true, false));')
    // one node, many crops (checked + typed ids), all with the same settings
    for (const id of ['farmersdelight:cabbages', 'farmersdelight:onions', 'farmersdelight:rice_panicles'])
      expect(harvest).toContain(`GAME.put("${id}", new Rule(2, 30, 1, 0, 1, false, true, false));`)
    expect(gameCropIds({ crop: 'custom', block: 'a:b, c:d' })).toEqual(['a:b', 'c:d'])
    expect(gameCropIds({})).toEqual(['minecraft:wheat'])
    expect(harvest).toContain('BuiltInRegistries.BLOCK.getKey(block)')
    expect(harvest).toContain('if (rule.give) give(player, level, pos, drops);')
    // a mod with game crops only has no NkwCropBlock: the harvest code must not use it
    const only = { ...ir, blocks: ir.blocks.filter((b) => !b.crop) }
    const onlyFiles = generate(only, { loader: 'fabric', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    expect(onlyFiles.some((f) => f.path.endsWith('/NkwCropBlock.java'))).toBe(false)
    expect(text(onlyFiles, '/NkwHarvest.java')).not.toContain('NkwCropBlock')
    const hud = text(files, '/NkwHarvestHud.java')!
    expect(hud).toContain('{ 1, 0xFFFACC15, 0x80000000, 0, 0, 80, 5, 9, 3, 1 }')
    expect(hud).toContain('{ 2, 0xFF22D3EE, 0x66000000, 0, 0, 60, 4, 10, 4, 1 }')
    expect(text(files, '/NkwClient.java')).toContain('NkwHarvestHud.init();')
    expect(JSON.parse(text(files, '/lang/th_th.json')!)['message.nkwtest.harvest_seconds']).toBe('%s วิ')
    // each loader's HUD hook
    const hook = (loader: 'forge' | 'neoforge', mc: string) => text(gen(loader, mc).files, '/NkwHarvestHud.java')!
    expect(hook('forge', '1.16.5')).toContain('import com.mojang.blaze3d.matrix.MatrixStack;')
    expect(hook('forge', '1.16.5')).toContain('AbstractGui.fill(graphics')
    expect(hook('forge', '1.19.2')).toContain('render(event.getPoseStack());')
    expect(hook('forge', '1.20.1')).toContain('render(event.getGuiGraphics());')
    expect(hook('forge', '1.21.1')).toContain('CustomizeGuiOverlayEvent.Chat event')
    expect(hook('forge', '1.21.4')).toContain('event.getLayeredDraw().add(NkwMod.id("harvest_timer")')
    expect(hook('neoforge', '1.21.1')).toContain('RenderGuiEvent.Post event')
    expect(text(gen('forge', '1.20.1').files, '/NkwMod.java')).toContain('if (FMLEnvironment.dist == Dist.CLIENT) NkwHarvestHud.init(bus);')
    expect(text(gen('forge', '1.18.2').files, '/NkwHarvest.java')).toContain('Registry.BLOCK.getKey(block)')
  })
  it('makes mobs from game bodies everywhere and from GeckoLib models on 1.20.1 / 1.21.1', () => {
    const gen = (loader: 'fabric' | 'forge', mc: string) => {
      const { ir, diagnostics } = compile(project, { loader, mc })
      return { diagnostics, files: generate(ir, { loader, mc }, { ...FALLBACK_DEPS[mc], ...deps } as never, read) }
    }
    const text = (files: { path: string; text?: string }[], end: string) => files.find((f) => f.path.endsWith(end))?.text
    const { files } = gen('fabric', '1.21.1')
    const golem = text(files, '/NkwRubyGolemEntity.java')!
    expect(golem).toContain('extends PathfinderMob implements GeoEntity')
    expect(golem).toContain('import software.bernie.geckolib.animation.AnimationController;')
    expect(golem).toContain('new HurtByTargetGoal(this)')
    expect(golem).not.toContain('NearestAttackableTargetGoal')
    expect(golem).toContain('RawAnimation.begin().thenLoop("animation.ruby_armor.idle")')
    const entities = text(files, '/ModEntities.java')!
    expect(entities).toContain('EntityType.Builder.<NkwRubyGolemEntity>of(NkwRubyGolemEntity::new, MobCategory.CREATURE).sized(0.8F, 2.0F)')
    expect(entities).toContain('Mob.createMobAttributes().add(Attributes.MAX_HEALTH, 40)')
    expect(entities).toContain('Mob::checkMobSpawnRules')
    expect(text(files, '/NkwClient.java')).toContain(
      'new GeoEntityRenderer<NkwRubyGolemEntity>(context, new DefaultedEntityGeoModel<>(NkwMod.id("ruby_golem")))'
    )
    expect(files.some((f) => f.path.endsWith('/geo/entity/ruby_golem.geo.json'))).toBe(true)
    expect(files.some((f) => f.path.endsWith('/animations/entity/ruby_golem.animation.json'))).toBe(true)
    expect(text(files, '/NkwZombieRenderer.java')).toContain('extends ZombieRenderer')
    // GeckoLib 4.4 packages on 1.20.1
    expect(text(gen('forge', '1.20.1').files, '/NkwRubyGolemEntity.java')).toContain('import software.bernie.geckolib.core.animation.AnimationController;')
    // no GeckoLib on 1.19.2: a zombie body with the skin, and a warning
    const old = gen('forge', '1.19.2')
    expect(old.files.some((f) => f.path.endsWith('/NkwRubyGolemEntity.java'))).toBe(false)
    expect(text(old.files, '/ModEntities.java')).toContain(
      'EntityType.Builder.<Zombie>of(Zombie::new, MobCategory.MONSTER).sized(0.6F, 1.95F).build("ruby_golem")'
    )
    expect(old.diagnostics.some((d) => d.nodeId === 'm_golem' && d.severity === 'warning')).toBe(true)
  })
})

describe('review fixes', () => {
  it('falls back to the default for unknown select values and escapes % in names', () => {
    const p = structuredClone(project)
    const ruby = p.graph.nodes.find((n) => n.data.id === 'ruby')!
    ruby.data.rarity = 'BOGUS'
    ruby.data.name = 'Ruby 100%'
    const { ir, diagnostics } = compile(p, { loader: 'fabric', mc: '1.21.1' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    const files = generate(ir, { loader: 'fabric', mc: '1.21.1' }, { ...FALLBACK_DEPS['1.21.1'], ...deps } as never, read)
    expect(files.find((f) => f.path.endsWith('/ModItems.java'))!.text!).not.toMatch(/bogus/i)
    const lang = JSON.parse(files.find((f) => f.path.endsWith('/lang/en_us.json'))!.text!) as Record<string, string>
    expect(lang['item.nkwtest.ruby']).toBe('Ruby 100%%')
    // creative tabs skip items that are not in the game (another mod missing)
    expect(files.find((f) => f.path.endsWith('/ModTabs.java'))!.text!).toContain('!= Items.AIR')
  })
  it('accepts Java text blocks in scripts', () => {
    expect(scriptBracketProblem('String s = """\n  } ) ]\n  """;')).toBeNull()
    expect(scriptBracketProblem('void a() { String s = """\n{\n"""; ')).not.toBeNull()
  })
  it('keeps option lines without a colon untouched', () => {
    expect(mergeOptionsTxt('version:3\nweird\n', { versio: 'x' })).toBe('version:3\nweird\nversio:x\n')
  })
  it('gives Blockbench bones unique safe names', () => {
    const bb = {
      outliner: [
        { name: 'a b', children: [] },
        { name: 'a b', children: [] }
      ]
    }
    const names = (bbmodelToGeo(JSON.stringify(bb)).geo['minecraft:geometry'][0].bones ?? []).map((b) => b.name)
    expect(names).toEqual(['a_b', 'a_b_2'])
  })
  it('keeps the tool swinging in adventure mode while a block is picked with the left button', () => {
    const p = structuredClone(project)
    p.graph.nodes.find((n) => n.id === 'regen_hold')!.data.adventure = true
    for (const target of [
      { loader: 'fabric', mc: '1.21.1' },
      { loader: 'forge', mc: '1.16.5' }
    ] as const) {
      const { ir } = compile(p, target)
      const files = generate(ir, target, { ...FALLBACK_DEPS[target.mc], ...deps } as never, read)
      const hud = files.find((f) => f.path.endsWith('/NkwHarvestHud.java'))!.text!
      expect(hud).toContain('mc.options.keyAttack.isDown()')
      expect(hud).toMatch(/NkwHarvest\.adventurePick\(mc\.level, \(\((BlockHitResult|BlockRayTraceResult)\) mc\.hitResult\)\.getBlockPos\(\)\)\)/)
      expect(hud).toContain(target.loader === 'forge' ? 'mc.player.swing(Hand.MAIN_HAND);' : 'mc.player.swing(InteractionHand.MAIN_HAND);')
      // swinging still happens with the HUD hidden (F1)
      expect(hud.indexOf('mc.player.swing(')).toBeLessThan(hud.indexOf('mc.options.hideGui'))
    }
  })
  it('puts Regenerating Blocks nodes with the same ID prefix into one creative tab', () => {
    const p = structuredClone(project)
    const ores = p.graph.nodes.find((n) => n.id === 'regen_ores')!
    p.graph.nodes.push({ ...structuredClone(ores), id: 'regen_more', position: { x: 0, y: 900 }, data: { ...ores.data, blocks: ['minecraft:gold_ore'] } })
    const { ir, diagnostics } = compile(p, { loader: 'fabric', mc: '1.21.1' })
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(ir.tabs.filter((tb) => tb.id === 'regen_blocks').length).toBe(1)
    expect(ir.tabs.find((tb) => tb.id === 'regen_blocks')!.items).toContain('nkwtest:regen_gold_ore')
    expect(ir.tabs.find((tb) => tb.id === 'regen_blocks')!.items).toContain('nkwtest:regen_iron_ore')
  })
})
