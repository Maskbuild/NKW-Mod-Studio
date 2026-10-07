import { t, type L10n } from '../l10n'
import { registry } from '../ext/registry'
/**
 * Node catalogue shared by the editor (rendering, inspector) and the compiler.
 * Every pin has a type; the editor refuses connections whose types don't match.
 */

/** A pin type id. The app's own are listed in CORE_PIN_TYPES; extensions add more through the registry. */
export type PinType = string

export type { L10n }

/** Wire colour per pin type (shared with the registry: extension pin types show up here too). */
export const PIN_COLORS = registry.pinColors

export function canConnect(out: PinType, input: PinType): boolean {
  if (out === 'any' || input === 'any') return true
  if (out === input) return true
  // a Java block/item model can be worn as armor (converted for GeckoLib)
  return (out === 'item' && input === 'ingredient') || (out === 'model' && input === 'geo')
}

export interface PinDef {
  id: string
  label: L10n
  type: PinType
  /** optional pins don't raise a warning when empty */
  optional?: boolean
  /** input accepts any number of wires */
  multi?: boolean
  /** pins sharing a group appear one at a time: every wired pin plus the next free one */
  group?: string
  /** input drawn on the right edge of the node (e.g. a recipe result) */
  right?: boolean
  /** kept for old projects: only shown while something is wired into it */
  legacy?: boolean
}

export type PropKind =
  | 'id'
  | 'text'
  | 'int'
  | 'float'
  | 'bool'
  | 'select'
  | 'multi'
  | 'asset'
  | 'nsid'
  | 'textarea'
  | 'color'
  | 'animName'
  | 'craftGrid'
  | 'armorFit'
  | 'tabOrder'
  | 'blockList'
  /** the timer window editor (extensions choose it for their own timer node) */
  | 'timerUi'
  /** the skin wardrobe editor (the skins extension's hub node) */
  | 'wardrobe'

export interface PropDef {
  key: string
  label: L10n
  kind: PropKind
  default: unknown
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: L10n }[]
  assetKind?: 'texture' | 'model' | 'geo' | 'sound' | 'animation'
  hint?: L10n
  /** only shown when predicate over current data is true */
  showIf?: (data: Record<string, unknown>) => boolean
  /** blockList: block ids only (no #tags) */
  noTags?: boolean
}

/** A category id of the node library (the app's own are registered below; extensions add more). */
export type Category = string

export interface NodeDef {
  type: string
  category: Category
  title: L10n
  description: L10n
  icon: string
  inputs: PinDef[]
  outputs: PinDef[]
  props: PropDef[]
  /** registers something with an id (used for duplicate checks) */
  registers?: boolean
  /** kept for old projects, not offered in the library */
  hidden?: boolean
}

const opt = (value: string, en: string, th: string) => ({ value, label: t(en, th) })

/** Block ids a "Harvest a game crop" node covers (checked crops + typed ids; older nodes had one "crop"). */
export function gameCropIds(d: Record<string, unknown>): string[] {
  const picked = Array.isArray(d.crops)
    ? d.crops.filter((c): c is string => typeof c === 'string')
    : typeof d.crop === 'string' && d.crop !== 'custom'
      ? [d.crop]
      : d.crop === undefined
        ? ['minecraft:wheat']
        : []
  const typed = typeof d.others === 'string' ? d.others : d.crop === 'custom' && typeof d.block === 'string' ? d.block : ''
  return [...new Set([...picked, ...typed.split(/[\s,]+/).filter(Boolean)])]
}

/** Tools a Break Rule can ask for. */
export const BREAK_TOOLS = ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears', 'any'] as const
export const TOOL_LEVELS = ['wood', 'stone', 'iron', 'diamond', 'netherite'] as const

/** Entries of a Break Rule's block list: block ids and #tags (older or hand-edited data is cleaned up). */
export function breakRuleEntries(d: Record<string, unknown>): string[] {
  const list = Array.isArray(d.blocks) ? d.blocks.filter((c): c is string => typeof c === 'string') : []
  return [...new Set(list.map((x) => x.trim().toLowerCase()).filter(Boolean))]
}

const nameProps = (idDefault: string, nameDefault: string): PropDef[] => [
  { key: 'name', label: t('Display name (EN)', 'ชื่อที่แสดง (EN)'), kind: 'text', default: nameDefault },
  { key: 'nameTh', label: t('Display name (TH)', 'ชื่อที่แสดง (ไทย)'), kind: 'text', default: '' },
  {
    key: 'id',
    label: t('Registry ID', 'ID ในเกม'),
    kind: 'id',
    default: idDefault,
    hint: t('lowercase a-z, 0-9, _', 'ตัวพิมพ์เล็ก a-z, 0-9, _ เท่านั้น')
  }
]

const itemCommon: PropDef[] = [
  { key: 'maxStack', label: t('Max stack', 'จำนวนซ้อนสูงสุด'), kind: 'int', default: 64, min: 1, max: 64 },
  {
    key: 'rarity',
    label: t('Rarity', 'ความหายาก'),
    kind: 'select',
    default: 'common',
    options: [opt('common', 'Common', 'ธรรมดา'), opt('uncommon', 'Uncommon', 'ไม่ธรรมดา'), opt('rare', 'Rare', 'หายาก'), opt('epic', 'Epic', 'มหากาพย์')]
  },
  { key: 'fireResistant', label: t('Fire resistant', 'ทนไฟ'), kind: 'bool', default: false },
  {
    key: 'wearOnHead',
    label: t('Can be worn on the head', 'ใส่บนหัวได้'),
    kind: 'bool',
    default: false,
    hint: t(
      'Right-click it, or drag / shift-click it into the helmet slot. Its tooltip says it can be worn. It is shown with the model\'s "Head" display settings (Blockbench → Display → Head).',
      'คลิกขวา หรือลาก/Shift+คลิกใส่ช่องหมวกได้ ในคำอธิบายไอเทมจะมีข้อความบอกว่าสวมได้ — แสดงตามค่าการแสดงผลแบบ "Head" ของโมเดล (Blockbench → Display → Head)'
    )
  },
  {
    key: 'wearRightClick',
    label: t('Right-click to put on', 'คลิกขวาเพื่อสวมได้'),
    kind: 'bool',
    default: true,
    showIf: (data) => data.wearOnHead === true,
    hint: t('Off: it can only be dragged / shift-clicked into the helmet slot.', 'ปิด: ใส่ได้เฉพาะลาก/Shift+คลิกเข้าช่องหมวกเท่านั้น')
  },
  { key: 'glint', label: t('Enchant glint', 'มีประกายเอนชานต์'), kind: 'bool', default: false }
]

/** Block sound types (SoundType fields). */
const SOUND_OPTIONS = [
  opt('stone', 'Stone', 'หิน'),
  opt('wood', 'Wood', 'ไม้'),
  opt('metal', 'Metal', 'โลหะ'),
  opt('glass', 'Glass', 'แก้ว'),
  opt('grass', 'Grass', 'หญ้า'),
  opt('sand', 'Sand', 'ทราย'),
  opt('gravel', 'Gravel', 'กรวด'),
  opt('wool', 'Wool', 'ขนแกะ')
]

/** Tools a block is mined fast with (mineable tags). */
const MINE_TOOL_OPTIONS = [
  opt('none', 'Hand / any', 'มือเปล่า / อะไรก็ได้'),
  opt('pickaxe', 'Pickaxe', 'อีเต้อ'),
  opt('axe', 'Axe', 'ขวาน'),
  opt('shovel', 'Shovel', 'พลั่ว'),
  opt('hoe', 'Hoe', 'จอบ')
]

const blockCommon: PropDef[] = [
  {
    key: 'hasItem',
    label: t('Has its own block item', 'มีไอเทมของบล็อกเอง'),
    kind: 'bool',
    default: true,
    hint: t('Turn off for blocks placed by another item (e.g. crops placed by seeds)', 'ปิดถ้าบล็อกนี้ถูกวางด้วยไอเทมอื่น (เช่น พืชที่วางด้วยเมล็ด)')
  },
  { key: 'hardness', label: t('Hardness', 'ความแข็ง'), kind: 'float', default: 3, min: 0, max: 100, step: 0.5 },
  { key: 'resistance', label: t('Blast resistance', 'ทนระเบิด'), kind: 'float', default: 6, min: 0, max: 3600000, step: 0.5 },
  {
    key: 'sound',
    label: t('Sound type', 'เสียงบล็อก'),
    kind: 'select',
    default: 'stone',
    options: SOUND_OPTIONS
  },
  {
    key: 'tool',
    label: t('Mined with', 'ขุดด้วย'),
    kind: 'select',
    default: 'pickaxe',
    options: MINE_TOOL_OPTIONS
  },
  {
    key: 'toolLevel',
    label: t('Tool level', 'ระดับเครื่องมือ'),
    kind: 'select',
    default: 'wood',
    options: [opt('wood', 'Wood / Gold', 'ไม้ / ทอง'), opt('stone', 'Stone', 'หิน'), opt('iron', 'Iron', 'เหล็ก'), opt('diamond', 'Diamond', 'เพชร')],
    showIf: (d) => d.tool !== 'none'
  },
  { key: 'requiresTool', label: t('Requires tool to drop', 'ต้องใช้เครื่องมือถึงจะดรอป'), kind: 'bool', default: true, showIf: (d) => d.tool !== 'none' },
  { key: 'light', label: t('Light level', 'ระดับแสง'), kind: 'int', default: 0, min: 0, max: 15 },
  { key: 'dropMin', label: t('Drop count min', 'จำนวนดรอปต่ำสุด'), kind: 'int', default: 1, min: 0, max: 64 },
  { key: 'dropMax', label: t('Drop count max', 'จำนวนดรอปสูงสุด'), kind: 'int', default: 1, min: 0, max: 64 }
]

const countProp = (label = t('Result count', 'จำนวนที่ได้')): PropDef => ({
  key: 'count',
  label,
  kind: 'int',
  default: 1,
  min: 1,
  max: 64
})

