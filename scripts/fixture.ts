import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import type { GraphEdge, GraphNode, Project } from '../src/core/project'
import { NODE_DEF_MAP, defaultData } from '../src/core/nodes/defs'
import { bbmodelToGeo } from '../src/core/gen/geo'
import { PROFILES } from '../src/core/gen/profiles'
import { SCRIPT_PRESETS } from '../src/core/scriptApi'

/** A top hat made in Blockbench as a plain Java block model (no armor bones): brim + crown. */
export const HAT_BBMODEL = JSON.stringify({
  meta: { format_version: '4.10', model_format: 'java_block', box_uv: false },
  resolution: { width: 16, height: 16 },
  elements: [
    {
      name: 'brim',
      uuid: 'a',
      from: [2, 0, 2],
      to: [14, 1, 14],
      faces: Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 12, 1], texture: 0 }]))
    },
    {
      name: 'crown',
      uuid: 'b',
      from: [4, 1, 4],
      to: [12, 9, 12],
      origin: [8, 1, 8],
      rotation: [0, 0, 5],
      faces: Object.fromEntries(['north', 'south', 'east', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 4, 8, 12], texture: 0 }]))
    }
  ],
  outliner: [{ name: 'hat', origin: [8, 0, 8], children: ['a', 'b'] }],
  textures: [{ name: 'hat.png', source: '' }]
})

/** Minimal RGBA PNG encoder for fixture textures. */
export function png(w: number, h: number, color: [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4
      const shade = (x + y) % 2 ? 0.85 : 1
      raw[o] = color[0] * shade
      raw[o + 1] = color[1] * shade
      raw[o + 2] = color[2] * shade
      raw[o + 3] = color[3]
    }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const LAMP_MODEL = {
  textures: { '0': 'nkw:block/lamp', particle: 'nkw:block/lamp' },
  elements: [
    {
      from: [4, 0, 4],
      to: [12, 2, 12],
      faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 8, 2], texture: '#0' }]))
    },
    {
      from: [7, 2, 7],
      to: [9, 10, 9],
      faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 2, 8], texture: '#0' }]))
    },
    {
      from: [5, 10, 2],
      to: [11, 14, 12],
      faces: Object.fromEntries(['north', 'east', 'south', 'west', 'up', 'down'].map((f) => [f, { uv: [0, 0, 6, 4], texture: '#0' }]))
    }
  ]
}

const GEO = {
  format_version: '1.12.0',
  'minecraft:geometry': [
    {
      description: { identifier: 'geometry.ruby_armor', texture_width: 64, texture_height: 64 },
      bones: ['armorHead', 'armorBody', 'armorRightArm', 'armorLeftArm', 'armorRightLeg', 'armorLeftLeg', 'armorRightBoot', 'armorLeftBoot'].map((name) => ({
        name,
        pivot: [0, 24, 0],
        cubes: [{ origin: [-4, 24, -4], size: [8, 8, 8], uv: [0, 0] }]
      }))
    }
  ]
}

