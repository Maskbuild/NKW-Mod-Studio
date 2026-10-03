import { ASSET_RE, ID_RE, NSID_RE, type GraphNode, type Project, type Target } from '../project'
import { parseFit } from '../gen/geo'
import { isReservedClass, scriptAppliesTo, scriptClassName, scriptEntrypoints } from '../scriptApi'
import { ATTRIBUTES, BREAK_TOOLS, EFFECTS, NODE_DEF_MAP, TOOL_LEVELS, breakRuleEntries, canConnect, gameCropIds, pinOf, type L10n } from '../nodes/defs'
import type {
  ArmorMatIR,
  ArmorSlot,
  AttrSlot,
  AttributeIR,
  BlockIR,
  Diagnostic,
  EffectIR,
  GeoRef,
  HitIR,
  Ingredient,
  ItemIR,
  MobIR,
  ModIR,
  ModelRef,
  SoundIR,
  ThirstIR,
  ToolMatIR
} from '../ir'
import type { BreakDrops, BreakRuleIR, GameCropIR, HarvestUiIR } from '../ir'
import { farmersDelightFor, getProfile, isSupported, mcAtLeast } from '../gen/profiles'
import { separateIconMode } from '../gen/assets'

const ARMOR_SLOTS: ArmorSlot[] = ['helmet', 'chestplate', 'leggings', 'boots']
const ARMOR_NAME: Record<ArmorSlot, L10n> = {
  helmet: { en: 'Helmet', th: 'หมวก' },
  chestplate: { en: 'Chestplate', th: 'เสื้อเกราะ' },
  leggings: { en: 'Leggings', th: 'กางเกงเกราะ' },
  boots: { en: 'Boots', th: 'รองเท้า' }
}

type Data = Record<string, unknown>
export const str = (d: Data, k: string, def = ''): string => (typeof d[k] === 'string' ? (d[k] as string) : def)
export const num = (d: Data, k: string, def = 0): number => (typeof d[k] === 'number' && Number.isFinite(d[k]) ? (d[k] as number) : def)
const bool = (d: Data, k: string, def = false): boolean => (typeof d[k] === 'boolean' ? (d[k] as boolean) : def)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** Whole number in a range (counts, protection points … that the game reads as integers). */
const int = (d: Data, k: string, def: number, lo: number, hi: number) => clamp(Math.round(num(d, k, def)), lo, hi)
/** A select setting: one of the options the node definition offers, else its default (old or edited data). */
const sel = <T extends string = string>(n: GraphNode, key: string): T => {
  const p = NODE_DEF_MAP[n.type]?.props.find((x) => x.key === key)
  const v = str(n.data, key)
  return (p?.options?.some((o) => o.value === v) ? v : String(p?.default ?? '')) as T
}

export interface CompileResult {
  ir: ModIR
  diagnostics: Diagnostic[]
}

/** Material id used by tools / armor with no material wired in (iron stats). */
const DEFAULT_MAT = 'nkw_iron'

/**
 * Brackets / quotes the generated Java would choke on, found before building (Gradle would report the
 * same, much later). Skips strings, chars and comments.
 */
export function scriptBracketProblem(code: string): { en: string; th: string; line: number } | null {
  const stack: { ch: string; line: number }[] = []
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let line = 1
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '\n') line++
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++
      line++
      continue
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2)
      if (end < 0) return { en: `unclosed comment (line ${line})`, th: `คอมเมนต์ไม่ได้ปิด (บรรทัด ${line})`, line }
      line += code.slice(i, end).split('\n').length - 1
      i = end + 1
      continue
    }
    // Java text block: """ … """
    if (code.startsWith('"""', i)) {
      const end = code.indexOf('"""', i + 3)
      if (end < 0) return { en: `unclosed text block (line ${line})`, th: `ข้อความหลายบรรทัด (""") ไม่ได้ปิด (บรรทัด ${line})`, line }
      line += code.slice(i, end).split('\n').length - 1
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < code.length && code[j] !== c && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1
      if (code[j] !== c)
        return {
          en: `unclosed ${c === '"' ? 'string' : 'character'} (line ${line})`,
          th: `${c === '"' ? 'ข้อความ' : 'ตัวอักษร'}ไม่ได้ปิดเครื่องหมายคำพูด (บรรทัด ${line})`,
          line
        }
      i = j
      continue
    }
    if (c === '(' || c === '[' || c === '{') stack.push({ ch: c, line })
    else if (c in pairs) {
      const top = stack.pop()
      if (!top || top.ch !== pairs[c]) return { en: `unexpected "${c}" (line ${line})`, th: `มี "${c}" เกินมา (บรรทัด ${line})`, line }
    }
  }
  const open = stack.pop()
  return open ? { en: `"${open.ch}" is never closed (line ${open.line})`, th: `"${open.ch}" ยังไม่ได้ปิด (บรรทัด ${open.line})`, line: open.line } : null
}

/** Blocks you can see through: copies of them must not hide the faces of their neighbours. */
const SEE_THROUGH =
  /glass|leaves|ice$|^ice|slime|honey|_pane|bars|door|fence|wall|slab|stairs|lantern|torch|chain|scaffolding|azalea|cobweb|spawner|beacon|grate|copper_bulb|mangrove_roots/

const BREAK_DROPS: BreakDrops[] = ['normal', 'grown', 'none']
const breakDropsOf = (d: Data): BreakDrops => (BREAK_DROPS.includes(d.breakDrops as BreakDrops) ? (d.breakDrops as BreakDrops) : 'normal')

const TOOL_NAME: Record<BreakRuleIR['tool'], L10n> = {
  pickaxe: { en: 'pickaxe', th: 'อีเต้อ' },
  axe: { en: 'axe', th: 'ขวาน' },
  shovel: { en: 'shovel', th: 'พลั่ว' },
  hoe: { en: 'hoe', th: 'จอบ' },
  sword: { en: 'sword', th: 'ดาบ' },
  shears: { en: 'shears', th: 'กรรไกร' },
  any: { en: 'tool', th: 'เครื่องมือ' }
}
const LEVEL_NAME: Record<BreakRuleIR['level'], L10n> = {
  wood: { en: 'wooden', th: 'ไม้' },
  stone: { en: 'stone', th: 'หิน' },
  iron: { en: 'iron', th: 'เหล็ก' },
  diamond: { en: 'diamond', th: 'เพชร' },
  netherite: { en: 'netherite', th: 'เนเธอไรต์' }
}

/** The action-bar text of a Break Rule, e.g. "Needs an iron pickaxe or better to drop anything". */
function breakRuleMessage(r: Pick<BreakRuleIR, 'tool' | 'level' | 'onFail'>): L10n {
  const tool = TOOL_NAME[r.tool]
  const leveled = r.tool !== 'shears' && r.level !== 'wood'
  const lv = LEVEL_NAME[r.level]
  const top = r.level === 'netherite'
  const what =
    r.tool === 'shears'
      ? 'shears'
      : leveled
        ? `${/^[aeiou]/.test(lv.en) ? 'an' : 'a'} ${lv.en} ${tool.en}${top ? '' : ' or better'}`
        : `${r.tool === 'axe' ? 'an' : 'a'} ${tool.en}`
  const th = leveled ? `${tool.th}ระดับ${lv.th}${top ? '' : 'ขึ้นไป'}` : tool.th
  return r.onFail === 'cantBreak'
    ? { en: `Needs ${what} to break`, th: `ต้องใช้${th}ถึงจะทุบได้` }
    : { en: `Needs ${what} to drop anything`, th: `ต้องใช้${th}ถึงจะได้ของ` }
}

/**
 * Graph → IR. Pure function: no filesystem access, safe to run in a Web Worker.
 * Pass `target` to also check loader/version specific compatibility.
 */
