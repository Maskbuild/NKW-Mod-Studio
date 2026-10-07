import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { compile } from '../src/core/compile/compile'
import { enableFirstParty } from '../src/core/ext/firstparty'
import { FALLBACK_DEPS, TOOL_VERSIONS, generate } from '../src/core/gen/index'
import { figuraAvatars } from '../src/core/figura'
import type { Project } from '../src/core/project'
import { node, skinsProject } from './helpers/skinsProject'

enableFirstParty()

const project = skinsProject

const gen = (p: Project, loader: 'fabric' | 'quilt' | 'neoforge' | 'forge', mc: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'nkw-skins-'))
  mkdirSync(join(dir, 'assets/textures'), { recursive: true })
  const target = { loader, mc }
  const { ir, diagnostics } = compile(p, target)
  const files = generate(
    ir,
    target,
    { ...TOOL_VERSIONS, ...FALLBACK_DEPS[mc], gradle: '8.14.3' },
    { readText: (a) => readFileSync(join(dir, 'assets', a), 'utf8') }
  )
  return { ir, diagnostics, files, text: (end: string) => files.find((f) => f.path.endsWith(end))?.text }
}

describe('Skins extension', () => {
  it('turns Skin nodes and the wardrobe into records, a block and diagnostics', () => {
    const { ir, diagnostics } = gen(project(), 'fabric', '1.21.1')
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(ir.ext.skins.skins.map((s) => [s.id, s.slim])).toEqual([
      ['skin_0', false],
      ['skin_1', true]
    ])
    expect(ir.ext.skins.wardrobes[0]).toMatchObject({ key: 'K', stationEnabled: true, stationTexture: 'textures/station.png' })
    const block = ir.blocks.find((b) => b.id === 'wardrobe')!
    expect(block).toMatchObject({ javaClass: 'NkwSkinStationBlock', hasItem: true, textures: { side: 'textures/station.png' } })
  })

  it('reports mistakes in the nodes', () => {
    const p = project()
    p.graph.nodes.push(
      node('dup', 'skin', { id: 'skin_0', file: 'textures/x.png' }),
      node('empty', 'skin', { id: 'skin_9', file: '' }),
      node('w2', 'skinWardrobe', { key: '!' })
    )
    const msgs = gen(p, 'fabric', '1.21.1').diagnostics.map((d) => d.message.en)
    expect(msgs).toContain('Duplicate skin ID "skin_0"')
    expect(msgs).toContain('Choose the skin file')
    expect(msgs).toContain('Only one Skin wardrobe is allowed')
    expect(msgs).toContain('The key must be one letter or digit')
    expect(gen(project({ stationEnabled: true }), 'fabric', '1.21.1').diagnostics.some((d) => d.severity === 'error')).toBe(false)
  })

  it('generates the classes, mixins, textures, lang and metadata for Fabric', () => {
    const g = gen(project(), 'fabric', '1.21.1')
    for (const c of ['NkwSkins', 'NkwSkinCommands', 'NkwSkinsClient', 'NkwWardrobeScreen', 'NkwSkinStationBlock', 'NkwSkinsFabric', 'NkwSkinsFabricClient'])
      expect(g.text(`/${c}.java`), c).toContain(`class ${c}`)
    expect(g.text('/mixin/PlayerMixin.java')).toContain('package com.nkw.skintest.mixin;')
    expect(g.text('/mixin/PlayerMixin.java')).toContain('SynchedEntityData.Builder builder')
    expect(g.text('/mixin/AbstractClientPlayerMixin.java')).toContain('"getSkin"')
    expect(g.text('/NkwSkins.java')).toContain(
      'new Skin("skin_0", "Skin 0", "\\u0e2a\\u0e01\\u0e34\\u0e19 0", NkwMod.id("textures/skins/skin_0.png"), NkwMod.id("textures/skins/skin_0_open.png"), false),'
    )
    expect(g.text('/NkwSkins.java')).toContain('NkwMod.id("textures/skins/skin_1.png"), null, true)')
    expect(JSON.parse(g.text('skintest.skins.mixins.json')!)).toMatchObject({
      package: 'com.nkw.skintest.mixin',
      compatibilityLevel: 'JAVA_21',
      mixins: ['PlayerMixin'],
      client: ['AbstractClientPlayerMixin']
    })
    expect(JSON.parse(g.text('/fabric.mod.json')!).mixins).toEqual(['skintest.skins.mixins.json'])
    expect(g.files.filter((f) => f.copy).map((f) => `${f.path.split('/').slice(-2).join('/')} <- ${f.copy}`)).toEqual(
      expect.arrayContaining([
        'skins/skin_0.png <- textures/skin0.png',
        'skins/skin_0_open.png <- textures/skin0_open.png',
        'skins/skin_1.png <- textures/skin1.png'
      ])
    )
    const lang = JSON.parse(g.text('/lang/en_us.json')!)
    expect(lang['skin.skintest.skin_1']).toBe('Skin 1')
    expect(lang['gui.skintest.wardrobe']).toBe('Wardrobe')
    expect(lang['key.skintest.wardrobe']).toBe('Open the wardrobe')
    expect(g.text('/NkwMod.java')).toContain('NkwSkinsFabric.init();')
    expect(g.text('/NkwClient.java')).toContain('NkwSkinsFabricClient.init();')
    expect(g.text('/ModBlocks.java')).toContain('new NkwSkinStationBlock(')
    expect(g.text('/NkwSkinsFabricClient.java')).toContain("(int) 'K'")
  })

  it('uses the right game API for each version', () => {
    expect(gen(project(), 'fabric', '1.20.1').text('/mixin/AbstractClientPlayerMixin.java')).toContain('"getSkinTextureLocation"')
    expect(gen(project(), 'fabric', '1.20.1').text('/mixin/PlayerMixin.java')).toContain('.define(com.nkw.skintest.NkwSkins.SKIN')
    expect(gen(project(), 'fabric', '1.20.4').text('/NkwSkinStationBlock.java')).toContain('public InteractionResult use(')
    expect(gen(project(), 'fabric', '1.21.1').text('/NkwSkinStationBlock.java')).toContain('useWithoutItem(')
  })

  it('works on NeoForge with its own events and metadata', () => {
    const g20 = gen(project(), 'neoforge', '1.20.4')
    expect(g20.text('/NkwSkinsNeo.java')).toContain('TickEvent.ServerTickEvent')
    expect(g20.text('/NkwSkinsNeoClient.java')).toContain('TickEvent.ClientTickEvent')
    expect(g20.text('/META-INF/mods.toml')).toContain('[[mixins]]\nconfig="skintest.skins.mixins.json"')
    const g21 = gen(project(), 'neoforge', '1.21.1')
    expect(g21.text('/NkwSkinsNeo.java')).toContain('ServerTickEvent.Post')
    expect(g21.text('/META-INF/neoforge.mods.toml')).toContain('[[mixins]]')
    expect(g21.text('/NkwMod.java')).toContain('NkwSkinsNeo.init();')
    expect(g21.text('/NkwMod.java')).toContain('NkwSkinsNeoClient.init(bus);')
    expect(g21.text('/NkwSkinsFabric.java')).toBeUndefined()
  })

  it('adds nothing without a wardrobe or without skins, and warns on unsupported targets', () => {
    const none = gen(project({}, 0), 'fabric', '1.21.1')
    expect(none.text('/NkwSkins.java')).toBeUndefined()
    expect(none.files.some((f) => f.path.endsWith('.mixins.json'))).toBe(false)
    expect(none.text('/fabric.mod.json')).not.toContain('mixins')
    for (const [loader, mc] of [
      ['forge', '1.20.1'],
      ['fabric', '1.21.4'],
      ['fabric', '1.19.2']
    ] as const) {
      const g = gen(project(), loader, mc)
      expect(g.text('/NkwSkins.java'), `${loader} ${mc}`).toBeUndefined()
      expect(g.diagnostics.some((d) => d.severity === 'warning' && /Skins does not support/.test(d.message.en))).toBe(true)
    }
  })

  it('writes the generated Java where a syntax check can read it', () => {
    const g = gen(project(), 'fabric', '1.21.1')
    const dir = mkdtempSync(join(tmpdir(), 'nkw-skins-java-'))
    const list = g.files
      .filter((f) => f.path.endsWith('.java') && f.text)
      .map((f) => {
        const p = join(dir, f.path.split('/').join('_'))
        writeFileSync(p, f.text!)
        return p
      })
    expect(list.length).toBeGreaterThan(10)
  })

  it('makes one Figura avatar per set with the pictures and a script', () => {
    const skin = (id: string, set: string, openFile = '') => ({ id, name: `Skin "${id}"`, file: `textures/${id}.png`, openFile, slim: false, set })
    const avatars = figuraAvatars(
      [skin('a', 'Day'), skin('b', 'Day', 'textures/b_open.png'), skin('c', ''), skin('d', 'day'), { ...skin('e', 'x'), file: '' }, skin('Bad Id', 'x')],
      { name: 'My Mod', authors: 'Ann, Bob' }
    )
    expect(avatars.map((a) => a.dir)).toEqual(['day', 'all', 'day_2'])
    const day = avatars[0]
    expect(day.files.map((f) => f.path)).toEqual(['avatar.json', 'skin_a.png', 'skin_b.png', 'skin_b_open.png', 'script.lua'])
    expect(JSON.parse(day.files[0].text!)).toMatchObject({ name: 'My Mod - Day', authors: ['Ann', 'Bob'] })
    expect(day.files.find((f) => f.path === 'skin_b_open.png')!.copy).toBe('textures/b_open.png')
    const lua = day.files.find((f) => f.path === 'script.lua')!.text!
    expect(lua).toContain('{ name = "Skin \\"a\\"", texture = "skin_a" }')
    expect(lua).toContain('open = "skin_b_open"')
    expect(lua).toContain('renderer:setPrimaryTexture("CUSTOM"')
  })
})