/** Builds a project folder exercising every node type. */
export function writeFixture(dir: string): Project {
  for (const d of ['textures', 'models', 'sounds', 'animations']) mkdirSync(join(dir, 'assets', d), { recursive: true })
  const tex = (name: string, c: [number, number, number, number], w = 16, h = 16) => writeFileSync(join(dir, 'assets', 'textures', `${name}.png`), png(w, h, c))
  tex('ruby', [220, 30, 60, 255])
  tex('ruby_block', [180, 20, 50, 255])
  tex('lamp', [240, 220, 120, 255])
  tex('sword', [200, 200, 220, 255])
  tex('layer1', [220, 30, 60, 255], 64, 32)
  tex('layer2', [200, 30, 60, 255], 64, 32)
  tex('geo_tex', [200, 30, 60, 255], 64, 64)
  tex('disc', [30, 30, 30, 255])
  tex('soup', [160, 110, 60, 255])
  tex('glow', [90, 220, 255, 255], 16, 64) // 4-frame animated texture
  writeFileSync(join(dir, 'assets', 'models', 'lamp.json'), JSON.stringify(LAMP_MODEL))
  writeFileSync(
    join(dir, 'assets', 'models', 'crown.json'),
    JSON.stringify({
      textures: { '0': 'nkw:block/ruby', '1': 'nkw:block/lamp' },
      elements: [
        {
          from: [4, 0, 4],
          to: [12, 3, 12],
          faces: { north: { uv: [0, 0, 8, 3], texture: '#0' }, up: { uv: [0, 0, 8, 8], texture: '#0' }, east: { texture: '#0' } }
        },
        { from: [7, 3, 7], to: [9, 5, 9], rotation: { angle: 45, axis: 'y', origin: [8, 3, 8] }, faces: { north: { uv: [0, 0, 2, 2], texture: '#1' } } }
      ]
    })
  )
  writeFileSync(join(dir, 'assets', 'models', 'ruby_armor.json'), JSON.stringify(GEO))
  mkdirSync(join(dir, 'assets', 'geo'), { recursive: true })
  writeFileSync(join(dir, 'assets', 'geo', 'top_hat.json'), JSON.stringify(bbmodelToGeo(HAT_BBMODEL, 'geometry.top_hat').geo))
  writeFileSync(
    join(dir, 'assets', 'animations', 'ruby_armor.json'),
    JSON.stringify({
      format_version: '1.8.0',
      animations: {
        'animation.ruby_armor.idle': {
          loop: true,
          animation_length: 2,
          bones: { armorHead: { rotation: { '0.0': [0, 0, 0], '1.0': [0, 10, 0], '2.0': [0, 0, 0] } } }
        }
      }
    })
  )
  writeFileSync(join(dir, 'assets', 'sounds', 'song.ogg'), Buffer.from('OggS fixture'))

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  let y = 0
  const node = (id: string, type: string, data: Record<string, unknown> = {}) => {
    nodes.push({ id, type, position: { x: 0, y: (y += 120) }, data: { ...defaultData(NODE_DEF_MAP[type]), ...data } })
    return id
  }
  const wire = (s: string, sh: string, t: string, th: string) =>
    edges.push({ id: `${s}-${sh}-${t}-${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th })

  for (const t of ['ruby', 'ruby_block', 'lamp', 'sword', 'layer1', 'layer2', 'geo_tex', 'disc', 'soup'])
    node(`tex_${t}`, 'texture', { asset: `textures/${t}.png` })
  node('m_lamp', 'model', { asset: 'models/lamp.json', textureSlots: 1 })
  wire('tex_lamp', 'out', 'm_lamp', 'tex0')
  node('geo', 'geoModel', { asset: 'models/ruby_armor.json' })
  wire('tex_geo_tex', 'out', 'geo', 'texture')
  node('snd_file', 'soundFile', { asset: 'sounds/song.ogg', seconds: 123.4 })

  node('ruby', 'item', { id: 'ruby', name: 'Ruby', nameTh: 'ทับทิม', rarity: 'uncommon' })
  wire('tex_ruby', 'out', 'ruby', 'texture')
  node('shiny', 'item', { id: 'shiny_ruby', name: 'Shiny Ruby', glint: true, maxStack: 16, fireResistant: true })
  wire('tex_ruby', 'out', 'shiny', 'texture')
  node('lamp_item', 'item', { id: 'lamp_statue', name: 'Lamp Statue', wearOnHead: true })
  wire('m_lamp', 'out', 'lamp_item', 'model')
  node('soup', 'food', { id: 'ruby_soup', name: 'Ruby Soup', nameTh: 'ซุปทับทิม', nutrition: 8, saturation: 0.6, fast: true, alwaysEdible: true, maxStack: 1 })
  wire('tex_soup', 'out', 'soup', 'texture')
  // a drink (potion-style animation and sound) and thirst values for the thirst mods
  node('juice', 'food', { id: 'ruby_juice', name: 'Ruby Juice', nutrition: 2, saturation: 0.1, alwaysEdible: true, useSound: 'drink' })
  wire('tex_soup', 'out', 'juice', 'texture')
  node('water', 'thirst', { thirst: 8, hydration: 6 })
  wire('water', 'out', 'juice', 'thirst')
  node('broth', 'thirst', { thirst: 3, hydration: 0 })
  wire('broth', 'out', 'soup', 'thirst')

  node('tm', 'toolMaterial', { id: 'ruby', level: 'diamond' })
  node('ruby_ref', 'reroute')
  wire('ruby', 'out', 'ruby_ref', 'in')
  wire('ruby_ref', 'out', 'tm', 'repair')
  for (const tt of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) {
    node(`tool_${tt}`, 'tool', { id: `ruby_${tt}`, name: `Ruby ${tt}`, toolType: tt, attackDamage: tt === 'axe' ? 6 : 1.5, attackSpeed: -3 })
    wire('tex_sword', 'out', `tool_${tt}`, 'texture')
    wire('tm', 'out', `tool_${tt}`, 'material')
  }
  // weapon abilities, durability and stat bonuses
  node('hit_fire', 'hitAbility', { ability: 'fire', seconds: 4 })
  node('hit_bolt', 'hitAbility', { ability: 'lightning', chance: 0.25 })
  node('hit_ice', 'hitAbility', { ability: 'freeze', seconds: 3 })
  wire('hit_fire', 'out', 'tool_sword', 'hit1')
  wire('hit_bolt', 'out', 'tool_sword', 'hit2')
  wire('hit_ice', 'out', 'tool_axe', 'hit1')
  // abilities when eaten
  node('hit_tp', 'hitAbility', { ability: 'teleport' })
  node('hit_clear', 'hitAbility', { ability: 'clear' })
  wire('hit_ice', 'out', 'juice', 'hit1')
  wire('hit_clear', 'out', 'juice', 'hit2')
  wire('hit_fire', 'out', 'soup', 'hit1')
  wire('hit_tp', 'out', 'soup', 'hit2')
  nodes.find((n) => n.id === 'tool_sword')!.data.durability = 3000
  nodes.find((n) => n.id === 'tool_pickaxe')!.data.unbreakable = true
  node('st_health', 'attribute', { attribute: 'max_health', amount: 4 })
  node('st_reach', 'attribute', { attribute: 'block_interaction_range', amount: 2 })
  node('st_speed', 'attribute', { attribute: 'movement_speed', amount: 0.2, operation: 'base', slot: 'hand' })
  node('st_luck', 'attribute', { attribute: 'luck', amount: -1, slot: 'inventory', tooltip: false })
  node('st_armor', 'attribute', { attribute: 'armor', amount: 2 })
  wire('st_health', 'out', 'tool_sword', 'attr1')
  wire('st_reach', 'out', 'tool_pickaxe', 'attr1')
  wire('st_speed', 'out', 'shiny', 'attr1')
  wire('st_luck', 'out', 'juice', 'attr1')

  node('blk', 'block', { id: 'ruby_block', name: 'Block of Ruby', nameTh: 'บล็อกทับทิม', tool: 'pickaxe', toolLevel: 'iron', light: 5 })
  wire('tex_ruby_block', 'out', 'blk', 'texture')
  node('pillar', 'block', { id: 'ruby_pillar', name: 'Ruby Pillar', shape: 'pillar', tool: 'none', sound: 'wood' })
  wire('tex_ruby_block', 'out', 'pillar', 'texture')
  wire('tex_ruby', 'out', 'pillar', 'top')
  node('ore', 'block', { id: 'ruby_ore', name: 'Ruby Ore', tool: 'pickaxe', toolLevel: 'stone', dropMin: 1, dropMax: 3 })
  wire('tex_ruby_block', 'out', 'ore', 'texture')
  wire('ruby', 'out', 'ore', 'drop')
  node('lamp', 'block3d', { id: 'ruby_lamp', name: 'Ruby Lamp', light: 15, tool: 'none' })
  wire('m_lamp', 'out', 'lamp', 'model')
  node('lamp2', 'block3d', { id: 'ruby_statue', name: 'Ruby Statue', rotatable: false, solid: false, tool: 'axe', sound: 'wood' })
  wire('m_lamp', 'out', 'lamp2', 'model')

  node('am', 'armorMaterial', { id: 'ruby', equipSound: 'diamond', toughness: 1 })
  wire('tex_layer1', 'out', 'am', 'layer1')
  wire('tex_layer2', 'out', 'am', 'layer2')
  wire('ruby', 'out', 'am', 'repair')
  node('set', 'armorSet', { baseId: 'ruby', name: 'Ruby', nameTh: 'ทับทิม' })
  wire('am', 'out', 'set', 'material')
  for (const s of ['helmet', 'chestplate', 'leggings', 'boots']) wire('tex_ruby', 'out', 'set', `${s}Icon`)
  node('set3d', 'armorSet', { baseId: 'dragon', name: 'Dragon', boots: false })
  wire('am', 'out', 'set3d', 'material')
  for (const s of ['helmet', 'chestplate', 'leggings']) wire('tex_ruby', 'out', 'set3d', `${s}Icon`)
  wire('geo', 'out', 'set3d', 'geo')

  node('se', 'soundEvent', { id: 'nkw_song', subtitle: 'NKW song plays', subtitleTh: 'เพลง NKW', stream: true })
  wire('snd_file', 'out', 'se', 'sound1')
  node('disc', 'musicDisc', {
    id: 'music_disc_nkw',
    name: 'Music Disc',
    song: 'NKW - Theme',
    length: 95,
    comparator: 7,
    copyright: 'free',
    onEnd: 'loop',
    range: 96
  })
  wire('se', 'out', 'disc', 'sound')
  wire('tex_disc', 'out', 'disc', 'texture')

  node('diamond', 'itemRef', { item: 'minecraft:diamond' })
  node('stick', 'itemRef', { item: 'minecraft:stick' })
  node('planks', 'tagRef', { tag: 'minecraft:planks' })
  node('bowl', 'itemRef', { item: 'minecraft:bowl' })

  node('r1', 'recipeShaped', { count: 1 })
  for (const s of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']) wire('ruby', 'out', 'r1', s)
  wire('blk', 'out', 'r1', 'result')
  // new style: ingredient pins + a grid that points at them
  node('r2', 'recipeShaped', { grid: ['', 'i1', '', '', 'i1', '', '', 'i2', ''] })
  wire('ruby', 'out', 'r2', 'i1')
  wire('stick', 'out', 'r2', 'i2')
  wire('tool_sword', 'out', 'r2', 'result')
  node('r3', 'recipeShapeless', { count: 9 })
  wire('blk', 'out', 'r3', 'i1')
  wire('ruby', 'out', 'r3', 'result')
  node('r4', 'recipeCooking', { kind: 'blasting' })
  wire('ore', 'out', 'r4', 'input')
  wire('ruby', 'out', 'r4', 'result')
  node('r5', 'recipeStonecutting', { count: 2 })
  wire('blk', 'out', 'r5', 'input')
  wire('pillar', 'out', 'r5', 'result')
  node('r6', 'recipeSmithing')
  wire('diamond', 'out', 'r6', 'base')
  wire('ruby', 'out', 'r6', 'addition')
  wire('shiny', 'out', 'r6', 'result')
  node('r7', 'recipeShapeless')
  wire('planks', 'out', 'r7', 'i1')
  wire('ruby', 'out', 'r7', 'i2')
  wire('lamp', 'out', 'r7', 'result')

  node('fd1', 'fdCutting', { tool: 'knife', count1: 2, chance2: 0.5 })
  wire('blk', 'out', 'fd1', 'input')
  wire('ruby', 'out', 'fd1', 'out1')
  wire('shiny', 'out', 'fd1', 'out2')
  node('fd2', 'fdCooking', { xp: 1.5 })
  wire('ruby', 'out', 'fd2', 'i1')
  wire('diamond', 'out', 'fd2', 'i2')
  wire('bowl', 'out', 'fd2', 'container')
  wire('soup', 'out', 'fd2', 'result')

  // ── effects, per-piece armor, animations ──
  node('fx_regen', 'effect', { effect: 'REGENERATION', level: 2, seconds: 5, chance: 0.8 })
  node('fx_poison', 'effect', { effect: 'POISON', level: 1, seconds: 4 })
  node('fx_night', 'effect', { effect: 'NIGHT_VISION', particles: false, showIcon: false, infinite: true })
  node('fx_strong', 'effect', { effect: 'DAMAGE_BOOST', level: 300, infinite: true })
  node('fx_speed', 'effect', { effect: 'MOVEMENT_SPEED', level: 2 })
  wire('fx_regen', 'out', 'soup', 'effect1')
  wire('fx_poison', 'out', 'soup', 'effect2')
  wire('fx_poison', 'out', 'tool_sword', 'effect1')
  wire('fx_speed', 'out', 'tool_axe', 'effect1')
  node('tex_glow', 'texture', { asset: 'textures/glow.png', animated: true, frameTime: 4, interpolate: true })
  node('glow_item', 'item', { id: 'glow_shard', name: 'Glow Shard' })
  wire('tex_glow', 'out', 'glow_item', 'texture')
  node('piece_helm', 'armorPiece', { id: 'ruby_crown', name: 'Ruby Crown', nameTh: 'มงกุฎทับทิม', slot: 'helmet' })
  wire('am', 'out', 'piece_helm', 'material')
  wire('tex_ruby', 'out', 'piece_helm', 'icon')
  wire('fx_night', 'out', 'piece_helm', 'effect1')
  wire('st_armor', 'out', 'piece_helm', 'attr1')
  node('anim', 'animation', { asset: 'animations/ruby_armor.json', anim: 'animation.ruby_armor.idle' })
  node('geo_anim', 'geoModel', { asset: 'models/ruby_armor.json' })
  wire('tex_geo_tex', 'out', 'geo_anim', 'texture')
  wire('anim', 'out', 'geo_anim', 'animation')
  node('piece_boots', 'armorPiece', {
    id: 'winged_boots',
    name: 'Winged Boots',
    slot: 'boots',
    iconFrom: 'model',
    fit: { offset: [0, 0, -0.5], rotation: [0, 0, 0], scale: [1.1, 1.1, 1.1] }
  })
  wire('am', 'out', 'piece_boots', 'material')
  wire('tex_ruby', 'out', 'piece_boots', 'icon')
  wire('geo_anim', 'out', 'piece_boots', 'geo')
  wire('fx_speed', 'out', 'piece_boots', 'effect1')
  // a plain Blockbench model worn as a helmet, moved / tilted / resized
  node('geo_hat', 'geoModel', { asset: 'geo/top_hat.json' })
  wire('tex_geo_tex', 'out', 'geo_hat', 'texture')
  node('piece_hat', 'armorPiece', {
    id: 'top_hat',
    name: 'Top Hat',
    slot: 'helmet',
    iconFrom: 'model',
    fit: { offset: [0, 1, 0], rotation: [0, 0, -8], scale: [1.25, 1.25, 1.25] }
  })
  wire('am', 'out', 'piece_hat', 'material')
  wire('tex_ruby', 'out', 'piece_hat', 'icon')
  wire('geo_hat', 'out', 'piece_hat', 'geo')
  // no material wired: iron stats, worn with the iron armor look
  node('piece_bare', 'armorPiece', { id: 'iron_look_cap', name: 'Iron Look Cap', slot: 'helmet' })
  wire('tex_ruby', 'out', 'piece_bare', 'icon')
  // a weapon with a 3D model in hand and a 2D icon, that can also be worn on the head
  node('tool_bare', 'tool', { id: 'plain_knife', name: 'Plain Knife', toolType: 'sword', wearOnHead: true, wearRightClick: false })
  wire('m_lamp', 'out', 'tool_bare', 'model')
  wire('tex_sword', 'out', 'tool_bare', 'texture')
  // a Java block model (.json, two textures) worn as a hat
  node('m_crown', 'model', { asset: 'models/crown.json', textureSlots: 2 })
  wire('tex_ruby', 'out', 'm_crown', 'tex0')
  wire('tex_lamp', 'out', 'm_crown', 'tex1')
  node('piece_json', 'armorPiece', { id: 'block_crown', name: 'Block Crown', slot: 'helmet', iconFrom: 'model' })
  // .json model in hand, 2D icon in the inventory
  node('piece_json2', 'armorPiece', { id: 'block_crown_flat', name: 'Block Crown (flat icon)', slot: 'helmet' })
  wire('tex_ruby', 'out', 'piece_json2', 'icon')
  wire('m_crown', 'out', 'piece_json2', 'geo')
  wire('m_crown', 'out', 'piece_json', 'geo')
  // Script nodes: both ready-made examples for every loader × version (real mod code), each logging a
  // marker when its class is loaded so the in-game smoke test can see it was registered
  for (const p of PROFILES)
    for (const loader of p.loaders)
      for (const preset of SCRIPT_PRESETS) {
        const key = `${loader}-${p.mc}`
        const code = preset
          .code({ loader, mc: p.mc })
          .replace(
            /(public class (\w+)[^{]*\{)/,
            (_m, head: string, cls: string) => `${head}\n    static {\n        NkwMod.LOGGER.info("[NKW] script loaded: ${cls}");\n    }\n`
          )
        node(`sc_${preset.id}_${key.replace(/[.-]/g, '_')}`, 'script', { targets: [key], code })
      }
  node('piece_legs', 'armorPiece', { id: 'plain_leggings', name: 'Plain Leggings', slot: 'leggings' })
  wire('am', 'out', 'piece_legs', 'material')
  wire('tex_ruby', 'out', 'piece_legs', 'icon')

  wire('fx_strong', 'out', 'soup', 'effect3')

  // ── seeds that place a crop block without its own item ──
  node('crop', 'block', { id: 'ruby_crop', name: 'Ruby Crop', hasItem: false, tool: 'none', hardness: 0 })
  wire('tex_ruby_block', 'out', 'crop', 'texture')
  node('seeds', 'item', { id: 'ruby_seeds', name: 'Ruby Seeds' })
  wire('tex_ruby', 'out', 'seeds', 'texture')
  wire('crop', 'block', 'seeds', 'places')
  node('berries', 'food', { id: 'ruby_berries', name: 'Ruby Berries', nutrition: 2 })
  wire('tex_ruby', 'out', 'berries', 'texture')
  wire('blk', 'block', 'berries', 'places')

  // ── real crops: wheat-like (replant, hold to harvest) and a bush that grows back (stand still) ──
  node('wheat', 'crop', {
    id: 'ruby_wheat',
    name: 'Ruby Wheat',
    nameTh: 'ข้าวทับทิม',
    input: 'hold',
    harvestSeconds: 1.5,
    produceMax: 3,
    seedMax: 2,
    breakDrops: 'grown'
  })
  ;['tex_soup', 'tex_lamp', 'tex_ruby_block', 'tex_ruby'].forEach((tx, i) => wire(tx, 'out', 'wheat', `stage${i + 1}`))
  wire('ruby', 'out', 'wheat', 'produce')
  node('wheat_seeds', 'item', { id: 'ruby_wheat_seeds', name: 'Ruby Wheat Seeds' })
  wire('tex_soup', 'out', 'wheat_seeds', 'texture')
  wire('wheat', 'block', 'wheat_seeds', 'places')
  node('bush', 'crop', {
    id: 'ruby_bush',
    name: 'Ruby Bush',
    look: 'cross',
    soil: 'dirt',
    growSeconds: 120,
    mode: 'regrow',
    regrowSeconds: 30,
    regrowStage: 4,
    input: 'stand',
    harvestSeconds: 2,
    breakDrops: 'none',
    adventure: false
  })
  ;['tex_soup', 'tex_ruby'].forEach((tx, i) => wire(tx, 'out', 'bush', `stage${i + 1}`))
  node('bush_berry', 'food', { id: 'ruby_bush_berry', name: 'Ruby Bush Berry', nutrition: 2 })
  wire('tex_ruby', 'out', 'bush_berry', 'texture')
  wire('bush', 'block', 'bush_berry', 'places')
  wire('bush_berry', 'out', 'bush', 'produce')
  // harvest timer looks: a bar under the crosshair and a circle around it
  node('ui_bar', 'harvestUi', { style: 'bar', color: '#facc15', width: 80, height: 5 })
  node('ui_ring', 'harvestUi', { style: 'ring', color: '#22d3ee', radius: 10, thickness: 4, backOpacity: 40 })
  wire('ui_bar', 'out', 'wheat', 'ui')
  wire('ui_ring', 'out', 'bush', 'ui')
  // game crops picked by hand: like the game, replanting itself, going back to a stage, Farmer's Delight
  node('g_wheat', 'gameCrop', { crops: undefined, crop: 'minecraft:wheat', input: 'hold', harvestSeconds: 1, after: 'normal', give: true })
  wire('ui_ring', 'out', 'g_wheat', 'ui')
  node('g_carrots', 'gameCrop', {
    crops: undefined,
    crop: 'minecraft:carrots',
    input: 'stand',
    harvestSeconds: 1,
    after: 'replant',
    give: true,
    breakDrops: 'none'
  })
  node('g_berries', 'gameCrop', { crops: undefined, crop: 'minecraft:sweet_berry_bush', input: 'click', after: 'normal' })
  node('g_beet', 'gameCrop', { crops: undefined, crop: 'minecraft:beetroots', input: 'hold', after: 'regrow', backStage: 1 })
  wire('ui_bar', 'out', 'g_beet', 'ui')
  node('g_cabbage', 'gameCrop', {
    crops: ['farmersdelight:cabbages', 'farmersdelight:onions'],
    others: 'farmersdelight:rice_panicles',
    input: 'hold',
    harvestSeconds: 1.5,
    after: 'replant'
  })
  wire('ui_bar', 'out', 'g_cabbage', 'ui')

  // ── break rules: game blocks, another mod's block, a tag and wired mod blocks ──
  node('rule_iron', 'breakRule', {
    blocks: ['minecraft:stone', 'minecraft:deepslate', 'othermod:ruby_ore', '#minecraft:logs', 'nkwtest:ruby_pillar'],
    tool: 'pickaxe',
    level: 'iron',
    onFail: 'noDrop',
    messageTh: 'ต้องใช้อีเต้อเหล็ก 100%',
    timer: true,
    adventure: true
  })
  wire('ui_ring', 'out', 'rule_iron', 'ui')
  wire('blk', 'block', 'rule_iron', 'block1')
  wire('lamp', 'block', 'rule_iron', 'block2')
  node('rule_axe', 'breakRule', { blocks: ['minecraft:oak_planks'], tool: 'axe', level: 'diamond', onFail: 'cantBreak', timer: true })
  node('rule_shears', 'breakRule', { blocks: ['minecraft:white_wool'], tool: 'shears', onFail: 'cantBreak', message: false })
  node('rule_sword', 'breakRule', { blocks: ['minecraft:cobweb'], tool: 'sword', level: 'netherite' })
  node('rule_any', 'breakRule', { blocks: ['minecraft:obsidian'], tool: 'any', level: 'diamond' })

  // ── mobs: game bodies with a skin, spawn eggs, drops, natural spawning ──
  node('m_zombie', 'mob', {
    id: 'ruby_zombie',
    name: 'Ruby Zombie',
    nameTh: 'ซอมบี้ทับทิม',
    body: 'zombie',
    health: 30,
    attack: 5,
    spawn: 'overworld',
    weight: 30
  })
  wire('tex_ruby', 'out', 'm_zombie', 'skin')
  wire('ruby', 'out', 'm_zombie', 'drop1')
  node('m_spider', 'mob', { id: 'ruby_spider', name: 'Ruby Spider', body: 'spider', spawn: 'nether' })
  wire('tex_ruby_block', 'out', 'm_spider', 'skin')
  node('m_cow', 'mob', { id: 'ruby_cow', name: 'Ruby Cow', body: 'cow', health: 12 })
  wire('tex_soup', 'out', 'm_cow', 'skin')
  node('m_skel', 'mob', { id: 'ruby_skeleton', name: 'Ruby Skeleton', body: 'skeleton' })
  wire('tex_lamp', 'out', 'm_skel', 'skin')
  node('m_pig', 'mob', { id: 'ruby_pig', name: 'Ruby Pig', body: 'pig', spawn: 'overworld' })
  wire('tex_soup', 'out', 'm_pig', 'skin')
  // a GeckoLib 3D mob (1.20.1 / 1.21.1; other versions use a zombie body with the model's texture)
  node('m_golem', 'mob', {
    id: 'ruby_golem',
    name: 'Ruby Golem',
    body: 'model3d',
    behavior: 'neutral',
    health: 40,
    attack: 6,
    width: 0.8,
    height: 2,
    idleAnim: 'animation.ruby_armor.idle',
    spawn: 'overworld',
    weight: 10
  })
  wire('geo_anim', 'out', 'm_golem', 'geo')
  wire('tex_ruby', 'out', 'm_golem', 'skin')

  // ── 3D item with a separate 2D inventory icon ──
  node('statue_icon', 'item', { id: 'lamp_trophy', name: 'Lamp Trophy' })
  wire('m_lamp', 'out', 'statue_icon', 'model')
  wire('tex_lamp', 'out', 'statue_icon', 'texture')

  // ── creative tabs: one with a logo texture + items, one with an item icon ──
  node('tab', 'creativeTab', { id: 'main', title: 'NKW Test', titleTh: 'ทดสอบ NKW' })
  wire('tex_disc', 'out', 'tab', 'logo')
  ;['ruby', 'shiny', 'blk', 'soup', 'diamond', 'seeds'].forEach((it, i) => wire(it, 'out', 'tab', `item${i + 1}`))
  node('tab2', 'creativeTab', { id: 'gear', title: 'NKW Gear' })
  wire('tool_sword', 'out', 'tab2', 'icon')
  for (const it of ['tool_sword', 'tool_pickaxe', 'piece_helm']) wire(it, 'out', 'tab2', 'items')
  wire('set', 'helmet', 'tab2', 'items')
  node('note', 'comment', { text: 'fixture' })

  const project: Project = {
    schemaVersion: 1,
    meta: {
      name: 'NKW Test Mod',
      modId: 'nkwtest',
      version: '1.0.0',
      authors: 'Nam Kueap Wan (NKW)',
      description: 'Fixture "quoted" \\ mod',
      license: 'MIT',
      homepage: 'https://example.com/nkw',
      issues: 'https://example.com/nkw/issues',
      credits: [
        { name: 'Ruby "Artist"', work: 'Ruby texture', link: 'https://example.com/ruby', assets: ['textures/ruby.png'], folders: ['textures'] },
        { name: 'No Link', work: '', link: 'not a link' },
        { name: '  ', work: 'half-typed row', link: '' }
      ]
    },
    targets: [{ loader: 'fabric', mc: '1.21.1' }],
    activeTarget: 0,
    graph: { nodes, edges }
  }
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2))
  return project
}
