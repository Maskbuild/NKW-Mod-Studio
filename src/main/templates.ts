import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { NODE_DEF_MAP, defaultData } from '@core/nodes/defs'
import type { GraphEdge, GraphNode, Project } from '@core/project'
import { encodePng, placeholder } from './services/png'

export const TEMPLATE_IDS = ['empty', 'starter', 'armor', 'music', 'farmersDelight'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

interface Builder {
  nodes: GraphNode[]
  edges: GraphEdge[]
  files: { asset: string; data: Buffer }[]
  node(type: string, col: number, row: number, data?: Record<string, unknown>): string
  wire(s: string, sh: string, t: string, th: string): void
  tex(name: string, data: Buffer, col: number, row: number): string
}

function builder(): Builder {
  let n = 0
  const b: Builder = {
    nodes: [],
    edges: [],
    files: [],
    node(type, col, row, data = {}) {
      const id = `n${++n}`
      b.nodes.push({ id, type, position: { x: col * 320, y: row * 150 }, data: { ...defaultData(NODE_DEF_MAP[type]), ...data } })
      return id
    },
    wire(s, sh, t, th) {
      b.edges.push({ id: `e_${s}_${sh}_${t}_${th}`, source: s, sourceHandle: sh, target: t, targetHandle: th })
    },
    tex(name, data, col, row) {
      b.files.push({ asset: `textures/${name}.png`, data })
      return b.node('texture', col, row, { asset: `textures/${name}.png` })
    }
  }
  return b
}

function build(id: TemplateId, modName: string): Builder {
  const b = builder()
  const tab = () => b.node('creativeTab', 5, 0, { title: modName })
  switch (id) {
    case 'empty': {
      b.node('comment', 0, 0, {
        text: 'Right-click or press Space to add nodes.\nคลิกขวาหรือกด Space เพื่อเพิ่มโหนด',
        color: '#6b7280'
      })
      tab()
      break
    }
    case 'starter': {
      const tGem = b.tex('ruby', placeholder('gem', [220, 40, 70]), 0, 0)
      const tBlock = b.tex('ruby_block', placeholder('block', [200, 40, 70]), 0, 2)
      const tSword = b.tex('ruby_sword', placeholder('sword', [230, 70, 90]), 0, 4)
      const ruby = b.node('item', 1, 0, { id: 'ruby', name: 'Ruby', nameTh: 'ทับทิม' })
      b.wire(tGem, 'out', ruby, 'texture')
      const block = b.node('block', 1, 2, { id: 'ruby_block', name: 'Block of Ruby', nameTh: 'บล็อกทับทิม', tool: 'pickaxe', toolLevel: 'iron', hardness: 5 })
      b.wire(tBlock, 'out', block, 'texture')
      const mat = b.node('toolMaterial', 1, 5, { id: 'ruby', level: 'diamond', durability: 1200, speed: 8, damage: 3 })
      b.wire(ruby, 'out', mat, 'repair')
      const sword = b.node('tool', 2, 4, { id: 'ruby_sword', name: 'Ruby Sword', nameTh: 'ดาบทับทิม', toolType: 'sword', attackDamage: 3, attackSpeed: -2.4 })
      b.wire(tSword, 'out', sword, 'texture')
      const slow = b.node('effect', 1, 3.6, { effect: 'MOVEMENT_SLOWDOWN', level: 1, seconds: 3, chance: 0.5 })
      b.wire(slow, 'out', sword, 'effect1')
      b.wire(mat, 'out', sword, 'material')
      const r1 = b.node('recipeShaped', 3, 0)
      for (let i = 1; i <= 9; i++) b.wire(ruby, 'out', r1, `s${i}`)
      b.wire(block, 'out', r1, 'result')
      const r2 = b.node('recipeShapeless', 3, 3, { count: 9 })
      b.wire(block, 'out', r2, 'i1')
      b.wire(ruby, 'out', r2, 'result')
      const stick = b.node('itemRef', 2, 6, { item: 'minecraft:stick' })
      const r3 = b.node('recipeShaped', 4, 5)
      b.wire(ruby, 'out', r3, 's2')
      b.wire(ruby, 'out', r3, 's5')
      b.wire(stick, 'out', r3, 's8')
      b.wire(sword, 'out', r3, 'result')
      const t = tab()
      b.wire(ruby, 'out', t, 'icon')
      for (const it of [ruby, block, sword]) b.wire(it, 'out', t, 'items')
      break
    }
    case 'armor': {
      const tGem = b.tex('sapphire', placeholder('gem', [40, 90, 220]), 0, 0)
      const l1 = b.tex('sapphire_layer_1', placeholder('armor', [40, 90, 220], 64, 32), 0, 2)
      const l2 = b.tex('sapphire_layer_2', placeholder('armor', [30, 70, 190], 64, 32), 0, 3)
      const gem = b.node('item', 1, 0, { id: 'sapphire', name: 'Sapphire', nameTh: 'ไพลิน' })
      b.wire(tGem, 'out', gem, 'texture')
      const mat = b.node('armorMaterial', 1, 2, { id: 'sapphire', durability: 25, equipSound: 'diamond', toughness: 1 })
      b.wire(l1, 'out', mat, 'layer1')
      b.wire(l2, 'out', mat, 'layer2')
      b.wire(gem, 'out', mat, 'repair')
      // One node per piece, so each can get its own 3D model, animation and effects.
      const PIECES = [
        ['helmet', 'Helmet', 'หมวก'],
        ['chestplate', 'Chestplate', 'เสื้อเกราะ'],
        ['leggings', 'Leggings', 'กางเกงเกราะ'],
        ['boots', 'Boots', 'รองเท้า']
      ] as const
      const pieces = PIECES.map(([slot, en, th], i) => {
        const icon = b.tex(`sapphire_${slot}`, placeholder('armor', [40, 90, 220]), 1, 4 + i * 1.6)
        const piece = b.node('armorPiece', 2, 4 + i * 1.6, { id: `sapphire_${slot}`, name: `Sapphire ${en}`, nameTh: `${th}ไพลิน`, slot })
        b.wire(mat, 'out', piece, 'material')
        b.wire(icon, 'out', piece, 'icon')
        return piece
      })
      const nightVision = b.node('effect', 1, 11, { effect: 'NIGHT_VISION', level: 1, particles: false })
      b.wire(nightVision, 'out', pieces[0], 'effect1')
      const speed = b.node('effect', 1, 12.2, { effect: 'MOVEMENT_SPEED', level: 1, particles: false })
      b.wire(speed, 'out', pieces[3], 'effect1')
      const r = b.node('recipeShaped', 3, 0)
      for (const s of ['s1', 's2', 's3', 's4', 's6']) b.wire(gem, 'out', r, s)
      b.wire(pieces[0], 'out', r, 'result')
      const t = tab()
      b.wire(pieces[1], 'out', t, 'icon')
      for (const it of [gem, ...pieces]) b.wire(it, 'out', t, 'items')
      break
    }
    case 'music': {
      b.node('comment', 0, -1, { text: 'Import your .ogg song into the Sound File node.\nนำเข้าไฟล์เพลง .ogg ในโหนดไฟล์เสียง', color: '#10b981' })
      const file = b.node('soundFile', 0, 0)
      const ev = b.node('soundEvent', 1, 0, { id: 'nkw_theme', subtitle: 'NKW theme plays', subtitleTh: 'เพลงธีม NKW กำลังเล่น', stream: true })
      b.wire(file, 'out', ev, 'sound1')
      const tDisc = b.tex('music_disc_nkw', placeholder('disc', [230, 60, 60]), 1, 2)
      const disc = b.node('musicDisc', 2, 1, { id: 'music_disc_nkw', name: 'Music Disc', nameTh: 'แผ่นเพลง', song: 'Nam Kueap Wan - Theme', length: 120 })
      b.wire(ev, 'out', disc, 'sound')
      b.wire(tDisc, 'out', disc, 'texture')
      const t = tab()
      b.wire(disc, 'out', t, 'icon')
      b.wire(disc, 'out', t, 'items')
      break
    }
    case 'farmersDelight': {
      const tSoup = b.tex('tom_yum', placeholder('food', [230, 120, 40]), 0, 0)
      const soup = b.node('food', 1, 0, { id: 'tom_yum', name: 'Tom Yum', nameTh: 'ต้มยำ', nutrition: 10, saturation: 0.8, maxStack: 16 })
      b.wire(tSoup, 'out', soup, 'texture')
      const regen = b.node('effect', 0, 1.3, { effect: 'REGENERATION', level: 1, seconds: 8 })
      b.wire(regen, 'out', soup, 'effect1')
      const shrimp = b.node('itemRef', 1, 2, { item: 'minecraft:cod' })
      const kelp = b.node('itemRef', 1, 3, { item: 'minecraft:kelp' })
      const bowl = b.node('itemRef', 1, 4, { item: 'minecraft:bowl' })
      const pot = b.node('fdCooking', 2, 1, { xp: 1, time: 200 })
      b.wire(shrimp, 'out', pot, 'i1')
      b.wire(kelp, 'out', pot, 'i2')
      b.wire(bowl, 'out', pot, 'container')
      b.wire(soup, 'out', pot, 'result')
      const cut = b.node('fdCutting', 2, 4, { tool: 'knife', count1: 2 })
      b.wire(soup, 'out', cut, 'input')
      b.wire(kelp, 'out', cut, 'out1')
      const t = tab()
      b.wire(soup, 'out', t, 'icon')
      b.wire(soup, 'out', t, 'items')
      break
    }
  }
  return b
}

/** Fills a freshly created project with a template graph and its placeholder textures. */
export async function applyTemplate(dir: string, project: Project, id: TemplateId): Promise<Project> {
  const b = build(id, project.meta.name)
  for (const f of b.files) await writeFile(join(dir, 'assets', f.asset), f.data)
  return { ...project, graph: { nodes: b.nodes, edges: b.edges } }
}

export const NKW_ICON = () =>
  encodePng(64, 64, (x, y) => {
    const inside = x > 6 && x < 57 && y > 6 && y < 57
    return inside ? ((x >> 3) + (y >> 3)) % 2 ? [20, 20, 20, 255] : [245, 245, 245, 255] : [0, 0, 0, 0]
  })