export function compile(project: Project, target?: Target): CompileResult {
  const diags: Diagnostic[] = []
  const err = (nodeId: string | undefined, en: string, th: string) => diags.push({ severity: 'error', nodeId, message: { en, th } })
  const warn = (nodeId: string | undefined, en: string, th: string) => diags.push({ severity: 'warning', nodeId, message: { en, th } })

  const modid = project.meta.modId
  const nodes = new Map<string, GraphNode>()
  for (const n of project.graph.nodes) {
    // disabled nodes stay on the canvas but are not part of the mod (their wires are ignored too)
    if (n.data.disabled === true) continue
    if (!NODE_DEF_MAP[n.type]) {
      err(n.id, `Unknown node type "${n.type}"`, `ไม่รู้จักโหนดชนิด "${n.type}"`)
      continue
    }
    nodes.set(n.id, n)
  }

  // input index: `${target}|${handle}` -> {source, handle}; multi pins keep every wire in `multi`
  const inputs = new Map<string, { node: string; handle: string }>()
  const multi = new Map<string, { node: string; handle: string }[]>()
  for (const e of project.graph.edges) {
    const s = nodes.get(e.source)
    const t = nodes.get(e.target)
    if (!s || !t) continue
    const sp = pinOf(NODE_DEF_MAP[s.type], e.sourceHandle, 'out')
    const tp = pinOf(NODE_DEF_MAP[t.type], e.targetHandle, 'in')
    if (!sp || !tp || !canConnect(sp.type, tp.type)) {
      err(t.id, 'Invalid connection', 'การเชื่อมต่อไม่ถูกต้อง')
      continue
    }
    const key = `${e.target}|${e.targetHandle}`
    if (!inputs.has(key)) inputs.set(key, { node: e.source, handle: e.sourceHandle })
    if (tp.multi) multi.set(key, [...(multi.get(key) ?? []), { node: e.source, handle: e.sourceHandle }])
  }

  /** Every item wired into a multi input (reroutes followed). */
  const itemsIn = (nodeId: string, handle: string): string[] => {
    const out: string[] = []
    for (const w of multi.get(`${nodeId}|${handle}`) ?? []) {
      let cur: { node: string; handle: string } | undefined = w
      for (let g = 0; cur && g < 64; g++) {
        const n = nodes.get(cur.node)!
        if (n.type !== 'reroute') {
          const id = itemIdOf(n, cur.handle)
          if (id && !out.includes(id)) out.push(id)
          break
        }
        cur = inputs.get(`${n.id}|in`)
      }
    }
    return out
  }

  /** Items of a creative tab: the numbered pins in order, then the old any-number pin. */
  const tabItems = (nodeId: string): string[] => {
    const out: string[] = []
    for (let i = 1; i <= 64; i++) {
      const s = source(nodeId, `item${i}`)
      const id = s ? itemIdOf(s.node, s.handle) : null
      if (id && !out.includes(id)) out.push(id)
    }
    for (const id of itemsIn(nodeId, 'items')) if (!out.includes(id)) out.push(id)
    return out
  }

  /** Follows reroute nodes; returns the real producing node + handle. */
  const source = (nodeId: string, handle: string): { node: GraphNode; handle: string } | null => {
    let cur = inputs.get(`${nodeId}|${handle}`)
    for (let guard = 0; cur && guard < 64; guard++) {
      const n = nodes.get(cur.node)!
      if (n.type !== 'reroute') return { node: n, handle: cur.handle }
      cur = inputs.get(`${n.id}|in`)
    }
    return null
  }

  const assetOf = (n: GraphNode): string | null => {
    const a = str(n.data, 'asset')
    if (!a) {
      err(n.id, 'No file selected', 'ยังไม่ได้เลือกไฟล์')
      return null
    }
    if (!ASSET_RE.test(a)) {
      err(n.id, 'Invalid asset path', 'ที่อยู่ไฟล์ไม่ถูกต้อง')
      return null
    }
    return a
  }

  const texture = (nodeId: string, handle: string, required: boolean): string | null => {
    const s = source(nodeId, handle)
    if (!s) {
      if (required) err(nodeId, `Connect a texture to "${handle}"`, `ต่อเท็กซ์เจอร์เข้าช่อง "${handle}"`)
      return null
    }
    return s.node.type === 'texture' ? assetOf(s.node) : null
  }

  const model = (nodeId: string, handle: string, required: boolean): ModelRef | null => {
    const s = source(nodeId, handle)
    if (!s || s.node.type !== 'model') {
      if (required) err(nodeId, 'Connect a 3D model', 'ต่อโมเดล 3D')
      return null
    }
    const asset = assetOf(s.node)
    if (!asset) return null
    const slots = clamp(num(s.node.data, 'textureSlots', 1), 0, 4)
    const textures: (string | null)[] = []
    for (let i = 0; i < 4; i++) textures.push(texture(s.node.id, `tex${i}`, i < slots))
    return { asset, textures }
  }

  const geo = (nodeId: string, handle: string): GeoRef | null => {
    const s = source(nodeId, handle)
    if (s && s.node.type === 'model') {
      // Java block/item model worn as armor: textures are merged into one sheet for GeckoLib
      const m = model(nodeId, handle, false)
      if (!m) return null
      const textures = m.textures.filter((t): t is string => !!t)
      if (!textures.length) {
        err(s.node.id, 'Connect the model texture', 'ต่อเท็กซ์เจอร์ของโมเดล')
        return null
      }
      return { asset: m.asset, texture: textures[0], animation: null, java: { textures } }
    }
    if (!s || s.node.type !== 'geoModel') return null
    const asset = assetOf(s.node)
    const tex = texture(s.node.id, 'texture', true)
    let animation: GeoRef['animation'] = null
    const a = source(s.node.id, 'animation')
    if (a && a.node.type === 'animation') {
      const file = assetOf(a.node)
      const name = str(a.node.data, 'anim')
      if (!name) err(a.node.id, 'Choose which animation to loop', 'เลือกอนิเมชันที่จะเล่นวน')
      else if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(name)) err(a.node.id, 'Invalid animation name', 'ชื่ออนิเมชันไม่ถูกต้อง')
      else if (file) animation = { asset: file, name }
    }
    return asset && tex ? { asset, texture: tex, animation } : null
  }

  const EFFECT_IDS = new Set(EFFECTS.map((e) => e.value))
  /** Effect nodes plugged into effect1..effect3. */
  const effects = (nodeId: string): EffectIR[] => {
    const out: EffectIR[] = []
    for (let i = 1; i <= 3; i++) {
      const s = source(nodeId, `effect${i}`)
      if (!s || s.node.type !== 'effect') continue
      const effect = str(s.node.data, 'effect')
      if (!EFFECT_IDS.has(effect)) {
        err(s.node.id, 'Unknown effect', 'ไม่รู้จักเอฟเฟกต์นี้')
        continue
      }
      out.push({
        effect,
        amplifier: clamp(Math.round(num(s.node.data, 'level', 1)), 1, 1000) - 1,
        ticks: Math.round(clamp(num(s.node.data, 'seconds', 10), 0.5, 3600) * 20),
        chance: clamp(num(s.node.data, 'chance', 1), 0, 1),
        particles: bool(s.node.data, 'particles', true),
        showIcon: bool(s.node.data, 'showIcon', true),
        infinite: bool(s.node.data, 'infinite', false)
      })
    }
    return out
  }

  const ATTR_BY_ID = new Map(ATTRIBUTES.map((a) => [a.id, a]))
  const SLOT_OF_ARMOR: Record<ArmorSlot, AttrSlot> = { helmet: 'head', chestplate: 'chest', leggings: 'legs', boots: 'feet' }
  /** Stat Bonus nodes plugged into attr1..attr8; attributes the target version lacks are skipped. */
  const attributes = (nodeId: string, auto: AttrSlot): AttributeIR[] => {
    const out: AttributeIR[] = []
    for (let i = 1; i <= 8; i++) {
      const s = source(nodeId, `attr${i}`)
      if (!s || s.node.type !== 'attribute') continue
      const a = ATTR_BY_ID.get(str(s.node.data, 'attribute'))
      if (!a) {
        err(s.node.id, 'Unknown stat', 'ไม่รู้จักค่าสถานะนี้')
        continue
      }
      if (target && !mcAtLeast(target.mc, a.since)) {
        warn(
          s.node.id,
          `"${a.label.en}" needs Minecraft ${a.since} or newer: left out of ${target.loader} ${target.mc}`,
          `"${a.label.th}" ต้องใช้ Minecraft ${a.since} ขึ้นไป: ไม่ถูกใส่ใน ${target.loader} ${target.mc}`
        )
        continue
      }
      const slot = str(s.node.data, 'slot', 'auto')
      const op = str(s.node.data, 'operation', 'add')
      out.push({
        field: a.field,
        amount: clamp(num(s.node.data, 'amount', 4), -1000, 1000),
        operation: (['add', 'base', 'total'].includes(op) ? op : 'add') as AttributeIR['operation'],
        slot: (slot === 'auto' ? auto : slot) as AttrSlot,
        tooltip: bool(s.node.data, 'tooltip', true)
      })
    }
    return out
  }
  /** Hit Ability nodes plugged into hit1..hit3. */
  const hits = (nodeId: string): HitIR[] => {
    const out: HitIR[] = []
    for (let i = 1; i <= 3; i++) {
      const s = source(nodeId, `hit${i}`)
      if (!s || s.node.type !== 'hitAbility') continue
      const ability = str(s.node.data, 'ability', 'fire') as HitIR['ability']
      if (!['fire', 'lightning', 'freeze', 'teleport', 'clear'].includes(ability)) continue
      if (ability === 'freeze' && target?.mc === '1.16.5')
        warn(s.node.id, 'Minecraft 1.16.5 has no freezing: only slowness is given', 'Minecraft 1.16.5 ไม่มีการแช่แข็ง: ได้แค่ความช้า')
      out.push({
        ability,
        ticks: Math.round(clamp(num(s.node.data, 'seconds', 4), 0.5, 600) * 20),
        chance: clamp(num(s.node.data, 'chance', 1), 0, 1)
      })
    }
    return out
  }

  /** Timer window node plugged into a node's "ui" pin. */
  const harvestUi = (nodeId: string): HarvestUiIR | null => {
    const s = source(nodeId, 'ui')
    if (!s || s.node.type !== 'harvestUi') return null
    const d = s.node.data
    const rgb = (k: string, def: string) => parseInt((/^#[0-9a-f]{6}$/i.test(str(d, k)) ? str(d, k) : def).slice(1), 16)
    const style = str(d, 'style', 'bar')
    const place = str(d, 'place', 'crosshair')
    return {
      style: style === 'text' || style === 'ring' ? style : 'bar',
      color: rgb('color', '#4ade80'),
      back: rgb('back', '#000000'),
      backAlpha: Math.round((int(d, 'backOpacity', 50, 0, 100) * 255) / 100),
      place: place === 'hotbar' || place === 'top' ? place : 'crosshair',
      offset: int(d, 'offset', 0, -200, 200),
      width: int(d, 'width', 60, 10, 300),
      height: int(d, 'height', 4, 1, 20),
      radius: int(d, 'radius', 9, 3, 40),
      thickness: int(d, 'thickness', 3, 1, 40),
      time: bool(d, 'time', true)
    }
  }

  /** Thirst add-on node plugged into a food. */
  const thirst = (nodeId: string): ThirstIR | null => {
    const s = source(nodeId, 'thirst')
    if (!s || s.node.type !== 'thirst') return null
    return {
      thirst: clamp(Math.round(num(s.node.data, 'thirst', 6)), 1, 20),
      hydration: clamp(Math.round(num(s.node.data, 'hydration', 4)), 0, 20)
    }
  }

  /** Length of the first sound file behind a Sound Event (seconds, measured at import). */
  const songSeconds = (ev: GraphNode | undefined): number | null => {
    if (!ev) return null
    const f = source(ev.id, 'sound1')
    const s = f ? num(f.node.data, 'seconds', 0) : 0
    return s > 0 ? Math.ceil(s) : null
  }

  const regId = (n: GraphNode, key = 'id'): string => {
    const id = str(n.data, key)
    if (!ID_RE.test(id)) err(n.id, `Invalid ID "${id}" (use a-z, 0-9, _)`, `ID "${id}" ไม่ถูกต้อง (ใช้ a-z, 0-9, _)`)
    return id
  }

  /** Item id produced by an output pin. */
  const itemIdOf = (n: GraphNode, handle: string): string | null => {
    switch (n.type) {
      case 'item':
      case 'food':
      case 'tool':
      case 'musicDisc':
      case 'armorPiece':
        return `${modid}:${str(n.data, 'id')}`
      case 'mob':
        return `${modid}:${str(n.data, 'id')}_spawn_egg`
      case 'block':
      case 'block3d':
        if (!bool(n.data, 'hasItem', true)) {
          err(n.id, 'This block has no item of its own (turn on "Has its own block item")', 'บล็อกนี้ไม่มีไอเทมของตัวเอง (เปิด "มีไอเทมของบล็อกเอง")')
          return null
        }
        return `${modid}:${str(n.data, 'id')}`
      case 'armorSet': {
        const slot = handle as ArmorSlot
        if (!bool(n.data, slot, true)) {
          err(n.id, `${ARMOR_NAME[slot].en} is disabled but connected`, `${ARMOR_NAME[slot].th} ถูกปิดอยู่แต่มีการต่อสาย`)
          return null
        }
        return `${modid}:${str(n.data, 'baseId')}_${slot}`
      }
      case 'itemRef': {
        const id = str(n.data, 'item')
        if (!NSID_RE.test(id)) {
          err(n.id, `Invalid item id "${id}"`, `ID ไอเทม "${id}" ไม่ถูกต้อง`)
          return null
        }
        return id
      }
    }
    return null
  }

  const item = (nodeId: string, handle: string, required: boolean): string | null => {
    const s = source(nodeId, handle)
    if (!s) {
      if (required) err(nodeId, `Connect an item to "${handle}"`, `ต่อไอเทมเข้าช่อง "${handle}"`)
      return null
    }
    return itemIdOf(s.node, s.handle)
  }

  const ingredient = (nodeId: string, handle: string, required: boolean): Ingredient | null => {
    const s = source(nodeId, handle)
    if (!s) {
      if (required) err(nodeId, `Connect an ingredient to "${handle}"`, `ต่อวัตถุดิบเข้าช่อง "${handle}"`)
      return null
    }
    if (s.node.type === 'tagRef') {
      const tag = str(s.node.data, 'tag').replace(/^#/, '')
      if (!NSID_RE.test(tag)) {
        err(s.node.id, `Invalid tag "${tag}"`, `แท็ก "${tag}" ไม่ถูกต้อง`)
        return null
      }
      return { tag }
    }
    const id = itemIdOf(s.node, s.handle)
    return id ? { item: id } : null
  }

  const ir: ModIR = {
    meta: project.meta,
    items: [],
    blocks: [],
    toolMats: [],
    armorMats: [],
    sounds: [],
    recipes: [],
    tabs: [],
    scripts: [],
    mobs: [],
    gameCrops: [],
    breakRules: [],
    textureAnims: {}
  }

  const names = (n: GraphNode) => ({
    name: str(n.data, 'name') || str(n.data, 'id'),
    nameTh: str(n.data, 'nameTh')
  })
  const itemBase = (n: GraphNode) => ({
    maxStack: clamp(Math.round(num(n.data, 'maxStack', 64)), 1, 64),
    rarity: sel<ItemIR['rarity']>(n, 'rarity'),
    fireResistant: bool(n.data, 'fireResistant'),
    glint: bool(n.data, 'glint'),
    handheld: bool(n.data, 'handheld'),
    ...(bool(n.data, 'wearOnHead') ? { headwear: true, headwearRightClick: bool(n.data, 'wearRightClick', true) } : {})
  })

  const recipeNames = new Map<string, number>()
  const recipeName = (result: string | null, kind: string) => {
    const base = `${(result ?? 'recipe').split(':')[1]?.replace(/\//g, '_') ?? 'recipe'}_${kind}`
    const c = (recipeNames.get(base) ?? 0) + 1
    recipeNames.set(base, c)
    return c === 1 ? base : `${base}_${c}`
  }

  let usesFD = false
  let usesGeo = false
  let usesDefaultTool = false
  let usesDefaultArmor = false
  /** creative tabs of Regenerating Blocks nodes (after the project's own tabs) */
  const regenTabs: ModIR['tabs'] = []

  for (const n of nodes.values()) {
    const d = n.data
    switch (n.type) {
      case 'item':
      case 'food': {
        const it: ItemIR = {
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: n.type === 'food' ? 'food' : 'basic',
          texture: null,
          model: model(n.id, 'model', false),
          ...itemBase(n)
        }
        it.texture = texture(n.id, 'texture', !it.model)
        it.separateIcon = !!(it.model && it.texture)
        const pl = source(n.id, 'places')
        if (pl && ['block', 'block3d', 'crop'].includes(pl.node.type)) it.places = str(pl.node.data, 'id')
        if (n.type === 'food')
          it.food = {
            nutrition: clamp(Math.round(num(d, 'nutrition', 4)), 0, 20),
            saturation: clamp(num(d, 'saturation', 0.3), 0, 5),
            alwaysEdible: bool(d, 'alwaysEdible'),
            fast: bool(d, 'fast'),
            effects: effects(n.id),
            hits: hits(n.id),
            drink: d.useSound === 'drink',
            thirst: thirst(n.id)
          }
        it.attributes = attributes(n.id, 'mainhand')
        ir.items.push(it)
        break
      }
      case 'tool': {
        const mat = source(n.id, 'material')
        if (!mat) usesDefaultTool = true
        const it: ItemIR = {
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: 'tool',
          texture: null,
          model: model(n.id, 'model', false),
          ...itemBase(n),
          maxStack: 1,
          glint: false,
          handheld: true,
          tool: {
            type: sel<NonNullable<ItemIR['tool']>['type']>(n, 'toolType'),
            material: mat ? str(mat.node.data, 'id') : DEFAULT_MAT,
            damage: num(d, 'attackDamage', 3),
            speed: num(d, 'attackSpeed', -2.4),
            effects: effects(n.id),
            hits: hits(n.id),
            durability: bool(d, 'unbreakable') ? 0 : clamp(Math.round(num(d, 'durability', 0)), 0, 100000),
            unbreakable: bool(d, 'unbreakable')
          },
          attributes: attributes(n.id, 'mainhand')
        }
        it.texture = texture(n.id, 'texture', !it.model)
        it.separateIcon = !!(it.model && it.texture)
        ir.items.push(it)
        break
      }
      case 'toolMaterial': {
        const m: ToolMatIR = {
          id: regId(n),
          nodeId: n.id,
          durability: clamp(Math.round(num(d, 'durability', 500)), 1, 100000),
          speed: num(d, 'speed', 6),
          damage: num(d, 'damage', 2),
          level: sel<ToolMatIR['level']>(n, 'level'),
          enchantability: clamp(Math.round(num(d, 'enchantability', 14)), 0, 100),
          repair: ingredient(n.id, 'repair', false)
        }
        ir.toolMats.push(m)
        break
      }
      case 'block':
      case 'block3d': {
        const is3d = n.type === 'block3d'
        const b: BlockIR = {
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: is3d ? 'model' : 'cube',
          shape: sel<BlockIR['shape']>(n, 'shape'),
          textures: {
            side: is3d ? null : texture(n.id, 'texture', true),
            top: is3d ? null : texture(n.id, 'top', false),
            bottom: is3d ? null : texture(n.id, 'bottom', false)
          },
          model: is3d ? model(n.id, 'model', true) : null,
          rotatable: is3d && bool(d, 'rotatable', true),
          hasItem: bool(d, 'hasItem', true),
          solid: !is3d || bool(d, 'solid', true),
          hardness: clamp(num(d, 'hardness', 3), 0, 100),
          resistance: clamp(num(d, 'resistance', 6), 0, 3600000),
          sound: sel(n, 'sound'),
          tool: sel<BlockIR['tool']>(n, 'tool'),
          toolLevel: sel<BlockIR['toolLevel']>(n, 'toolLevel'),
          requiresTool: sel(n, 'tool') !== 'none' && bool(d, 'requiresTool', true),
          light: clamp(Math.round(num(d, 'light', 0)), 0, 15),
          drop: item(n.id, 'drop', false),
          dropMin: clamp(Math.round(num(d, 'dropMin', 1)), 0, 64),
          dropMax: clamp(Math.round(num(d, 'dropMax', 1)), 0, 64)
        }
        if (b.dropMax < b.dropMin) b.dropMax = b.dropMin
        if (!is3d && b.shape !== 'cube_all' && !b.textures.top)
          warn(n.id, 'No top texture: the side texture is used', 'ไม่มีเท็กซ์เจอร์ด้านบน: จะใช้ด้านข้างแทน')
        ir.blocks.push(b)
        break
      }
      case 'crop': {
        const stages: string[] = []
        for (let i = 1; i <= 8; i++) {
          const s = texture(n.id, `stage${i}`, false)
          if (s) stages.push(s)
        }
        if (!stages.length) err(n.id, 'Connect at least one growth stage texture', 'ต่อเท็กซ์เจอร์ระยะการโตอย่างน้อย 1 ระยะ')
        const mode = (['regrow', 'auto'].includes(str(d, 'mode')) ? str(d, 'mode') : 'replant') as NonNullable<BlockIR['crop']>['mode']
        const input = (['break', 'click', 'hold', 'stand'].includes(str(d, 'input')) ? str(d, 'input') : 'break') as NonNullable<BlockIR['crop']>['input']
        if (mode !== 'replant' && input === 'break')
          warn(
            n.id,
            mode === 'auto'
              ? 'A crop that replants itself needs a right-click harvest: right-click is used'
              : 'A crop that grows back needs a right-click harvest: right-click is used',
            mode === 'auto' ? 'พืชที่ปลูกใหม่เองต้องเก็บด้วยคลิกขวา: ใช้คลิกขวาแทน' : 'พืชที่โตใหม่ต้องเก็บด้วยคลิกขวา: ใช้คลิกขวาแทน'
          )
        const growSeconds = clamp(Math.round(num(d, 'growSeconds', 0)), 0, 36000)
        const produceMin = clamp(Math.round(num(d, 'produceMin', 1)), 1, 64)
        const seedMin = clamp(Math.round(num(d, 'seedMin', 1)), 0, 64)
        const b: BlockIR = {
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: 'crop',
          shape: 'cube_all',
          textures: { side: null, top: null, bottom: null },
          model: null,
          rotatable: false,
          hasItem: false,
          solid: false,
          hardness: 0,
          resistance: 0,
          sound: 'crop',
          tool: 'none',
          toolLevel: 'wood',
          requiresTool: false,
          light: 0,
          drop: null,
          dropMin: 1,
          dropMax: 1,
          crop: {
            stages,
            look: str(d, 'look') === 'cross' ? 'cross' : 'crop',
            soil: str(d, 'soil') === 'dirt' ? 'dirt' : 'farmland',
            growStep: growSeconds ? Math.max(1, Math.round((growSeconds * 20) / 7)) : 0,
            mode,
            regrowAge: clamp(Math.round(num(d, 'regrowStage', 0)), 0, 6),
            regrowTicks: clamp(Math.round(num(d, 'regrowSeconds', 60)), 1, 36000) * 20,
            input: mode !== 'replant' && input === 'break' ? 'click' : input,
            harvestTicks: Math.round(clamp(num(d, 'harvestSeconds', 2), 0.1, 120) * 20),
            produce: item(n.id, 'produce', true),
            produceMin,
            produceMax: Math.max(produceMin, clamp(Math.round(num(d, 'produceMax', 2)), 1, 64)),
            seedMin,
            seedMax: Math.max(seedMin, clamp(Math.round(num(d, 'seedMax', 3)), 0, 64)),
            ui: harvestUi(n.id),
            give: bool(d, 'give', false),
            breakDrops: breakDropsOf(d),
            adventure: bool(d, 'adventure', true)
          }
        }
        if (b.crop!.breakDrops === 'none' && b.crop!.input === 'break')
          warn(
            n.id,
            'Breaking is the harvest but breaking gives nothing: pick a right-click harvest',
            'ตั้งให้เก็บเกี่ยวด้วยการทุบ แต่ทุบแล้วไม่ได้อะไร: เลือกวิธีเก็บแบบคลิกขวา'
          )
        ir.blocks.push(b)
        break
      }
      case 'regenBlock': {
        const prefix = str(d, 'prefix', 'regen') || 'regen'
        if (!ID_RE.test(prefix)) err(n.id, `Invalid ID prefix "${prefix}" (use a-z, 0-9, _)`, `คำนำหน้า ID "${prefix}" ไม่ถูกต้อง (ใช้ a-z, 0-9, _)`)
        // "left-click" was removed: older projects hold the button instead
        const rawInput = str(d, 'input') === 'click' ? 'hold' : str(d, 'input')
        const input = (['break', 'hold', 'stand'].includes(rawInput) ? rawInput : 'break') as NonNullable<BlockIR['regen']>['input']
        const look = str(d, 'depleted', 'minecraft:bedrock').replace(/^#/, '') || 'minecraft:bedrock'
        if (!NSID_RE.test(look)) err(n.id, `"${look}" is not a block ID (e.g. minecraft:bedrock)`, `"${look}" ไม่ใช่ ID บล็อก (เช่น minecraft:bedrock)`)
        const ticks = clamp(Math.round(num(d, 'regenSeconds', 60)), 1, 86400) * 20
        const breaking = input === 'break'
        const tool = sel<BlockIR['tool']>(n, 'tool')
        const items: string[] = []
        const base = (id: string, name: string): BlockIR => ({
          id,
          name,
          nameTh: '',
          nodeId: n.id,
          kind: 'regen',
          shape: 'cube_all',
          textures: { side: null, top: null, bottom: null },
          model: null,
          rotatable: false,
          hasItem: true,
          solid: true,
          // right-click harvests: the block itself cannot be mined; blocks resist explosions either way
          hardness: breaking ? clamp(num(d, 'hardness', 3), 0, 100) : -1,
          resistance: 3600000,
          sound: sel(n, 'sound'),
          tool: breaking ? tool : 'none',
          toolLevel: 'wood',
          requiresTool: false,
          light: 0,
          drop: null,
          dropMin: 1,
          dropMax: 1
        })
        const entries = breakRuleEntries(d)
        // blocks of this mod wired in
        for (let i = 1; i <= 32; i++) {
          const s = source(n.id, `block${i}`)
          if (!s || !['block', 'block3d'].includes(s.node.type)) continue
          const id = `${modid}:${str(s.node.data, 'id')}`
          if (!entries.includes(id)) entries.push(id)
        }
        if (!entries.length) err(n.id, 'Pick at least one block', 'เลือกบล็อกอย่างน้อย 1 อัน')
        const dropItem = item(n.id, 'drop', false)
        const dropMin = clamp(Math.round(num(d, 'dropMin', 1)), 1, 64)
        const drop = dropItem ? { item: dropItem, min: dropMin, max: Math.max(dropMin, clamp(Math.round(num(d, 'dropMax', 1)), 1, 64)) } : null
        for (const e of entries) {
          if (e.startsWith('#') || !NSID_RE.test(e)) {
            err(n.id, `"${e}" is not a block ID (tags cannot be used here)`, `"${e}" ไม่ใช่ ID บล็อก (ใช้แท็กที่นี่ไม่ได้)`)
            continue
          }
          const [ns, path] = e.split(':')
          // minecraft:iron_ore → regen_iron_ore, mymod:ruby_ore → regen_ruby_ore, othermod:ruby_ore → regen_othermod_ruby_ore
          const id = `${prefix}_${ns === 'minecraft' || ns === modid ? '' : `${ns}_`}${path.replace(/[/.-]/g, '_')}`
          if (!ID_RE.test(id)) {
            err(n.id, `"${e}" makes the invalid ID "${id}"`, `"${e}" ได้ ID "${id}" ที่ไม่ถูกต้อง`)
            continue
          }
          const pretty = path.replace(/[/_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
          ir.blocks.push({
            ...base(id, `${pretty} (Regenerating)`),
            seeThrough: SEE_THROUGH.test(path),
            nameTh: `${pretty} (เกิดใหม่)`,
            regen: {
              original: e,
              depleted: `${id}_depleted`,
              input,
              harvestTicks: Math.round(clamp(num(d, 'harvestSeconds', 2), 0.1, 120) * 20),
              ui: harvestUi(n.id),
              timer: breaking && bool(d, 'timer', true),
              drop,
              give: bool(d, 'give', false),
              adventure: bool(d, 'adventure', true),
              wear: breaking ? 0 : int(d, 'toolWear', 1, 0, 64)
            }
          })
          ir.blocks.push({
            ...base(`${id}_depleted`, `${pretty} (Growing Back)`),
            nameTh: `${pretty} (รอเกิดใหม่)`,
            kind: 'depleted',
            seeThrough: SEE_THROUGH.test(look.split(':')[1] ?? ''),
            hasItem: false,
            hardness: -1,
            tool: 'none',
            depleted: { look, restore: id, ticks }
          })
          items.push(`${modid}:${id}`)
        }
        if (items.length) {
          const tabId = `${prefix}_blocks`
          // nodes with the same ID prefix share one creative tab (named by the first of them)
          const same = regenTabs.find((tb) => tb.id === tabId)
          if (same) {
            same.items.push(...items.filter((it) => !same.items.includes(it)))
            break
          }
          regenTabs.push({
            id: tabId,
            nodeId: n.id,
            title: str(d, 'tabTitle') || 'Regenerating Blocks',
            titleTh: str(d, 'tabTitleTh'),
            icon: items[0],
            logo: null,
            items
          })
        }
        break
      }
      case 'breakRule': {
        const blocks: string[] = []
        const tags: string[] = []
        for (const e of breakRuleEntries(d)) {
          const tag = e.startsWith('#')
          const id = tag ? e.slice(1) : e
          if (!NSID_RE.test(id)) {
            err(
              n.id,
              `"${e}" is not a block ID (e.g. minecraft:stone) or a tag (#minecraft:logs)`,
              `"${e}" ไม่ใช่ ID บล็อก (เช่น minecraft:stone) หรือแท็ก (#minecraft:logs)`
            )
            continue
          }
          const list = tag ? tags : blocks
          if (!list.includes(id)) list.push(id)
        }
        // blocks of this mod wired in
        for (let i = 1; i <= 32; i++) {
          const s = source(n.id, `block${i}`)
          if (!s || !['block', 'block3d', 'crop'].includes(s.node.type)) continue
          const id = `${modid}:${str(s.node.data, 'id')}`
          if (!blocks.includes(id)) blocks.push(id)
        }
        if (!blocks.length && !tags.length) {
          err(n.id, 'Pick at least one block', 'เลือกบล็อกอย่างน้อย 1 อัน')
          break
        }
        const tool = ((BREAK_TOOLS as readonly string[]).includes(str(d, 'tool')) ? str(d, 'tool') : 'pickaxe') as BreakRuleIR['tool']
        const level = (
          tool === 'shears' ? 'wood' : (TOOL_LEVELS as readonly string[]).includes(str(d, 'level')) ? str(d, 'level') : 'stone'
        ) as BreakRuleIR['level']
        if (tool === 'any' && level === 'wood')
          warn(n.id, 'Any tool of any level: every player passes this rule', 'เครื่องมืออะไรก็ได้ ระดับไหนก็ได้: ผู้เล่นทุกคนผ่านกฎนี้')
        const onFail = str(d, 'onFail') === 'cantBreak' ? 'cantBreak' : 'noDrop'
        const auto = breakRuleMessage({ tool, level, onFail })
        const en = str(d, 'messageEn').trim()
        const th = str(d, 'messageTh').trim()
        ir.breakRules.push({
          nodeId: n.id,
          blocks,
          tags,
          tool,
          level,
          onFail,
          message: bool(d, 'message', true) ? { en: en || auto.en, th: th || (en ? en : auto.th) } : null,
          timer: bool(d, 'timer', false),
          ui: harvestUi(n.id),
          adventure: bool(d, 'adventure', false)
        })
        if (source(n.id, 'ui') && !bool(d, 'timer', false))
          warn(n.id, 'A timer window is wired in but "Show a timer while breaking" is off', 'ต่อหน้าต่างเวลาไว้ แต่ยังไม่ได้เปิด "แสดงเวลาตอนทุบ"')
        break
      }
      case 'gameCrop': {
        const blocks = gameCropIds(d)
        if (!blocks.length) {
          err(n.id, 'Pick at least one crop', 'เลือกพืชอย่างน้อย 1 อย่าง')
          break
        }
        const input = (['click', 'hold', 'stand'].includes(str(d, 'input')) ? str(d, 'input') : 'hold') as GameCropIR['input']
        // "like the game": picked bushes go back to their picked stage, everything else breaks
        const NORMAL: Record<string, number> = { 'minecraft:sweet_berry_bush': 1, 'farmersdelight:tomatoes': 0 }
        const fdMissing = !!target && !farmersDelightFor(target.loader, target.mc)
        for (const block of blocks) {
          if (!NSID_RE.test(block) || block.split(':')[0] === ir.meta.modId) {
            err(
              n.id,
              `"${block}" is not a block ID of the game or another mod (e.g. minecraft:wheat)`,
              `"${block}" ไม่ใช่ ID บล็อกของเกมหรือม็อดอื่น (เช่น minecraft:wheat)`
            )
            continue
          }
          if (ir.gameCrops.some((g) => g.block === block)) {
            err(n.id, `${block} already has a harvest node`, `${block} มีโหนดเก็บเกี่ยวแล้ว`)
            continue
          }
          if (block.startsWith('farmersdelight:') && fdMissing)
            warn(
              n.id,
              `Farmer's Delight is not available for ${target!.loader} ${target!.mc}: ${block} is not there`,
              `ไม่มี Farmer's Delight สำหรับ ${target!.loader} ${target!.mc}: ไม่มี ${block}`
            )
          let after = str(d, 'after', 'normal')
          let back = clamp(Math.round(num(d, 'backStage', 1)), 0, 15)
          if (after !== 'replant' && after !== 'regrow') {
            if (block in NORMAL) {
              after = 'regrow'
              back = NORMAL[block]
            } else after = 'break'
          }
          if (after === 'replant') back = 0
          ir.gameCrops.push({
            nodeId: n.id,
            block,
            input,
            harvestTicks: input === 'click' ? 0 : Math.round(clamp(num(d, 'harvestSeconds', 2), 0.1, 120) * 20),
            after: after as GameCropIR['after'],
            back,
            ui: harvestUi(n.id),
            give: bool(d, 'give', false),
            breakDrops: breakDropsOf(d),
            adventure: bool(d, 'adventure', true)
          })
        }
        break
      }
      case 'mob': {
        const BODIES = ['zombie', 'skeleton', 'spider', 'cow', 'pig', 'model3d'] as const
        let body = (BODIES as readonly string[]).includes(str(d, 'body')) ? (str(d, 'body') as MobIR['body']) : 'zombie'
        const behavior = (['hostile', 'neutral', 'passive'].includes(str(d, 'behavior')) ? str(d, 'behavior') : 'hostile') as MobIR['behavior']
        let g: GeoRef | null = null
        if (body === 'model3d') {
          g = geo(n.id, 'geo')
          if (!g) err(n.id, 'Connect a 3D model (3D Armor Model node) for the 3D body', 'ต่อโมเดล 3D (โหนดโมเดลเกราะ 3D) สำหรับร่างแบบ 3D')
          else if (g.java) {
            err(
              n.id,
              'A mob needs a Blockbench model (.bbmodel / .geo.json), not a block model',
              'ม็อบต้องใช้โมเดล Blockbench (.bbmodel / .geo.json) ไม่ใช่โมเดลบล็อก'
            )
            g = null
          } else usesGeo = true
          // GeckoLib only on some versions: a game body that fits the behavior stands in
          if (target && !getProfile(target.mc).geckoArmor) {
            const stand = behavior === 'passive' ? 'pig' : 'zombie'
            warn(
              n.id,
              `3D mobs (GeckoLib) need 1.20.1 or 1.21.1: on ${target.mc} the ${stand} body with the skin is used`,
              `ม็อบ 3D (GeckoLib) ใช้ได้ใน 1.20.1 และ 1.21.1: ใน ${target.mc} จะใช้ร่าง${stand === 'pig' ? 'หมู' : 'ซอมบี้'}กับสกินแทน`
            )
            body = stand
          }
        }
        const skin = texture(n.id, 'skin', body !== 'model3d')
        const where = str(d, 'spawn', 'none')
        const spawn = ['overworld', 'nether', 'end'].includes(where)
          ? {
              where: where as 'overworld',
              weight: clamp(Math.round(num(d, 'weight', 40)), 1, 1000),
              min: clamp(Math.round(num(d, 'groupMin', 1)), 1, 16),
              max: Math.max(clamp(Math.round(num(d, 'groupMin', 1)), 1, 16), clamp(Math.round(num(d, 'groupMax', 3)), 1, 16))
            }
          : null
        if (spawn && target && !mcAtLeast(target.mc, '1.19.2'))
          warn(
            n.id,
            `Natural spawning needs 1.19.2 or newer: on ${target.mc} use the spawn egg`,
            `การเกิดตามธรรมชาติต้องใช้ 1.19.2 ขึ้นไป: ใน ${target.mc} ใช้ไข่เกิดแทน`
          )
        const drops: string[] = []
        for (let i = 1; i <= 3; i++) {
          const it = item(n.id, `drop${i}`, false)
          if (it) drops.push(it)
        }
        const color = (k: string, def: string) => parseInt((/^#[0-9a-f]{6}$/i.test(str(d, k)) ? str(d, k) : def).slice(1), 16)
        const anim = (k: string) => (/^[A-Za-z0-9_.:-]{1,128}$/.test(str(d, k)) ? str(d, k) : '')
        const dropMin = clamp(Math.round(num(d, 'dropMin', 0)), 0, 64)
        ir.mobs.push({
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          body,
          behavior: body === 'cow' || body === 'pig' ? 'passive' : body === 'model3d' ? behavior : 'hostile',
          skin,
          geo: body === 'model3d' ? g : null,
          health: clamp(num(d, 'health', 20), 1, 1024),
          attack: clamp(num(d, 'attack', 3), 0, 1000),
          speed: clamp(num(d, 'speed', 0.25), 0.01, 2),
          armor: clamp(num(d, 'armor', 0), 0, 30),
          width: clamp(num(d, 'width', 0.6), 0.1, 8),
          height: clamp(num(d, 'height', 1.8), 0.1, 16),
          anims: { idle: anim('idleAnim'), walk: anim('walkAnim'), attack: anim('attackAnim') },
          spawn: spawn && (!target || mcAtLeast(target.mc, '1.19.2')) ? spawn : null,
          drops,
          dropMin,
          dropMax: Math.max(dropMin, clamp(Math.round(num(d, 'dropMax', 2)), 0, 64)),
          egg: [color('eggColor', '#4b7f52'), color('eggSpots', '#e11d48')]
        })
        break
      }
      case 'armorMaterial': {
        const m: ArmorMatIR = {
          id: regId(n),
          nodeId: n.id,
          durability: clamp(Math.round(num(d, 'durability', 20)), 1, 1000),
          protection: {
            helmet: int(d, 'helmet', 2, 0, 30),
            chestplate: int(d, 'chestplate', 6, 0, 30),
            leggings: int(d, 'leggings', 5, 0, 30),
            boots: int(d, 'boots', 2, 0, 30)
          },
          enchantability: clamp(Math.round(num(d, 'enchantability', 15)), 0, 100),
          toughness: num(d, 'toughness', 0),
          knockback: clamp(num(d, 'knockback', 0), 0, 1),
          equipSound: sel(n, 'equipSound'),
          layer1: texture(n.id, 'layer1', true),
          layer2: texture(n.id, 'layer2', true),
          repair: ingredient(n.id, 'repair', false)
        }
        ir.armorMats.push(m)
        break
      }
      case 'armorSet': {
        const base = regId(n, 'baseId')
        const mat = source(n.id, 'material')
        if (!mat) usesDefaultArmor = true
        const g = geo(n.id, 'geo')
        if (g) usesGeo = true
        const nm = names(n)
        let any = false
        for (const slot of ARMOR_SLOTS) {
          if (!bool(d, slot, true)) continue
          any = true
          ir.items.push({
            id: `${base}_${slot}`,
            name: `${nm.name || base} ${ARMOR_NAME[slot].en}`,
            nameTh: nm.nameTh ? `${ARMOR_NAME[slot].th}${nm.nameTh}` : '',
            nodeId: n.id,
            kind: 'armor',
            texture: texture(n.id, `${slot}Icon`, true),
            model: null,
            handheld: false,
            maxStack: 1,
            rarity: sel<ItemIR['rarity']>(n, 'rarity'),
            fireResistant: bool(d, 'fireResistant'),
            glint: false,
            armor: { material: mat ? str(mat.node.data, 'id') : DEFAULT_MAT, slot, geo: g, effects: [] }
          })
        }
        if (!any) warn(n.id, 'No armor piece is enabled', 'ไม่ได้เปิดชิ้นเกราะใดเลย')
        break
      }
      case 'armorPiece': {
        const mat = source(n.id, 'material')
        if (!mat) usesDefaultArmor = true
        const g = geo(n.id, 'geo')
        if (g) {
          usesGeo = true
          g.fit = parseFit(d.fit)
        }
        const slot = (ARMOR_SLOTS.includes(str(d, 'slot') as ArmorSlot) ? str(d, 'slot') : 'helmet') as ArmorSlot
        // inventory icon: the icon texture, or the 3D model itself
        const modelIcon = str(d, 'iconFrom') === 'model'
        if (modelIcon && !g)
          warn(n.id, 'Connect a 3D model to use it as the icon (the icon texture is used)', 'ต่อโมเดล 3D ก่อนจึงจะใช้เป็นไอคอนได้ (ตอนนี้ใช้รูปไอคอนแทน)')
        const iconModel = modelIcon && !!g
        ir.items.push({
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: 'armor',
          texture: texture(n.id, 'icon', !iconModel),
          model: g?.java ? { asset: g.asset, textures: g.java.textures } : null,
          ...(iconModel && !g!.java ? { geoIcon: true } : {}),
          ...(g?.java && !iconModel ? { separateIcon: true } : {}),
          handheld: false,
          maxStack: 1,
          rarity: sel<ItemIR['rarity']>(n, 'rarity'),
          fireResistant: bool(d, 'fireResistant'),
          glint: false,
          armor: { material: mat ? str(mat.node.data, 'id') : DEFAULT_MAT, slot, geo: g, effects: effects(n.id) },
          attributes: attributes(n.id, SLOT_OF_ARMOR[slot])
        })
        break
      }
      case 'texture': {
        const a = str(d, 'asset')
        if (bool(d, 'animated') && ASSET_RE.test(a))
          ir.textureAnims[a] = { frametime: clamp(Math.round(num(d, 'frameTime', 2)), 1, 200), interpolate: bool(d, 'interpolate') }
        break
      }
      case 'soundEvent': {
        const files: string[] = []
        for (let i = 1; i <= 4; i++) {
          const s = source(n.id, `sound${i}`)
          if (s && s.node.type === 'soundFile') {
            const a = assetOf(s.node)
            if (a) files.push(a)
          }
        }
        if (!files.length) err(n.id, 'Connect at least one sound file', 'ต่อไฟล์เสียงอย่างน้อย 1 ไฟล์')
        const snd: SoundIR = {
          id: regId(n),
          nodeId: n.id,
          files,
          subtitle: str(d, 'subtitle'),
          subtitleTh: str(d, 'subtitleTh'),
          stream: bool(d, 'stream'),
          volume: clamp(num(d, 'volume', 1), 0, 4),
          pitch: clamp(num(d, 'pitch', 1), 0.5, 2)
        }
        ir.sounds.push(snd)
        break
      }
      case 'musicDisc': {
        const s = source(n.id, 'sound')
        if (!s) err(n.id, 'Connect a Sound Event (the song)', 'ต่อเสียงในเกม (เพลง)')
        ir.items.push({
          id: regId(n),
          ...names(n),
          nodeId: n.id,
          kind: 'disc',
          texture: texture(n.id, 'texture', true),
          model: null,
          handheld: false,
          maxStack: 1,
          rarity: 'rare',
          fireResistant: false,
          glint: false,
          disc: {
            sound: s ? str(s.node.data, 'id') : '',
            song: str(d, 'song'),
            songTh: str(d, 'songTh'),
            length: clamp(Math.round(bool(d, 'autoLength', true) ? (songSeconds(s?.node) ?? num(d, 'length', 180)) : num(d, 'length', 180)), 1, 36000),
            comparator: clamp(Math.round(num(d, 'comparator', 1)), 1, 15),
            copyright: ['free', 'licensed', 'copyrighted', 'none'].includes(str(d, 'copyright')) ? str(d, 'copyright') : 'none',
            // older projects stored a plain "loop" switch
            onEnd: ['eject', 'loop', 'stay'].includes(str(d, 'onEnd'))
              ? (str(d, 'onEnd') as 'eject' | 'loop' | 'stay')
              : bool(d, 'loop', false)
                ? 'loop'
                : 'eject',
            range: clamp(Math.round(num(d, 'range', 64)), 4, 256)
          }
        })
        break
      }
      case 'recipeShaped': {
        // grid cells name an ingredient pin (i1..i9); old projects wired s1..s9 straight into the cells
        const cells = Array.isArray(d.grid) ? (d.grid as unknown[]) : []
        const grid: (Ingredient | null)[] = []
        for (let i = 0; i < 9; i++) {
          const pin = typeof cells[i] === 'string' && /^i[1-9]$/.test(cells[i] as string) ? (cells[i] as string) : ''
          grid.push(ingredient(n.id, `s${i + 1}`, false) ?? (pin ? ingredient(n.id, pin, false) : null))
        }
        const result = item(n.id, 'result', true)
        const rows = [0, 1, 2].filter((r) => grid.slice(r * 3, r * 3 + 3).some(Boolean))
        const cols = [0, 1, 2].filter((c) => [0, 1, 2].some((r) => grid[r * 3 + c]))
        if (!rows.length) {
          const wired = [1, 2, 3, 4, 5, 6, 7, 8, 9].some((i) => inputs.has(`${n.id}|i${i}`))
          if (wired) err(n.id, 'Drag the ingredients onto the crafting grid (Properties panel)', 'ลากวัตถุดิบไปวางบนตารางคราฟ (แผงคุณสมบัติ)')
          else err(n.id, 'The crafting grid is empty', 'ตารางคราฟว่างเปล่า')
          break
        }
        const key: Record<string, Ingredient> = {}
        const sym = new Map<string, string>()
        const letters = 'ABCDEFGHI'
        const pattern = rows.map((r) =>
          cols
            .map((c) => {
              const ing = grid[r * 3 + c]
              if (!ing) return ' '
              const k = JSON.stringify(ing)
              if (!sym.has(k)) {
                const l = letters[sym.size]
                sym.set(k, l)
                key[l] = ing
              }
              return sym.get(k)!
            })
            .join('')
        )
        if (result)
          ir.recipes.push({ kind: 'shaped', name: recipeName(result, 'shaped'), nodeId: n.id, pattern, key, result, count: int(d, 'count', 1, 1, 64) })
        break
      }
      case 'recipeShapeless': {
        const ings: Ingredient[] = []
        for (let i = 1; i <= 9; i++) {
          const g = ingredient(n.id, `i${i}`, false)
          if (g) ings.push(g)
        }
        const result = item(n.id, 'result', true)
        if (!ings.length) err(n.id, 'Add at least one ingredient', 'ใส่วัตถุดิบอย่างน้อย 1 อย่าง')
        else if (result)
          ir.recipes.push({
            kind: 'shapeless',
            name: recipeName(result, 'shapeless'),
            nodeId: n.id,
            ingredients: ings,
            result,
            count: int(d, 'count', 1, 1, 64)
          })
        break
      }
      case 'recipeCooking': {
        const input = ingredient(n.id, 'input', true)
        const result = item(n.id, 'result', true)
        const station = sel<'smelting'>(n, 'kind')
        if (input && result)
          ir.recipes.push({
            kind: 'cooking',
            station,
            name: recipeName(result, station),
            nodeId: n.id,
            input,
            result,
            xp: num(d, 'xp', 0.7),
            time: clamp(Math.round(num(d, 'time', 200)), 1, 72000)
          })
        break
      }
      case 'recipeStonecutting': {
        const input = ingredient(n.id, 'input', true)
        const result = item(n.id, 'result', true)
        if (input && result)
          ir.recipes.push({
            kind: 'stonecutting',
            name: recipeName(result, 'stonecutting'),
            nodeId: n.id,
            input,
            result,
            count: int(d, 'count', 1, 1, 64)
          })
        break
      }
      case 'recipeSmithing': {
        const base = ingredient(n.id, 'base', true)
        const addition = ingredient(n.id, 'addition', true)
        const result = item(n.id, 'result', true)
        if (base && addition && result)
          ir.recipes.push({
            kind: 'smithing',
            name: recipeName(result, 'smithing'),
            nodeId: n.id,
            template: ingredient(n.id, 'template', false),
            base,
            addition,
            result
          })
        break
      }
      case 'fdCutting': {
        usesFD = true
        const input = ingredient(n.id, 'input', true)
        const results: { item: string; count: number; chance: number }[] = []
        for (let i = 1; i <= 4; i++) {
          const it = item(n.id, `out${i}`, i === 1)
          if (it) results.push({ item: it, count: int(d, `count${i}`, 1, 1, 64), chance: i === 1 ? 1 : clamp(num(d, `chance${i}`, 1), 0, 1) })
        }
        if (input && results.length)
          ir.recipes.push({ kind: 'fdCutting', name: recipeName(results[0].item, 'cutting'), nodeId: n.id, input, tool: sel(n, 'tool'), results })
        break
      }
      case 'fdCooking': {
        usesFD = true
        const ings: Ingredient[] = []
        for (let i = 1; i <= 6; i++) {
          const g = ingredient(n.id, `i${i}`, false)
          if (g) ings.push(g)
        }
        const result = item(n.id, 'result', true)
        if (!ings.length) err(n.id, 'Add at least one ingredient', 'ใส่วัตถุดิบอย่างน้อย 1 อย่าง')
        else if (result)
          ir.recipes.push({
            kind: 'fdCooking',
            name: recipeName(result, 'cooking'),
            nodeId: n.id,
            ingredients: ings,
            container: item(n.id, 'container', false),
            result,
            count: int(d, 'count', 1, 1, 64),
            xp: num(d, 'xp', 1),
            time: clamp(Math.round(num(d, 'time', 200)), 1, 72000),
            tab: sel(n, 'tab')
          })
        break
      }
      case 'script': {
        const code = str(d, 'code')
        const targets = Array.isArray(d.targets) ? (d.targets as unknown[]).filter((x): x is string => typeof x === 'string') : []
        if (target && !scriptAppliesTo(targets, target)) break
        if (code.length > 200000) {
          err(n.id, 'The file is too long (max 200,000 characters)', 'ไฟล์ยาวเกินไป (สูงสุด 200,000 ตัวอักษร)')
          break
        }
        const className = scriptClassName(code)
        if (!className) {
          err(n.id, 'Java: declare a public class (e.g. "public class MyScript {")', 'Java: ต้องมี public class (เช่น "public class MyScript {")')
          break
        }
        if (isReservedClass(className))
          err(
            n.id,
            `Java: the class name "${className}" is used by the generated mod — pick another`,
            `Java: ชื่อคลาส "${className}" ม็อดใช้อยู่แล้ว ตั้งชื่ออื่น`
          )
        const unbalanced = scriptBracketProblem(code)
        if (unbalanced) err(n.id, `Java: ${unbalanced.en}`, `Java: ${unbalanced.th}`)
        ir.scripts.push({ nodeId: n.id, className, targets, code, entry: scriptEntrypoints(code) })
        break
      }
      case 'creativeTab': {
        const id = str(d, 'id') || 'main'
        if (!ID_RE.test(id)) err(n.id, `Invalid ID "${id}" (use a-z, 0-9, _)`, `ID "${id}" ไม่ถูกต้อง (ใช้ a-z, 0-9, _)`)
        ir.tabs.push({
          id,
          nodeId: n.id,
          title: str(d, 'title') || project.meta.name,
          titleTh: str(d, 'titleTh'),
          icon: item(n.id, 'icon', false),
          logo: texture(n.id, 'logo', false),
          items: tabItems(n.id)
        })
        break
      }
    }
  }

  ir.tabs.push(...regenTabs)

  // tools / armor without a material use iron (armor also looks like iron armor when worn)
  if (usesDefaultTool)
    ir.toolMats.push({
      id: DEFAULT_MAT,
      nodeId: '',
      durability: 250,
      speed: 6,
      damage: 2,
      level: 'iron',
      enchantability: 14,
      repair: { item: 'minecraft:iron_ingot' }
    })
  if (usesDefaultArmor)
    ir.armorMats.push({
      id: DEFAULT_MAT,
      nodeId: '',
      durability: 15,
      protection: { helmet: 2, chestplate: 6, leggings: 5, boots: 2 },
      enchantability: 9,
      toughness: 0,
      knockback: 0,
      equipSound: 'iron',
      layer1: null,
      layer2: null,
      repair: { item: 'minecraft:iron_ingot' },
      vanillaLook: 'iron'
    })

  // two script files with the same class for the same target
  for (const [i, a] of ir.scripts.entries())
    for (const b of ir.scripts.slice(i + 1))
      if (a.className === b.className && (!a.targets.length || !b.targets.length || a.targets.some((x) => b.targets.includes(x))))
        err(b.nodeId, `Java: class "${b.className}" is already defined by another Script node`, `Java: คลาส "${b.className}" มีในโหนดสคริปต์อื่นแล้ว`)

  // ── cross-checks ──
  const seen = new Map<string, string>()
  const claim = (id: string, nodeId: string) => {
    const prev = seen.get(id)
    if (prev && prev !== nodeId) err(nodeId, `Duplicate ID "${id}"`, `ID "${id}" ซ้ำกัน`)
    else seen.set(id, nodeId)
  }
  for (const b of ir.blocks)
    if (b.crop && !ir.items.some((i) => i.places === b.id))
      warn(
        b.nodeId,
        'No seeds: wire this crop into an Item\'s "Places block" pin so it can be planted',
        'ยังไม่มีเมล็ด: ต่อพืชนี้เข้าขา "วางเป็นบล็อก" ของไอเทม เพื่อให้ปลูกได้'
      )
  // Regenerating Blocks of this mod's blocks: a Block or 3D Block of the mod (not a crop or another regenerating block)
  for (const b of ir.blocks)
    if (
      b.regen?.original.startsWith(`${modid}:`) &&
      !ir.blocks.some((x) => (x.kind === 'cube' || x.kind === 'model') && `${modid}:${x.id}` === b.regen!.original)
    )
      err(b.nodeId, `${b.regen.original} is not a Block or 3D Block of this mod`, `${b.regen.original} ไม่ใช่บล็อกหรือบล็อก 3D ของม็อดนี้`)
  // Break Rules: own blocks must exist; a block in two rules follows the first one
  const ruled = new Map<string, string>()
  for (const r of ir.breakRules)
    for (const b of [...r.blocks, ...r.tags.map((x) => `#${x}`)]) {
      if (b.startsWith(`${modid}:`) && !ir.blocks.some((x) => `${modid}:${x.id}` === b))
        err(r.nodeId, `${b} is not a block of this mod`, `${b} ไม่ใช่บล็อกของม็อดนี้`)
      const prev = ruled.get(b)
      if (prev && prev !== r.nodeId) warn(r.nodeId, `${b} is already in another Break Rule (that one is used)`, `${b} อยู่ในกฎการทุบอื่นแล้ว (ใช้กฎนั้น)`)
      else ruled.set(b, r.nodeId)
    }
  for (const m of ir.mobs) {
    claim(`entity:${m.id}`, m.nodeId)
    claim(`item:${m.id}_spawn_egg`, m.nodeId)
  }
  for (const it of ir.items) claim(`item:${it.id}`, it.nodeId)
  for (const b of ir.blocks) claim(`item:${b.id}`, b.nodeId)
  for (const m of ir.toolMats) claim(`tool_mat:${m.id}`, m.nodeId)
  for (const m of ir.armorMats) claim(`armor_mat:${m.id}`, m.nodeId)
  for (const s of ir.sounds) claim(`sound:${s.id}`, s.nodeId)
  for (const tb of ir.tabs) claim(`tab:${tb.id}`, tb.nodeId!)
  // items not wired into any tab: hidden (only /give) by default, or collected into a main tab
  const inTab = new Set(ir.tabs.flatMap((tb) => tb.items))
  const loose = [
    ...ir.items.map((i) => `${modid}:${i.id}`),
    ...ir.blocks.filter((b) => b.hasItem).map((b) => `${modid}:${b.id}`),
    ...ir.mobs.map((m) => `${modid}:${m.id}_spawn_egg`)
  ].filter((id) => !inTab.has(id))
  if (project.meta.looseItems === 'main' && loose.length) {
    let main = ir.tabs.find((tb) => tb.id === 'main')
    if (!main) {
      main = { id: 'main', nodeId: null, title: project.meta.name, titleTh: '', icon: null, logo: null, items: [] }
      ir.tabs.unshift(main)
    }
    main.items.push(...loose.filter((id) => !main!.items.includes(id)))
  }

  if (target) {
    if (!isSupported(target.loader, target.mc)) err(undefined, `${target.loader} ${target.mc} is not supported`, `ไม่รองรับ ${target.loader} ${target.mc}`)
    else {
      const p = getProfile(target.mc)
      const fdItems = JSON.stringify([ir.recipes, ir.tabs, ir.blocks, ir.breakRules]).includes('farmersdelight:')
      if (fdItems && !usesFD && !farmersDelightFor(target.loader, target.mc))
        warn(
          undefined,
          `Farmer's Delight items are used but Farmer's Delight is not available for ${target.loader} ${target.mc}`,
          `มีการใช้ไอเทมของ Farmer's Delight แต่ ${target.loader} ${target.mc} ไม่มี Farmer's Delight`
        )
      if (usesFD && !farmersDelightFor(target.loader, target.mc))
        for (const r of ir.recipes)
          if (r.kind === 'fdCutting' || r.kind === 'fdCooking')
            warn(
              r.nodeId,
              `Farmer's Delight is not available for ${target.loader} ${target.mc}; recipe skipped`,
              `ไม่มี Farmer's Delight สำหรับ ${target.loader} ${target.mc} — ข้ามสูตรนี้`
            )
      if (!separateIconMode({ p, loader: target.loader }))
        for (const it of ir.items)
          if (it.separateIcon)
            warn(
              it.nodeId,
              `On ${target.loader} ${target.mc} the 3D model is also used as the inventory icon`,
              `ใน ${target.loader} ${target.mc} ไอคอนในช่องเก็บของจะใช้โมเดล 3D แทนเท็กซ์เจอร์`
            )
      for (const it of ir.items)
        if (it.places && !ir.blocks.some((b) => b.id === it.places))
          err(it.nodeId, 'The connected block is not part of this mod', 'บล็อกที่ต่อไว้ไม่ได้อยู่ในม็อดนี้')
      for (const r of ir.breakRules) {
        if (r.tags.length && target.mc === '1.16.5')
          warn(
            r.nodeId,
            'Block tags in Break Rules need Minecraft 1.18.2+: they are skipped on 1.16.5',
            'แท็กบล็อกในกฎการทุบต้องใช้ Minecraft 1.18.2 ขึ้นไป: ข้ามใน 1.16.5'
          )
        if (r.tool === 'sword' && r.level !== 'wood' && p.toolApi === 'toolMaterial')
          warn(r.nodeId, `On ${target.mc} swords have no mining level: any sword counts`, `ใน ${target.mc} ดาบไม่มีระดับการขุด: ดาบอะไรก็ผ่าน`)
      }
      if (usesGeo && !p.geckoArmor)
        for (const it of ir.items)
          if (it.armor?.geo) {
            warn(
              it.nodeId,
              `3D armor (GeckoLib) is not available on ${target.mc}; 2D armor is used`,
              `เกราะ 3D (GeckoLib) ใช้ไม่ได้ใน ${target.mc} — จะใช้เกราะ 2D แทน`
            )
            break
          }
    }
  }

  if (!ir.items.length && !ir.blocks.length) warn(undefined, 'The mod has no items or blocks yet', 'ม็อดยังไม่มีไอเทมหรือบล็อกเลย')
  return { ir, diagnostics: diags }
}