const slots = (n: number, prefix: string, en: string, th: string, type: PinType = 'ingredient', extra: Partial<PinDef> = {}): PinDef[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i + 1}`,
    label: t(`${en} ${i + 1}`, `${th} ${i + 1}`),
    type,
    optional: true,
    ...extra
  }))

const resultPin = (): PinDef => ({ id: 'result', label: t('Result', 'ผลลัพธ์'), type: 'item', right: true })

const texIn = (id = 'texture', en = 'Texture', th = 'เท็กซ์เจอร์', optional = false): PinDef => ({
  id,
  label: t(en, th),
  type: 'texture',
  optional
})

/** Vanilla status effects (Mojang field names in MobEffects). */
export const EFFECTS: { value: string; label: L10n }[] = [
  opt('MOVEMENT_SPEED', 'Speed', 'ความเร็ว'),
  opt('MOVEMENT_SLOWDOWN', 'Slowness', 'ความช้า'),
  opt('DIG_SPEED', 'Haste', 'ขุดเร็ว'),
  opt('DIG_SLOWDOWN', 'Mining Fatigue', 'ขุดช้า'),
  opt('DAMAGE_BOOST', 'Strength', 'พลังโจมตี'),
  opt('HEAL', 'Instant Health', 'ฟื้นพลังทันที'),
  opt('HARM', 'Instant Damage', 'ความเสียหายทันที'),
  opt('JUMP', 'Jump Boost', 'กระโดดสูง'),
  opt('CONFUSION', 'Nausea', 'คลื่นไส้'),
  opt('REGENERATION', 'Regeneration', 'ฟื้นฟูพลังชีวิต'),
  opt('DAMAGE_RESISTANCE', 'Resistance', 'ต้านทาน'),
  opt('FIRE_RESISTANCE', 'Fire Resistance', 'ต้านทานไฟ'),
  opt('WATER_BREATHING', 'Water Breathing', 'หายใจใต้น้ำ'),
  opt('INVISIBILITY', 'Invisibility', 'ล่องหน'),
  opt('BLINDNESS', 'Blindness', 'ตาบอด'),
  opt('NIGHT_VISION', 'Night Vision', 'มองเห็นในที่มืด'),
  opt('HUNGER', 'Hunger', 'หิวโหย'),
  opt('WEAKNESS', 'Weakness', 'อ่อนแอ'),
  opt('POISON', 'Poison', 'พิษ'),
  opt('WITHER', 'Wither', 'เหี่ยวเฉา'),
  opt('HEALTH_BOOST', 'Health Boost', 'เพิ่มพลังชีวิตสูงสุด'),
  opt('ABSORPTION', 'Absorption', 'ดูดซับ'),
  opt('SATURATION', 'Saturation', 'อิ่มทิพย์'),
  opt('GLOWING', 'Glowing', 'เรืองแสง'),
  opt('LEVITATION', 'Levitation', 'ลอยตัว'),
  opt('LUCK', 'Luck', 'โชคดี'),
  opt('UNLUCK', 'Bad Luck', 'โชคร้าย'),
  opt('SLOW_FALLING', 'Slow Falling', 'ตกช้า'),
  opt('CONDUIT_POWER', 'Conduit Power', 'พลังคอนดูอิต'),
  opt('DOLPHINS_GRACE', "Dolphin's Grace", 'ว่ายน้ำเร็ว')
]

/**
 * Player attributes offered by the Stat Bonus node (Mojang field names in Attributes). `since` is the
 * first supported Minecraft version that has it for players; older targets skip it with a warning.
 */
export const ATTRIBUTES: { id: string; field: string; since: string; label: L10n }[] = [
  { id: 'max_health', field: 'MAX_HEALTH', since: '1.16.5', label: t('Max health', 'เลือดสูงสุด') },
  { id: 'armor', field: 'ARMOR', since: '1.16.5', label: t('Armor', 'เกราะ') },
  { id: 'armor_toughness', field: 'ARMOR_TOUGHNESS', since: '1.16.5', label: t('Armor toughness', 'ความแกร่งของเกราะ') },
  { id: 'attack_damage', field: 'ATTACK_DAMAGE', since: '1.16.5', label: t('Attack damage', 'พลังโจมตี') },
  { id: 'attack_speed', field: 'ATTACK_SPEED', since: '1.16.5', label: t('Attack speed', 'ความเร็วโจมตี') },
  { id: 'attack_knockback', field: 'ATTACK_KNOCKBACK', since: '1.16.5', label: t('Attack knockback', 'แรงกระแทกตอนตี') },
  { id: 'knockback_resistance', field: 'KNOCKBACK_RESISTANCE', since: '1.16.5', label: t('Knockback resistance', 'ต้านแรงกระแทก') },
  { id: 'movement_speed', field: 'MOVEMENT_SPEED', since: '1.16.5', label: t('Movement speed', 'ความเร็วเดิน') },
  { id: 'luck', field: 'LUCK', since: '1.16.5', label: t('Luck', 'โชค') },
  { id: 'max_absorption', field: 'MAX_ABSORPTION', since: '1.20.4', label: t('Max absorption', 'เลือดเสริมสูงสุด') },
  { id: 'jump_strength', field: 'JUMP_STRENGTH', since: '1.21.1', label: t('Jump strength', 'กระโดดสูง') },
  { id: 'block_interaction_range', field: 'BLOCK_INTERACTION_RANGE', since: '1.21.1', label: t('Block reach (mine / place far)', 'ระยะขุด/วางบล็อก (ขุดไกล)') },
  { id: 'entity_interaction_range', field: 'ENTITY_INTERACTION_RANGE', since: '1.21.1', label: t('Attack reach', 'ระยะตีศัตรู') },
  { id: 'block_break_speed', field: 'BLOCK_BREAK_SPEED', since: '1.21.1', label: t('Block break speed', 'ความเร็วทุบบล็อก') },
  { id: 'scale', field: 'SCALE', since: '1.21.1', label: t('Size (scale)', 'ขนาดตัว') },
  { id: 'step_height', field: 'STEP_HEIGHT', since: '1.21.1', label: t('Step height', 'ก้าวขึ้นที่สูง') },
  { id: 'gravity', field: 'GRAVITY', since: '1.21.1', label: t('Gravity', 'แรงโน้มถ่วง') },
  { id: 'safe_fall_distance', field: 'SAFE_FALL_DISTANCE', since: '1.21.1', label: t('Safe fall distance', 'ระยะตกที่ไม่เจ็บ') },
  { id: 'fall_damage_multiplier', field: 'FALL_DAMAGE_MULTIPLIER', since: '1.21.1', label: t('Fall damage multiplier', 'ตัวคูณความเสียหายจากการตก') },
  { id: 'burning_time', field: 'BURNING_TIME', since: '1.21.1', label: t('Burning time', 'ระยะเวลาไฟไหม้') },
  {
    id: 'explosion_knockback_resistance',
    field: 'EXPLOSION_KNOCKBACK_RESISTANCE',
    since: '1.21.1',
    label: t('Explosion knockback resistance', 'ต้านแรงระเบิด')
  },
  { id: 'mining_efficiency', field: 'MINING_EFFICIENCY', since: '1.21.1', label: t('Mining efficiency', 'ประสิทธิภาพการขุด') },
  { id: 'movement_efficiency', field: 'MOVEMENT_EFFICIENCY', since: '1.21.1', label: t('Movement efficiency (rough ground)', 'เดินบนพื้นช้าได้เร็วขึ้น') },
  { id: 'oxygen_bonus', field: 'OXYGEN_BONUS', since: '1.21.1', label: t('Oxygen bonus (breath underwater)', 'กลั้นหายใจใต้น้ำนานขึ้น') },
  { id: 'sneaking_speed', field: 'SNEAKING_SPEED', since: '1.21.1', label: t('Sneaking speed', 'ความเร็วตอนย่อง') },
  { id: 'submerged_mining_speed', field: 'SUBMERGED_MINING_SPEED', since: '1.21.1', label: t('Underwater mining speed', 'ความเร็วขุดใต้น้ำ') },
  { id: 'sweeping_damage_ratio', field: 'SWEEPING_DAMAGE_RATIO', since: '1.21.1', label: t('Sweeping damage', 'ความเสียหายฟันกวาด') },
  { id: 'water_movement_efficiency', field: 'WATER_MOVEMENT_EFFICIENCY', since: '1.21.1', label: t('Water movement', 'ว่ายน้ำเร็ว') }
]

const effectIns = (en: string, th: string): PinDef[] =>
  [1, 2, 3].map((i) => ({ id: `effect${i}`, label: t(`${en} ${i}`, `${th} ${i}`), type: 'effect' as PinType, optional: true }))

const CORE_NODE_DEFS: NodeDef[] = [
  // ───────────── Assets ─────────────
  {
    type: 'texture',
    category: 'asset',
    title: t('Texture', 'เท็กซ์เจอร์'),
    description: t('A PNG image (16×16 recommended)', 'ไฟล์รูป PNG (แนะนำ 16×16)'),
    icon: '🖼',
    inputs: [],
    outputs: [{ id: 'out', label: t('Texture', 'เท็กซ์เจอร์'), type: 'texture' }],
    props: [
      { key: 'asset', label: t('Image file', 'ไฟล์รูป'), kind: 'asset', assetKind: 'texture', default: '' },
      {
        key: 'animated',
        label: t('Animated (frames stacked vertically)', 'ภาพเคลื่อนไหว (เฟรมเรียงแนวตั้ง)'),
        kind: 'bool',
        default: false,
        hint: t('A 16×64 image = 4 frames of 16×16', 'รูปขนาด 16×64 = 4 เฟรม ขนาด 16×16')
      },
      {
        key: 'frameTime',
        label: t('Ticks per frame (20 = 1 s)', 'tick ต่อเฟรม (20 = 1 วินาที)'),
        kind: 'int',
        default: 2,
        min: 1,
        max: 200,
        showIf: (d) => !!d.animated
      },
      { key: 'interpolate', label: t('Smooth blend between frames', 'เฟดระหว่างเฟรม'), kind: 'bool', default: false, showIf: (d) => !!d.animated }
    ]
  },
  {
    type: 'model',
    category: 'asset',
    title: t('3D Model (Blockbench)', 'โมเดล 3D (Blockbench)'),
    description: t(
      'Java block/item model (.json) or Blockbench project (.bbmodel). Texture pins map to the model texture slots in order.',
      'โมเดล Java (.json) หรือโปรเจกต์ Blockbench (.bbmodel) — ขาเท็กซ์เจอร์จับคู่กับช่องเท็กซ์เจอร์ของโมเดลตามลำดับ'
    ),
    icon: '🧊',
    inputs: [
      texIn('tex0', 'Texture #0', 'เท็กซ์เจอร์ #0'),
      texIn('tex1', 'Texture #1', 'เท็กซ์เจอร์ #1', true),
      texIn('tex2', 'Texture #2', 'เท็กซ์เจอร์ #2', true),
      texIn('tex3', 'Texture #3', 'เท็กซ์เจอร์ #3', true)
    ],
    outputs: [{ id: 'out', label: t('Model', 'โมเดล'), type: 'model' }],
    props: [{ key: 'asset', label: t('Model file', 'ไฟล์โมเดล'), kind: 'asset', assetKind: 'model', default: '' }]
  },
  {
    type: 'geoModel',
    category: 'asset',
    title: t('3D Armor Model (Blockbench)', 'โมเดลเกราะ 3D (Blockbench)'),
    description: t(
      'A Blockbench model: the .bbmodel project itself or a GeckoLib .geo.json. Armor templates use bones armorHead, armorBody, armorRightArm/LeftArm, armorRightLeg/LeftLeg, armorRightBoot/LeftBoot; any other model is placed on the body part of the armor piece automatically.',
      'โมเดลจาก Blockbench: ไฟล์โปรเจกต์ .bbmodel ได้เลย หรือ .geo.json (GeckoLib) — ถ้าเป็นเทมเพลตเกราะใช้ bone armorHead, armorBody, armorRightArm/LeftArm, armorRightLeg/LeftLeg, armorRightBoot/LeftBoot ส่วนโมเดลแบบอื่นจะถูกวางบนส่วนของร่างกายตามชิ้นเกราะให้อัตโนมัติ'
    ),
    icon: '🦾',
    inputs: [texIn('texture', 'Model texture', 'เท็กซ์เจอร์โมเดล'), { id: 'animation', label: t('Animation', 'อนิเมชัน'), type: 'animation', optional: true }],
    outputs: [{ id: 'out', label: t('Geo model', 'โมเดล Geo'), type: 'geo' }],
    props: [{ key: 'asset', label: t('Geo file', 'ไฟล์ .geo.json'), kind: 'asset', assetKind: 'geo', default: '' }]
  },
  {
    type: 'animation',
    category: 'asset',
    title: t('GeckoLib Animation', 'อนิเมชัน GeckoLib'),
    description: t(
      'Blockbench animation file (.animation.json). The chosen animation loops while the armor is worn.',
      'ไฟล์อนิเมชันจาก Blockbench (.animation.json) — อนิเมชันที่เลือกจะเล่นวนตลอดตอนสวมใส่'
    ),
    icon: '🎞',
    inputs: [],
    outputs: [{ id: 'out', label: t('Animation', 'อนิเมชัน'), type: 'animation' }],
    props: [
      { key: 'asset', label: t('Animation file', 'ไฟล์อนิเมชัน'), kind: 'asset', assetKind: 'animation', default: '' },
      { key: 'anim', label: t('Animation to loop', 'อนิเมชันที่จะเล่นวน'), kind: 'animName', default: '' }
    ]
  },
  {
    type: 'soundFile',
    category: 'asset',
    title: t('Sound File', 'ไฟล์เสียง'),
    description: t('An .ogg sound file (Ogg Vorbis)', 'ไฟล์เสียง .ogg (Ogg Vorbis)'),
    icon: '🔊',
    inputs: [],
    outputs: [{ id: 'out', label: t('Sound', 'เสียง'), type: 'sound' }],
    props: [{ key: 'asset', label: t('Sound file', 'ไฟล์เสียง'), kind: 'asset', assetKind: 'sound', default: '' }]
  },

  // ───────────── Items ─────────────
  {
    type: 'item',
    category: 'item',
    title: t('Item', 'ไอเทม'),
    description: t('A simple item', 'ไอเทมทั่วไป'),
    icon: '💎',
    registers: true,
    inputs: [
      texIn('texture', 'Icon texture', 'ไอคอน / เท็กซ์เจอร์', true),
      { id: 'model', label: t('3D model', 'โมเดล 3D'), type: 'model', optional: true },
      { id: 'places', label: t('Places block', 'วางเป็นบล็อก'), type: 'block', optional: true },
      ...slots(8, 'attr', 'Stat bonus', 'โบนัสค่าสถานะ', 'attribute', { group: 'attr' })
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('my_item', 'My Item'),
      ...itemCommon,
      { key: 'handheld', label: t('Held like a tool', 'ถือแบบเครื่องมือ'), kind: 'bool', default: false }
    ]
  },
  {
    type: 'food',
    category: 'item',
    title: t('Food', 'อาหาร'),
    description: t('An edible item', 'ไอเทมที่กินได้'),
    icon: '🍖',
    registers: true,
    inputs: [
      texIn('texture', 'Icon texture', 'ไอคอน / เท็กซ์เจอร์', true),
      { id: 'model', label: t('3D model', 'โมเดล 3D'), type: 'model', optional: true },
      { id: 'places', label: t('Places block', 'วางเป็นบล็อก'), type: 'block', optional: true },
      ...effectIns('Effect when eaten', 'เอฟเฟกต์ตอนกิน'),
      ...slots(3, 'hit', 'Ability when eaten', 'ความสามารถตอนกิน', 'hit', { group: 'hit' }),
      ...slots(8, 'attr', 'Stat bonus', 'โบนัสค่าสถานะ', 'attribute', { group: 'attr' })
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('my_food', 'My Food'),
      { key: 'nutrition', label: t('Hunger restored', 'ฟื้นฟูความหิว'), kind: 'int', default: 4, min: 0, max: 20 },
      { key: 'saturation', label: t('Saturation', 'ความอิ่ม'), kind: 'float', default: 0.3, min: 0, max: 5, step: 0.1 },
      { key: 'alwaysEdible', label: t('Edible when full', 'กินได้แม้อิ่ม'), kind: 'bool', default: false },
      { key: 'fast', label: t('Eat fast', 'กินเร็ว'), kind: 'bool', default: false },
      {
        key: 'useSound',
        label: t('Eating sound', 'เสียงตอนกิน'),
        kind: 'select',
        default: 'eat',
        options: [opt('eat', 'Eat (munching)', 'กิน (เสียงเคี้ยว)'), opt('drink', 'Drink (gulping, like a potion)', 'ดื่ม (เสียงกลืน แบบขวดยา)')],
        hint: t('Also changes the animation: drinking holds the item up like a potion.', 'เปลี่ยนท่าทางด้วย: ดื่มจะยกขึ้นแบบดื่มขวดยา')
      },
      ...itemCommon
    ]
  },
  {
    type: 'toolMaterial',
    category: 'item',
    title: t('Tool Material', 'วัสดุเครื่องมือ'),
    description: t('Stats shared by a set of tools', 'ค่าสถานะที่ใช้ร่วมกันของชุดเครื่องมือ'),
    icon: '⚙',
    registers: true,
    inputs: [{ id: 'repair', label: t('Repair with', 'ซ่อมด้วย'), type: 'ingredient', optional: true }],
    outputs: [{ id: 'out', label: t('Material', 'วัสดุ'), type: 'toolMat' }],
    props: [
      { key: 'id', label: t('Material ID', 'ID วัสดุ'), kind: 'id', default: 'my_material' },
      { key: 'durability', label: t('Durability', 'ความทนทาน'), kind: 'int', default: 500, min: 1, max: 100000 },
      { key: 'speed', label: t('Mining speed', 'ความเร็วขุด'), kind: 'float', default: 6, min: 0, max: 100, step: 0.5 },
      { key: 'damage', label: t('Attack damage bonus', 'ดาเมจเพิ่ม'), kind: 'float', default: 2, min: 0, max: 100, step: 0.5 },
      {
        key: 'level',
        label: t('Mining level', 'ระดับการขุด'),
        kind: 'select',
        default: 'iron',
        options: [
          opt('wood', 'Wood', 'ไม้'),
          opt('stone', 'Stone', 'หิน'),
          opt('iron', 'Iron', 'เหล็ก'),
          opt('diamond', 'Diamond', 'เพชร'),
          opt('netherite', 'Netherite', 'เนเธอไรต์')
        ]
      },
      { key: 'enchantability', label: t('Enchantability', 'ค่าเอนชานต์'), kind: 'int', default: 14, min: 0, max: 100 }
    ]
  },
  {
    type: 'tool',
    category: 'item',
    title: t('Tool / Weapon', 'เครื่องมือ / อาวุธ'),
    description: t('Sword, pickaxe, axe, shovel or hoe', 'ดาบ อีเต้อ ขวาน พลั่ว หรือจอบ'),
    icon: '⚔',
    registers: true,
    inputs: [
      texIn(),
      { id: 'material', label: t('Material (optional: iron)', 'วัสดุ (ไม่ใส่ = เหล็ก)'), type: 'toolMat', optional: true },
      { id: 'model', label: t('3D model', 'โมเดล 3D'), type: 'model', optional: true },
      ...effectIns('Effect on hit target', 'เอฟเฟกต์ใส่ศัตรูที่ตี'),
      ...slots(3, 'hit', 'Hit ability', 'ความสามารถตอนตี', 'hit', { group: 'hit' }),
      ...slots(8, 'attr', 'Stat bonus', 'โบนัสค่าสถานะ', 'attribute', { group: 'attr' })
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('my_sword', 'My Sword'),
      {
        key: 'toolType',
        label: t('Tool type', 'ประเภท'),
        kind: 'select',
        default: 'sword',
        options: [
          opt('sword', 'Sword', 'ดาบ'),
          opt('pickaxe', 'Pickaxe', 'อีเต้อ'),
          opt('axe', 'Axe', 'ขวาน'),
          opt('shovel', 'Shovel', 'พลั่ว'),
          opt('hoe', 'Hoe', 'จอบ')
        ]
      },
      { key: 'attackDamage', label: t('Extra attack damage', 'ดาเมจเพิ่มเติม'), kind: 'float', default: 3, min: -10, max: 1000, step: 0.5 },
      { key: 'attackSpeed', label: t('Attack speed modifier', 'ค่าความเร็วโจมตี'), kind: 'float', default: -2.4, min: -4, max: 10, step: 0.1 },
      { key: 'fireResistant', label: t('Fire resistant', 'ทนไฟ'), kind: 'bool', default: false },
      {
        key: 'wearOnHead',
        label: t('Can be worn on the head', 'ใส่บนหัวได้'),
        kind: 'bool',
        default: false,
        hint: t(
          'Right-click it, or drag / shift-click it into the helmet slot. Its tooltip says it can be worn. It is shown with the model\'s "Head" display settings (Blockbench → Display → Head).',
          'คลิกขวา หรือลาก/Shift+คลิกใส่ช่องหมวกได้ ในคำอธิบายไอเทมจะมีข้อความบอกว่าสวมได้ — แสดงตามค่าการแสดงผลแบบ "Head" ของโมเดล (Blockbench → Display → Head)'
        )
      },
      {
        key: 'wearRightClick',
        label: t('Right-click to put on', 'คลิกขวาเพื่อสวมได้'),
        kind: 'bool',
        default: true,
        showIf: (data) => data.wearOnHead === true,
        hint: t('Off: it can only be dragged / shift-clicked into the helmet slot.', 'ปิด: ใส่ได้เฉพาะลาก/Shift+คลิกเข้าช่องหมวกเท่านั้น')
      },
      { key: 'rarity', label: t('Rarity', 'ความหายาก'), kind: 'select', default: 'common', options: itemCommon[1].options },
      {
        key: 'unbreakable',
        label: t('Unbreakable (never breaks)', 'ไม่มีวันพัง'),
        kind: 'bool',
        default: false,
        hint: t('Never loses durability. The tooltip says "Unbreakable".', 'ไม่เสียความคงทนเลย คำอธิบายไอเทมจะขึ้นว่า "Unbreakable"')
      },
      {
        key: 'durability',
        label: t('Durability (0 = from the material)', 'ความคงทน (0 = ตามวัสดุ)'),
        kind: 'int',
        default: 0,
        min: 0,
        max: 100000,
        showIf: (d) => d.unbreakable !== true,
        hint: t('How many uses before it breaks. Iron tools: 250, diamond: 1561.', 'ใช้ได้กี่ครั้งก่อนพัง — เครื่องมือเหล็ก 250, เพชร 1561')
      }
    ]
  },

  // ───────────── Blocks ─────────────
  {
    type: 'block',
    category: 'block',
    title: t('Block', 'บล็อก'),
    description: t('A full cube block', 'บล็อกลูกบาศก์ปกติ'),
    icon: '🧱',
    registers: true,
    inputs: [
      texIn('texture', 'Texture (all / side)', 'เท็กซ์เจอร์ (ทุกด้าน / ด้านข้าง)'),
      texIn('top', 'Top texture', 'เท็กซ์เจอร์ด้านบน', true),
      texIn('bottom', 'Bottom texture', 'เท็กซ์เจอร์ด้านล่าง', true),
      { id: 'drop', label: t('Drops (default: itself)', 'ของที่ดรอป (ปกติ: ตัวเอง)'), type: 'item', optional: true }
    ],
    outputs: [
      { id: 'out', label: t('Block item', 'ไอเทมบล็อก'), type: 'item' },
      { id: 'block', label: t('Block (to place)', 'บล็อก (สำหรับวาง)'), type: 'block' }
    ],
    props: [
      ...nameProps('my_block', 'My Block'),
      {
        key: 'shape',
        label: t('Texture layout', 'รูปแบบเท็กซ์เจอร์'),
        kind: 'select',
        default: 'cube_all',
        options: [
          opt('cube_all', 'Same on all sides', 'เหมือนกันทุกด้าน'),
          opt('cube_bottom_top', 'Top / sides / bottom', 'บน / ข้าง / ล่าง'),
          opt('pillar', 'Pillar (log-like, rotates)', 'เสา (แบบท่อนไม้ หมุนได้)')
        ]
      },
      ...blockCommon
    ]
  },
  {
    type: 'block3d',
    category: 'block',
    title: t('3D Block', 'บล็อก 3D'),
    description: t('A block using a Blockbench model; hitbox is computed from the model', 'บล็อกที่ใช้โมเดลจาก Blockbench — hitbox คำนวณจากโมเดลอัตโนมัติ'),
    icon: '🗿',
    registers: true,
    inputs: [
      { id: 'model', label: t('Model', 'โมเดล'), type: 'model' },
      { id: 'drop', label: t('Drops (default: itself)', 'ของที่ดรอป (ปกติ: ตัวเอง)'), type: 'item', optional: true }
    ],
    outputs: [
      { id: 'out', label: t('Block item', 'ไอเทมบล็อก'), type: 'item' },
      { id: 'block', label: t('Block (to place)', 'บล็อก (สำหรับวาง)'), type: 'block' }
    ],
    props: [
      ...nameProps('my_model_block', 'My Model Block'),
      { key: 'rotatable', label: t('Faces the player when placed', 'หันหน้าเข้าหาผู้เล่นตอนวาง'), kind: 'bool', default: true },
      { key: 'solid', label: t('Has collision', 'มีการชน'), kind: 'bool', default: true },
      ...blockCommon
    ]
  },

  {
    type: 'crop',
    category: 'farm',
    title: t('Crop (plant)', 'พืช (ปลูกได้)'),
    description: t(
      'A plant that grows in stages on farmland. Wire its Block pin into a seeds Item\'s "Places block" pin. Harvest by breaking (replant like wheat) or pick it and let it grow back after a cooldown; picking can be a click, holding the button or standing still for a while, with a timer on screen.',
      'พืชที่โตเป็นระยะบนดินไถ ต่อขา "บล็อก" เข้าขา "วางเป็นบล็อก" ของไอเทมเมล็ด เก็บได้แบบทุบแล้วปลูกใหม่ (แบบข้าวสาลี) หรือเก็บแล้วรอโตใหม่ตามเวลาคูลดาวน์ การเก็บเป็นแบบคลิก กดค้าง หรือกดแล้วยืนนิ่งตามเวลาได้ มีเวลาแสดงบนจอ'
    ),
    icon: '🌱',
    registers: true,
    inputs: [
      ...slots(8, 'stage', 'Growth stage', 'ระยะการโต', 'texture', { group: 'stage' }),
      { id: 'produce', label: t('Harvest (item)', 'ผลผลิต (ไอเทม)'), type: 'item' }
    ],
    outputs: [{ id: 'block', label: t('Block (for the seeds)', 'บล็อก (ต่อเข้าเมล็ด)'), type: 'block' }],
    props: [
      ...nameProps('my_crop', 'My Crop'),
      {
        key: 'look',
        label: t('Look', 'รูปทรง'),
        kind: 'select',
        default: 'crop',
        options: [opt('crop', '# like wheat', '# แบบข้าวสาลี'), opt('cross', 'X like a flower / berry bush', 'X แบบดอกไม้ / พุ่มเบอร์รี')]
      },
      {
        key: 'soil',
        label: t('Grows on', 'ปลูกบน'),
        kind: 'select',
        default: 'farmland',
        options: [opt('farmland', 'Farmland', 'ดินไถ'), opt('dirt', 'Farmland, dirt and grass', 'ดินไถ ดิน และหญ้า')]
      },
      {
        key: 'growSeconds',
        label: t('Time to grow (seconds, 0 = like wheat)', 'เวลาโตเต็มที่ (วินาที, 0 = แบบข้าวสาลี)'),
        kind: 'int',
        default: 0,
        min: 0,
        max: 36000,
        hint: t('0: grows at random like vanilla crops (faster on wet farmland).', '0: โตแบบสุ่มเหมือนพืชในเกม (ดินไถเปียกโตเร็วกว่า)')
      },
      { key: 'produceMin', label: t('Harvest count min', 'จำนวนผลผลิตต่ำสุด'), kind: 'int', default: 1, min: 1, max: 64 },
      { key: 'produceMax', label: t('Harvest count max', 'จำนวนผลผลิตสูงสุด'), kind: 'int', default: 2, min: 1, max: 64 },
      {
        key: 'seedMin',
        label: t('Seeds back min', 'ได้เมล็ดคืนต่ำสุด'),
        kind: 'int',
        default: 1,
        min: 0,
        max: 64,
        showIf: (d) => d.mode !== 'regrow'
      },
      { key: 'seedMax', label: t('Seeds back max', 'ได้เมล็ดคืนสูงสุด'), kind: 'int', default: 3, min: 0, max: 64, showIf: (d) => d.mode !== 'regrow' }
    ]
  },

  // ───────────── Armor ─────────────
  {
    type: 'armorMaterial',
    category: 'armor',
    title: t('Armor Material', 'วัสดุเกราะ'),
    description: t('Protection stats + worn textures (layer 1 = body, layer 2 = legs)', 'ค่าป้องกัน + เท็กซ์เจอร์ตอนสวมใส่ (layer 1 = ตัว, layer 2 = ขา)'),
    icon: '🛡',
    registers: true,
    inputs: [
      texIn('layer1', 'Worn texture (layer 1)', 'เท็กซ์เจอร์ตอนใส่ (layer 1)'),
      texIn('layer2', 'Worn texture (layer 2)', 'เท็กซ์เจอร์ตอนใส่ (layer 2)'),
      { id: 'repair', label: t('Repair with', 'ซ่อมด้วย'), type: 'ingredient', optional: true }
    ],
    outputs: [{ id: 'out', label: t('Armor material', 'วัสดุเกราะ'), type: 'armorMat' }],
    props: [
      { key: 'id', label: t('Material ID', 'ID วัสดุ'), kind: 'id', default: 'my_armor' },
      { key: 'durability', label: t('Durability multiplier', 'ตัวคูณความทนทาน'), kind: 'int', default: 20, min: 1, max: 1000 },
      { key: 'helmet', label: t('Helmet protection', 'เกราะหมวก'), kind: 'int', default: 2, min: 0, max: 30 },
      { key: 'chestplate', label: t('Chestplate protection', 'เกราะเสื้อ'), kind: 'int', default: 6, min: 0, max: 30 },
      { key: 'leggings', label: t('Leggings protection', 'เกราะกางเกง'), kind: 'int', default: 5, min: 0, max: 30 },
      { key: 'boots', label: t('Boots protection', 'เกราะรองเท้า'), kind: 'int', default: 2, min: 0, max: 30 },
      { key: 'enchantability', label: t('Enchantability', 'ค่าเอนชานต์'), kind: 'int', default: 15, min: 0, max: 100 },
      { key: 'toughness', label: t('Toughness', 'ความแกร่ง'), kind: 'float', default: 0, min: 0, max: 20, step: 0.5 },
      { key: 'knockback', label: t('Knockback resistance', 'ต้านแรงกระแทก'), kind: 'float', default: 0, min: 0, max: 1, step: 0.05 },
      {
        key: 'equipSound',
        label: t('Equip sound', 'เสียงตอนสวม'),
        kind: 'select',
        default: 'iron',
        options: [
          opt('generic', 'Generic', 'ทั่วไป'),
          opt('leather', 'Leather', 'หนัง'),
          opt('chain', 'Chain', 'โซ่'),
          opt('iron', 'Iron', 'เหล็ก'),
          opt('gold', 'Gold', 'ทอง'),
          opt('diamond', 'Diamond', 'เพชร'),
          opt('netherite', 'Netherite', 'เนเธอไรต์')
        ]
      }
    ]
  },
  {
    type: 'armorSet',
    category: 'armor',
    hidden: true,
    title: t('Armor Set', 'ชุดเกราะ'),
    description: t(
      'Helmet, chestplate, leggings and boots. Connect a GeckoLib model for 3D armor.',
      'หมวก เสื้อ กางเกง รองเท้า — ต่อโมเดล GeckoLib เพื่อทำเกราะ 3D'
    ),
    icon: '🥋',
    registers: true,
    inputs: [
      { id: 'material', label: t('Armor material (optional: iron)', 'วัสดุเกราะ (ไม่ใส่ = เหล็ก)'), type: 'armorMat', optional: true },
      texIn('helmetIcon', 'Helmet icon', 'ไอคอนหมวก', true),
      texIn('chestplateIcon', 'Chestplate icon', 'ไอคอนเสื้อ', true),
      texIn('leggingsIcon', 'Leggings icon', 'ไอคอนกางเกง', true),
      texIn('bootsIcon', 'Boots icon', 'ไอคอนรองเท้า', true),
      { id: 'geo', label: t('3D model (GeckoLib)', 'โมเดล 3D (GeckoLib)'), type: 'geo', optional: true }
    ],
    outputs: [
      { id: 'helmet', label: t('Helmet', 'หมวก'), type: 'item' },
      { id: 'chestplate', label: t('Chestplate', 'เสื้อเกราะ'), type: 'item' },
      { id: 'leggings', label: t('Leggings', 'กางเกงเกราะ'), type: 'item' },
      { id: 'boots', label: t('Boots', 'รองเท้า'), type: 'item' }
    ],
    props: [
      { key: 'baseId', label: t('Base ID', 'ID หลัก'), kind: 'id', default: 'my', hint: t('my → my_helmet, my_chestplate…', 'my → my_helmet, my_chestplate…') },
      { key: 'name', label: t('Base name (EN)', 'ชื่อหลัก (EN)'), kind: 'text', default: 'My' },
      { key: 'nameTh', label: t('Base name (TH)', 'ชื่อหลัก (ไทย)'), kind: 'text', default: '' },
      { key: 'helmet', label: t('Include helmet', 'มีหมวก'), kind: 'bool', default: true },
      { key: 'chestplate', label: t('Include chestplate', 'มีเสื้อ'), kind: 'bool', default: true },
      { key: 'leggings', label: t('Include leggings', 'มีกางเกง'), kind: 'bool', default: true },
      { key: 'boots', label: t('Include boots', 'มีรองเท้า'), kind: 'bool', default: true },
      { key: 'rarity', label: t('Rarity', 'ความหายาก'), kind: 'select', default: 'common', options: itemCommon[1].options },
      { key: 'fireResistant', label: t('Fire resistant', 'ทนไฟ'), kind: 'bool', default: false }
    ]
  },

  {
    type: 'armorPiece',
    category: 'armor',
    title: t('Armor Piece', 'ชิ้นเกราะ'),
    description: t(
      'One wearable piece (helmet, chestplate, leggings or boots). Works on its own (iron stats and look); add an Armor Material, a 3D model (.bbmodel, .geo.json or a .json block/item model), animation and effects as you like.',
      'ของสวมใส่ 1 ชิ้น (หมวก เสื้อ กางเกง หรือรองเท้า) — ใช้ได้เลยไม่ต้องต่ออะไร (ค่าและหน้าตาแบบเหล็ก) จะเพิ่มวัสดุเกราะ โมเดล 3D (.bbmodel, .geo.json หรือโมเดล .json ของบล็อก/ไอเทม) อนิเมชัน และเอฟเฟกต์ก็ได้'
    ),
    icon: '🪖',
    registers: true,
    inputs: [
      { id: 'material', label: t('Armor material (optional: iron)', 'วัสดุเกราะ (ไม่ใส่ = เหล็ก)'), type: 'armorMat', optional: true },
      texIn('icon', 'Icon texture', 'ไอคอน'),
      { id: 'geo', label: t('3D model (Blockbench / .json)', 'โมเดล 3D (Blockbench / .json)'), type: 'geo', optional: true },
      ...effectIns('Effect while worn', 'เอฟเฟกต์ตอนสวม'),
      ...slots(8, 'attr', 'Stat bonus', 'โบนัสค่าสถานะ', 'attribute', { group: 'attr' })
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('my_helmet', 'My Helmet'),
      {
        key: 'slot',
        label: t('Slot', 'ตำแหน่งที่สวม'),
        kind: 'select',
        default: 'helmet',
        options: [
          opt('helmet', 'Helmet (head)', 'หมวก (หัว)'),
          opt('chestplate', 'Chestplate (body)', 'เสื้อ (ลำตัว)'),
          opt('leggings', 'Leggings (legs)', 'กางเกง (ขา)'),
          opt('boots', 'Boots (feet)', 'รองเท้า (เท้า)')
        ]
      },
      { key: 'rarity', label: t('Rarity', 'ความหายาก'), kind: 'select', default: 'common', options: itemCommon[1].options },
      { key: 'fireResistant', label: t('Fire resistant', 'ทนไฟ'), kind: 'bool', default: false },
      {
        key: 'iconFrom',
        label: t('Inventory icon', 'ไอคอนไอเทม (ในช่องเก็บของ)'),
        kind: 'select',
        default: 'texture',
        options: [opt('texture', 'Icon texture (2D)', 'รูปไอคอน (2D)'), opt('model', 'The 3D model (.bbmodel / .json)', 'โมเดล 3D (.bbmodel / .json)')],
        hint: t(
          '"The 3D model" shows the connected 3D model as the item, like a block in the inventory.',
          '"โมเดล 3D" จะแสดงโมเดลที่ต่อไว้เป็นตัวไอเทม แบบเดียวกับบล็อกในช่องเก็บของ'
        )
      },
      { key: 'fit', label: t('Fit on the player', 'การสวมบนตัวผู้เล่น'), kind: 'armorFit', default: null }
    ]
  },

  // ───────────── Effects ─────────────
  {
    type: 'effect',
    category: 'effect',
    title: t('Status Effect', 'เอฟเฟกต์'),
    description: t(
      'A potion effect for food (when eaten), tools (on hit) or armor (while worn)',
      'เอฟเฟกต์ยา ใช้กับอาหาร (ตอนกิน) อาวุธ (ตอนตี) หรือเกราะ (ตอนสวม)'
    ),
    icon: '✨',
    inputs: [],
    outputs: [{ id: 'out', label: t('Effect', 'เอฟเฟกต์'), type: 'effect' }],
    props: [
      { key: 'effect', label: t('Effect', 'เอฟเฟกต์'), kind: 'select', default: 'MOVEMENT_SPEED', options: EFFECTS },
      {
        key: 'level',
        label: t('Level', 'ระดับ'),
        kind: 'int',
        default: 1,
        min: 1,
        max: 1000,
        hint: t('Levels above 127 may display oddly on versions before 1.20.5', 'ระดับเกิน 127 อาจแสดงผลเพี้ยนในเวอร์ชันก่อน 1.20.5')
      },
      { key: 'infinite', label: t('Infinite duration', 'ไม่มีวันหมด (∞)'), kind: 'bool', default: false },
      {
        key: 'seconds',
        label: t('Duration (seconds)', 'ระยะเวลา (วินาที)'),
        kind: 'float',
        default: 10,
        min: 0.5,
        max: 3600,
        step: 0.5,
        hint: t('Armor keeps refreshing the effect while worn', 'เกราะจะต่อเวลาให้เรื่อย ๆ ขณะสวม'),
        showIf: (d) => !d.infinite
      },
      { key: 'chance', label: t('Chance', 'โอกาส'), kind: 'float', default: 1, min: 0, max: 1, step: 0.05 },
      { key: 'particles', label: t('Show particles', 'แสดงอนุภาค (particle)'), kind: 'bool', default: true },
      { key: 'showIcon', label: t('Show status icon', 'แสดงไอคอนสถานะ'), kind: 'bool', default: true }
    ]
  },

  {
    type: 'attribute',
    category: 'effect',
    title: t('Stat Bonus (attribute)', 'โบนัสค่าสถานะ (Attribute)'),
    description: t(
      'Changes a stat of the player while the item is held, worn or carried: max health, armor, speed, jump, reach and more. Wire it into an item, food, tool or armor piece.',
      'เปลี่ยนค่าสถานะของผู้เล่นตอนถือ สวม หรือพกไอเทม: เลือดสูงสุด เกราะ ความเร็ว กระโดด ระยะเอื้อม ฯลฯ ต่อเข้าไอเทม อาหาร เครื่องมือ หรือชิ้นเกราะ'
    ),
    icon: '📈',
    inputs: [],
    outputs: [{ id: 'out', label: t('Stat bonus', 'โบนัสค่าสถานะ'), type: 'attribute' }],
    props: [
      {
        key: 'attribute',
        label: t('Stat', 'ค่าสถานะ'),
        kind: 'select',
        default: 'max_health',
        options: ATTRIBUTES.map((a) => ({
          value: a.id,
          label: a.since === '1.16.5' ? a.label : t(`${a.label.en} (${a.since}+)`, `${a.label.th} (${a.since}+)`)
        }))
      },
      {
        key: 'amount',
        label: t('Amount', 'ค่า'),
        kind: 'float',
        default: 4,
        min: -1000,
        max: 1000,
        step: 0.5,
        hint: t('Negative values lower the stat. Max health: 2 = one heart.', 'ค่าติดลบคือลดลง — เลือดสูงสุด: 2 = 1 หัวใจ')
      },
      {
        key: 'operation',
        label: t('How it adds up', 'วิธีคิด'),
        kind: 'select',
        default: 'add',
        options: [
          opt('add', 'Add the amount (+4)', 'บวกเพิ่มตามค่า (+4)'),
          opt('base', 'Percent of the base value (0.5 = +50 %)', 'เปอร์เซ็นต์ของค่าพื้นฐาน (0.5 = +50 %)'),
          opt('total', 'Percent of the total (0.5 = +50 %)', 'เปอร์เซ็นต์ของค่ารวม (0.5 = +50 %)')
        ]
      },
      {
        key: 'slot',
        label: t('Active when', 'ทำงานเมื่อ'),
        kind: 'select',
        default: 'auto',
        options: [
          opt('auto', 'Auto (armor: worn, other items: main hand)', 'อัตโนมัติ (เกราะ: ตอนสวม, อื่น ๆ: ถือมือหลัก)'),
          opt('mainhand', 'Held in the main hand', 'ถือในมือหลัก'),
          opt('offhand', 'Held in the off hand', 'ถือในมือรอง'),
          opt('hand', 'Held in either hand', 'ถือมือใดก็ได้'),
          opt('head', 'Worn on the head', 'สวมที่หัว'),
          opt('chest', 'Worn on the body', 'สวมที่ลำตัว'),
          opt('legs', 'Worn on the legs', 'สวมที่ขา'),
          opt('feet', 'Worn on the feet', 'สวมที่เท้า'),
          opt('inventory', 'Anywhere in the inventory', 'อยู่ที่ไหนก็ได้ในช่องเก็บของ')
        ]
      },
      { key: 'tooltip', label: t('Show in the item tooltip', 'แสดงในคำอธิบายไอเทม'), kind: 'bool', default: true }
    ]
  },
  {
    type: 'hitAbility',
    category: 'effect',
    title: t('Ability (on hit / when eaten)', 'ความสามารถ (ตอนตี / ตอนกิน)'),
    description: t(
      'Something that happens: set on fire, lightning, freeze like powder snow, random teleport or clearing all effects. On a Tool / Weapon it happens to the target that is hit; on Food it happens to whoever eats it.',
      'สิ่งที่จะเกิดขึ้น: ติดไฟ, ฟ้าผ่า, แช่แข็งแบบหิมะผง, วาร์ปสุ่ม หรือล้างเอฟเฟกต์ทั้งหมด — ต่อเข้าเครื่องมือ / อาวุธ จะเกิดกับเป้าหมายที่ตีโดน ต่อเข้าอาหาร จะเกิดกับคนที่กิน'
    ),
    icon: '⚡',
    inputs: [],
    outputs: [{ id: 'out', label: t('Ability', 'ความสามารถ'), type: 'hit' }],
    props: [
      {
        key: 'ability',
        label: t('Ability', 'ความสามารถ'),
        kind: 'select',
        default: 'fire',
        options: [
          opt('fire', 'Set on fire', 'ติดไฟ'),
          opt('lightning', 'Summon lightning', 'เรียกสายฟ้า'),
          opt('freeze', 'Freeze like powder snow (frost + slowness, 1.18+)', 'แช่แข็งแบบหิมะผง (หนาวสั่น + ช้าลง, 1.18+)'),
          opt('teleport', 'Random teleport (like a chorus fruit)', 'วาร์ปสุ่ม (แบบผลคอรัส)'),
          opt('clear', 'Clear all effects (like milk)', 'ล้างเอฟเฟกต์ทั้งหมด (แบบนม)')
        ]
      },
      {
        key: 'seconds',
        label: t('Duration (seconds)', 'ระยะเวลา (วินาที)'),
        kind: 'float',
        default: 4,
        min: 0.5,
        max: 600,
        step: 0.5,
        showIf: (d) => d.ability === 'fire' || d.ability === 'freeze' || d.ability === undefined
      },
      { key: 'chance', label: t('Chance', 'โอกาส'), kind: 'float', default: 1, min: 0, max: 1, step: 0.05 }
    ]
  },

  // ───────────── Sound ─────────────
  {
    type: 'soundEvent',
    category: 'sound',
    title: t('Sound Event', 'เสียงในเกม'),
    description: t('A playable sound; several files = random variation', 'เสียงที่เล่นในเกม — ใส่หลายไฟล์จะสุ่มเล่น'),
    icon: '🎵',
    registers: true,
    inputs: [
      { id: 'sound1', label: t('Sound 1', 'เสียง 1'), type: 'sound' },
      { id: 'sound2', label: t('Sound 2', 'เสียง 2'), type: 'sound', optional: true },
      { id: 'sound3', label: t('Sound 3', 'เสียง 3'), type: 'sound', optional: true },
      { id: 'sound4', label: t('Sound 4', 'เสียง 4'), type: 'sound', optional: true }
    ],
    outputs: [{ id: 'out', label: t('Sound event', 'เสียงในเกม'), type: 'soundEvent' }],
    props: [
      { key: 'id', label: t('Sound ID', 'ID เสียง'), kind: 'id', default: 'my_sound' },
      { key: 'subtitle', label: t('Subtitle (EN)', 'คำบรรยาย (EN)'), kind: 'text', default: '' },
      { key: 'subtitleTh', label: t('Subtitle (TH)', 'คำบรรยาย (ไทย)'), kind: 'text', default: '' },
      { key: 'stream', label: t('Stream (long music)', 'สตรีม (เพลงยาว)'), kind: 'bool', default: false },
      { key: 'volume', label: t('Volume', 'ความดัง'), kind: 'float', default: 1, min: 0, max: 4, step: 0.1 },
      { key: 'pitch', label: t('Pitch', 'ระดับเสียง'), kind: 'float', default: 1, min: 0.5, max: 2, step: 0.1 }
    ]
  },
  {
    type: 'musicDisc',
    category: 'sound',
    title: t('Music Disc', 'แผ่นเพลง'),
    description: t('A disc playable in a jukebox', 'แผ่นเพลงที่เปิดในเครื่องเล่นแผ่นเสียงได้'),
    icon: '💿',
    registers: true,
    inputs: [{ id: 'sound', label: t('Song (sound event)', 'เพลง (เสียงในเกม)'), type: 'soundEvent' }, texIn()],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('music_disc_my_song', 'Music Disc'),
      { key: 'song', label: t('Song title (artist - title)', 'ชื่อเพลง (ศิลปิน - เพลง)'), kind: 'text', default: 'NKW - My Song' },
      { key: 'songTh', label: t('Song title (TH)', 'ชื่อเพลง (ไทย)'), kind: 'text', default: '' },
      {
        key: 'autoLength',
        label: t('Length from the audio file', 'ความยาวตามไฟล์เสียง'),
        kind: 'bool',
        default: true,
        hint: t('Measured from the first sound file of the song', 'วัดจากไฟล์เสียงแรกของเพลงอัตโนมัติ')
      },
      { key: 'length', label: t('Length (seconds)', 'ความยาว (วินาที)'), kind: 'int', default: 180, min: 1, max: 36000, showIf: (d) => d.autoLength === false },
      {
        key: 'copyright',
        label: t('Copyright status (shown on the disc)', 'สถานะลิขสิทธิ์ (แสดงบนแผ่น)'),
        kind: 'select',
        default: 'none',
        options: [
          opt('none', 'Do not show', 'ไม่แสดง'),
          opt('free', 'Copyright-free', 'ไม่มีลิขสิทธิ์ (ใช้ได้เสรี)'),
          opt('licensed', 'Used with permission', 'มีลิขสิทธิ์ (ได้รับอนุญาตแล้ว)'),
          opt('copyrighted', 'Copyrighted', 'มีลิขสิทธิ์')
        ]
      },
      { key: 'comparator', label: t('Comparator output', 'สัญญาณ Comparator'), kind: 'int', default: 1, min: 1, max: 15 },
      {
        key: 'range',
        label: t('Hearing range (blocks)', 'ระยะการได้ยิน (บล็อก)'),
        kind: 'int',
        default: 64,
        min: 4,
        max: 256,
        hint: t(
          'How far away the song can be heard (vanilla discs: 64). Players farther than 64 blocks when the song starts do not receive it.',
          'ได้ยินเพลงไกลแค่ไหน (แผ่นปกติ: 64) ผู้เล่นที่อยู่ไกลเกิน 64 บล็อกตอนเพลงเริ่มจะไม่ได้ยิน'
        )
      },
      {
        key: 'onEnd',
        label: t('When the song ends', 'เมื่อเพลงจบ'),
        kind: 'select',
        default: 'eject',
        options: [
          { value: 'eject', label: t('Pop the disc out', 'ดีดแผ่นออกมาทันที') },
          { value: 'loop', label: t('Loop (play again)', 'เล่นวนซ้ำ (ลูป)') },
          { value: 'stay', label: t('Stay in the jukebox (vanilla)', 'ค้างอยู่ในเครื่องเล่น (แบบปกติ)') }
        ],
        hint: t(
          'Pop out / loop work when a player puts the disc in by hand (not via hoppers).',
          'ดีดออก/ลูป ใช้ได้เมื่อผู้เล่นใส่แผ่นด้วยมือ (ไม่รวมใส่ผ่าน Hopper)'
        )
      }
    ]
  },

  // ───────────── Recipes ─────────────
  {
    type: 'recipeShaped',
    category: 'recipe',
    title: t('Shaped Crafting', 'คราฟแบบมีรูปแบบ'),
    description: t(
      'Wire the ingredients in (a new slot appears each time, up to 9), then drag them onto the 3×3 grid in Properties.',
      'ลากสายวัตถุดิบเข้ามา (ช่องใหม่จะโผล่ทีละช่อง สูงสุด 9) แล้วลากวางลงตาราง 3×3 ในแผงคุณสมบัติ'
    ),
    icon: '▦',
    inputs: [
      ...slots(9, 'i', 'Ingredient', 'วัตถุดิบ', 'ingredient', { group: 'ing' }),
      ...slots(9, 's', 'Grid slot', 'ช่องตาราง', 'ingredient', { legacy: true }),
      resultPin()
    ],
    outputs: [],
    props: [countProp(), { key: 'grid', label: t('Crafting grid', 'ตารางคราฟ'), kind: 'craftGrid', default: ['', '', '', '', '', '', '', '', ''] }]
  },
  {
    type: 'recipeShapeless',
    category: 'recipe',
    title: t('Shapeless Crafting', 'คราฟแบบไม่มีรูปแบบ'),
    description: t('Ingredients in any position', 'วางวัตถุดิบตรงไหนก็ได้'),
    icon: '⁂',
    inputs: [...slots(9, 'i', 'Ingredient', 'วัตถุดิบ', 'ingredient', { group: 'ing' }), resultPin()],
    outputs: [],
    props: [countProp()]
  },
  {
    type: 'recipeCooking',
    category: 'recipe',
    title: t('Furnace / Smelting', 'เตาเผา / หลอม'),
    description: t('Furnace, blast furnace, smoker or campfire', 'เตาเผา เตาถลุง เตารมควัน หรือกองไฟ'),
    icon: '🔥',
    inputs: [{ id: 'input', label: t('Input', 'วัตถุดิบ'), type: 'ingredient' }, resultPin()],
    outputs: [],
    props: [
      {
        key: 'kind',
        label: t('Station', 'อุปกรณ์'),
        kind: 'select',
        default: 'smelting',
        options: [
          opt('smelting', 'Furnace', 'เตาเผา'),
          opt('blasting', 'Blast furnace', 'เตาถลุง'),
          opt('smoking', 'Smoker', 'เตารมควัน'),
          opt('campfire_cooking', "Campfire / Farmer's Delight skillet", "กองไฟ / กระทะ Farmer's Delight")
        ]
      },
      { key: 'xp', label: t('Experience', 'ค่าประสบการณ์'), kind: 'float', default: 0.7, min: 0, max: 100, step: 0.1 },
      { key: 'time', label: t('Cook time (ticks)', 'เวลา (tick)'), kind: 'int', default: 200, min: 1, max: 72000 }
    ]
  },
  {
    type: 'recipeStonecutting',
    category: 'recipe',
    title: t('Stonecutter', 'เครื่องตัดหิน'),
    description: t('Stonecutter recipe', 'สูตรเครื่องตัดหิน'),
    icon: '🪚',
    inputs: [{ id: 'input', label: t('Input', 'วัตถุดิบ'), type: 'ingredient' }, resultPin()],
    outputs: [],
    props: [countProp()]
  },
  {
    type: 'recipeSmithing',
    category: 'recipe',
    title: t('Smithing Table', 'โต๊ะช่างตีเหล็ก'),
    description: t('Upgrade an item (template used on 1.20+)', 'อัปเกรดไอเทม (ใช้ template ใน 1.20 ขึ้นไป)'),
    icon: '⚒',
    inputs: [
      { id: 'template', label: t('Template', 'แม่แบบ'), type: 'ingredient', optional: true },
      { id: 'base', label: t('Base', 'ของตั้งต้น'), type: 'ingredient' },
      { id: 'addition', label: t('Addition', 'วัสดุเสริม'), type: 'ingredient' },
      resultPin()
    ],
    outputs: [],
    props: []
  },

  // ───────────── Farmer's Delight ─────────────
  // ───────────── Mobs ─────────────
  {
    type: 'mob',
    category: 'mob',
    title: t('Mob / Monster', 'ม็อบ / มอนสเตอร์'),
    description: t(
      'A creature with its own spawn egg: a game body (zombie, skeleton, spider, cow, pig) with your skin, or a 3D Blockbench model with animations (GeckoLib, 1.20.1 and 1.21.1). Health, damage, speed, natural spawning and drops can be set.',
      'สิ่งมีชีวิตพร้อมไข่เกิด: ใช้ร่างจากเกม (ซอมบี้ โครงกระดูก แมงมุม วัว หมู) กับสกินของเรา หรือโมเดล 3D จาก Blockbench พร้อมอนิเมชัน (GeckoLib, 1.20.1 และ 1.21.1) ตั้งเลือด ดาเมจ ความเร็ว การเกิดตามธรรมชาติ และของดรอปได้'
    ),
    icon: '👾',
    registers: true,
    inputs: [
      texIn('skin', 'Skin (game body)', 'สกิน (ร่างจากเกม)', true),
      { id: 'geo', label: t('3D model (Blockbench)', 'โมเดล 3D (Blockbench)'), type: 'geo', optional: true },
      ...slots(3, 'drop', 'Drop', 'ของดรอป', 'item', { group: 'drop' })
    ],
    outputs: [{ id: 'out', label: t('Spawn egg', 'ไข่เกิด'), type: 'item' }],
    props: [
      ...nameProps('my_mob', 'My Mob'),
      {
        key: 'body',
        label: t('Body', 'ร่าง'),
        kind: 'select',
        default: 'zombie',
        options: [
          opt('zombie', 'Zombie (people shape, hostile)', 'ซอมบี้ (ร่างคน, ดุร้าย)'),
          opt('skeleton', 'Skeleton (hostile)', 'โครงกระดูก (ดุร้าย)'),
          opt('spider', 'Spider (hostile)', 'แมงมุม (ดุร้าย)'),
          opt('cow', 'Cow (friendly)', 'วัว (เป็นมิตร)'),
          opt('pig', 'Pig (friendly)', 'หมู (เป็นมิตร)'),
          opt('model3d', '3D model (wire a 3D Armor Model node)', 'โมเดล 3D (ต่อโหนดโมเดลเกราะ 3D)')
        ],
        hint: t(
          'Game bodies use the skin layout of that mob (a 64×64 zombie / skeleton, 64×32 spider, 64×64 cow, 64×64 pig).',
          'ร่างจากเกมใช้รูปแบบสกินของม็อบนั้น (ซอมบี้/โครงกระดูก 64×64, แมงมุม 64×32, วัว 64×64, หมู 64×64)'
        )
      },
      {
        key: 'behavior',
        label: t('Behavior', 'นิสัย'),
        kind: 'select',
        default: 'hostile',
        options: [
          opt('hostile', 'Hostile: attacks players', 'ดุร้าย: โจมตีผู้เล่น'),
          opt('neutral', 'Neutral: fights back when hit', 'เฉย ๆ: สู้กลับเมื่อโดนตี'),
          opt('passive', 'Friendly: wanders, runs when hit', 'เป็นมิตร: เดินเล่น วิ่งหนีเมื่อโดนตี')
        ],
        showIf: (d) => d.body === 'model3d'
      },
      { key: 'health', label: t('Health (2 = 1 heart)', 'เลือด (2 = 1 หัวใจ)'), kind: 'float', default: 20, min: 1, max: 1024, step: 1 },
      { key: 'attack', label: t('Attack damage', 'พลังโจมตี'), kind: 'float', default: 3, min: 0, max: 1000, step: 0.5 },
      { key: 'speed', label: t('Speed (zombie 0.23, player 0.1 walk)', 'ความเร็ว (ซอมบี้ 0.23)'), kind: 'float', default: 0.25, min: 0.01, max: 2, step: 0.01 },
      { key: 'armor', label: t('Armor', 'เกราะ'), kind: 'float', default: 0, min: 0, max: 30, step: 1 },
      {
        key: 'width',
        label: t('Hitbox width (blocks)', 'ความกว้าง hitbox (บล็อก)'),
        kind: 'float',
        default: 0.6,
        min: 0.1,
        max: 8,
        step: 0.1,
        showIf: (d) => d.body === 'model3d'
      },
      {
        key: 'height',
        label: t('Hitbox height (blocks)', 'ความสูง hitbox (บล็อก)'),
        kind: 'float',
        default: 1.8,
        min: 0.1,
        max: 16,
        step: 0.1,
        showIf: (d) => d.body === 'model3d'
      },
      { key: 'idleAnim', label: t('Idle animation', 'อนิเมชันยืนนิ่ง'), kind: 'text', default: '', showIf: (d) => d.body === 'model3d' },
      { key: 'walkAnim', label: t('Walk animation', 'อนิเมชันเดิน'), kind: 'text', default: '', showIf: (d) => d.body === 'model3d' },
      { key: 'attackAnim', label: t('Attack animation', 'อนิเมชันโจมตี'), kind: 'text', default: '', showIf: (d) => d.body === 'model3d' },
      {
        key: 'spawn',
        label: t('Spawns naturally in', 'เกิดเองตามธรรมชาติใน'),
        kind: 'select',
        default: 'none',
        options: [
          opt('none', 'Nowhere (spawn egg / command only)', 'ไม่เกิดเอง (ไข่เกิด / คำสั่งเท่านั้น)'),
          opt('overworld', 'The Overworld', 'โลกปกติ'),
          opt('nether', 'The Nether', 'เนเธอร์'),
          opt('end', 'The End', 'ดิเอนด์')
        ],
        hint: t('Natural spawning needs Minecraft 1.19.2 or newer.', 'การเกิดตามธรรมชาติใช้ได้ใน Minecraft 1.19.2 ขึ้นไป')
      },
      {
        key: 'weight',
        label: t('Spawn weight (zombie 100)', 'โอกาสเกิด (ซอมบี้ 100)'),
        kind: 'int',
        default: 40,
        min: 1,
        max: 1000,
        showIf: (d) => d.spawn !== 'none' && d.spawn !== undefined
      },
      {
        key: 'groupMin',
        label: t('Group size min', 'จำนวนต่อกลุ่มต่ำสุด'),
        kind: 'int',
        default: 1,
        min: 1,
        max: 16,
        showIf: (d) => d.spawn !== 'none' && d.spawn !== undefined
      },
      {
        key: 'groupMax',
        label: t('Group size max', 'จำนวนต่อกลุ่มสูงสุด'),
        kind: 'int',
        default: 3,
        min: 1,
        max: 16,
        showIf: (d) => d.spawn !== 'none' && d.spawn !== undefined
      },
      { key: 'dropMin', label: t('Each drop: count min', 'ของดรอปแต่ละอย่าง: ต่ำสุด'), kind: 'int', default: 0, min: 0, max: 64 },
      { key: 'dropMax', label: t('Each drop: count max', 'ของดรอปแต่ละอย่าง: สูงสุด'), kind: 'int', default: 2, min: 0, max: 64 },
      { key: 'eggColor', label: t('Spawn egg colour', 'สีไข่เกิด'), kind: 'color', default: '#4b7f52' },
      { key: 'eggSpots', label: t('Spawn egg spots', 'สีจุดไข่เกิด'), kind: 'color', default: '#e11d48' }
    ]
  },

  // ───────────── Add-ons (other mods) ─────────────
  // ───────────── Utility ─────────────
  {
    type: 'itemRef',
    category: 'util',
    title: t('Existing Item', 'ไอเทมที่มีอยู่แล้ว'),
    description: t('Any vanilla or modded item, e.g. minecraft:diamond', 'ไอเทมจากเกมหรือม็อดอื่น เช่น minecraft:diamond'),
    icon: '📦',
    inputs: [],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [{ key: 'item', label: t('Item ID', 'ID ไอเทม'), kind: 'nsid', default: 'minecraft:diamond' }]
  },
  {
    type: 'tagRef',
    category: 'util',
    title: t('Item Tag', 'แท็กไอเทม'),
    description: t('Any item in a tag, e.g. minecraft:planks', 'ไอเทมใดก็ได้ในแท็ก เช่น minecraft:planks'),
    icon: '#',
    inputs: [],
    outputs: [{ id: 'out', label: t('Ingredient', 'วัตถุดิบ'), type: 'ingredient' }],
    props: [{ key: 'tag', label: t('Tag ID', 'ID แท็ก'), kind: 'nsid', default: 'minecraft:planks' }]
  },
  {
    type: 'creativeTab',
    category: 'util',
    title: t('Creative Tab', 'แท็บครีเอทีฟ'),
    description: t(
      'A tab in the creative inventory. Plug a logo texture (or an item) as its icon, then wire items in — a new Item slot appears each time. Items shown in the tab follow the slot order.',
      'แท็บในหน้าครีเอทีฟ — ใส่เท็กซ์เจอร์โลโก้ (หรือไอเทม) เป็นไอคอน แล้วลากสายไอเทมเข้ามา ช่องไอเทมใหม่จะโผล่ทีละช่อง ลำดับในแท็บเรียงตามช่อง'
    ),
    icon: '🗂',
    registers: true,
    inputs: [
      texIn('logo', 'Logo texture', 'เท็กซ์เจอร์โลโก้', true),
      { id: 'icon', label: t('Icon item (instead of logo)', 'ไอเทมไอคอน (แทนโลโก้)'), type: 'item', optional: true },
      ...slots(64, 'item', 'Item', 'ไอเทม', 'item', { group: 'items' }),
      { id: 'items', label: t('Items', 'ไอเทม'), type: 'item', optional: true, multi: true, legacy: true }
    ],
    outputs: [],
    props: [
      { key: 'id', label: t('Tab ID', 'ID แท็บ'), kind: 'id', default: 'main' },
      { key: 'title', label: t('Title (EN)', 'ชื่อแท็บ (EN)'), kind: 'text', default: 'My Mod' },
      { key: 'titleTh', label: t('Title (TH)', 'ชื่อแท็บ (ไทย)'), kind: 'text', default: '' },
      { key: 'order', label: t('Item order', 'ลำดับไอเทม'), kind: 'tabOrder', default: null }
    ]
  },
  {
    type: 'reroute',
    category: 'util',
    title: t('Reroute', 'จุดพักสาย'),
    description: t('Tidy up wires', 'จัดระเบียบสาย'),
    icon: '•',
    inputs: [{ id: 'in', label: t('In', 'เข้า'), type: 'any' }],
    outputs: [{ id: 'out', label: t('Out', 'ออก'), type: 'any' }],
    props: []
  },
  {
    type: 'comment',
    category: 'util',
    title: t('Comment', 'คอมเมนต์'),
    description: t('A note on the canvas', 'โน้ตบนผืนงาน'),
    icon: '💬',
    inputs: [],
    outputs: [],
    props: [
      { key: 'text', label: t('Text', 'ข้อความ'), kind: 'textarea', default: 'Note' },
      { key: 'color', label: t('Color', 'สี'), kind: 'color', default: '#6b7280' }
    ]
  }
]

/** Every registered node definition and the same by type: shared with the registry, so they follow extensions. */
export const NODE_DEFS = registry.defs
export const NODE_DEF_MAP = registry.map

export function defaultData(def: NodeDef): Record<string, unknown> {
  return Object.fromEntries(def.props.map((p) => [p.key, p.default]))
}

export function pinOf(def: NodeDef, handle: string, dir: 'in' | 'out'): PinDef | undefined {
  return (dir === 'in' ? def.inputs : def.outputs).find((p) => p.id === handle)
}

/**
 * Inputs to draw, split by side. Grouped pins grow: every wired pin plus the first free one;
 * legacy pins only appear while wired. `wired(id)` says whether an input has a wire.
 */
export function visibleInputs(def: NodeDef, wired: (id: string) => boolean): { left: PinDef[]; right: PinDef[] } {
  const left: PinDef[] = []
  const right: PinDef[] = []
  const freeShown = new Set<string>()
  for (const p of def.inputs) {
    const on = wired(p.id)
    if (p.legacy && !on) continue
    if (p.group && !on) {
      if (freeShown.has(p.group)) continue
      freeShown.add(p.group)
    }
    ;(p.right ? right : left).push(p)
  }
  return { left, right }
}

registry.register('core', {
  nodes: CORE_NODE_DEFS,
  categories: {
    item: { label: t('Items', 'ไอเทม'), color: '#3b82f6', order: 0 },
    block: { label: t('Blocks', 'บล็อก'), color: '#8b5cf6', order: 1 },
    farm: { label: t('Farming', 'การเกษตร'), color: '#65a30d', order: 2 },
    armor: { label: t('Armor', 'ชุดเกราะ'), color: '#f97316', order: 3 },
    effect: { label: t('Effects & abilities', 'เอฟเฟกต์และความสามารถ'), color: '#ec4899', order: 4 },
    sound: { label: t('Sound & Music', 'เสียงและเพลง'), color: '#10b981', order: 5 },
    recipe: { label: t('Recipes', 'สูตรคราฟ'), color: '#e11d48', order: 6 },
    mob: { label: t('Mobs & monsters', 'ม็อบและมอนสเตอร์'), color: '#b91c1c', order: 8 },
    addon: { label: t('Add-ons (other mods)', 'ส่วนเสริม (ม็อดอื่น)'), color: '#0ea5e9', order: 9 },
    asset: { label: t('Assets', 'ไฟล์ทรัพยากร'), color: '#f59e0b', order: 10 },
    util: { label: t('Utility', 'เครื่องมือ'), color: '#71717a', order: 11 }
  },
  pinTypes: {
    item: '#3b82f6',
    ingredient: '#06b6d4',
    texture: '#f59e0b',
    model: '#a855f7',
    geo: '#d946ef',
    sound: '#22c55e',
    soundEvent: '#10b981',
    toolMat: '#ef4444',
    armorMat: '#f97316',
    effect: '#ec4899',
    animation: '#8b5cf6',
    block: '#7c3aed',
    attribute: '#14b8a6',
    hit: '#dc2626',
    any: '#9ca3af'
  }
})
