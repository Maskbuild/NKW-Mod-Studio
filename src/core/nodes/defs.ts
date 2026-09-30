/**
 * Node catalogue shared by the editor (rendering, inspector) and the compiler.
 * Every pin has a type; the editor refuses connections whose types don't match.
 */

export type PinType =
  | 'item'
  | 'ingredient'
  | 'texture'
  | 'model'
  | 'geo'
  | 'sound'
  | 'soundEvent'
  | 'toolMat'
  | 'armorMat'
  | 'effect'
  | 'animation'
  | 'block'
  | 'any'

export interface L10n {
  en: string
  th: string
}

export const PIN_COLORS: Record<PinType, string> = {
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
  any: '#9ca3af'
}

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

export type PropKind = 'id' | 'text' | 'int' | 'float' | 'bool' | 'select' | 'asset' | 'nsid' | 'textarea' | 'color' | 'animName' | 'craftGrid' | 'armorFit'

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
}

export type Category = 'asset' | 'item' | 'block' | 'armor' | 'effect' | 'sound' | 'recipe' | 'fd' | 'util'

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

const t = (en: string, th: string): L10n => ({ en, th })
const opt = (value: string, en: string, th: string) => ({ value, label: t(en, th) })

export const CATEGORY_LABEL: Record<Category, L10n> = {
  asset: t('Assets', 'ไฟล์ทรัพยากร'),
  item: t('Items', 'ไอเทม'),
  block: t('Blocks', 'บล็อก'),
  armor: t('Armor', 'ชุดเกราะ'),
  effect: t('Effects', 'เอฟเฟกต์'),
  sound: t('Sound & Music', 'เสียงและเพลง'),
  recipe: t('Recipes', 'สูตรคราฟ'),
  fd: t("Farmer's Delight", "Farmer's Delight"),
  util: t('Utility', 'เครื่องมือ')
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
    options: [
      opt('common', 'Common', 'ธรรมดา'),
      opt('uncommon', 'Uncommon', 'ไม่ธรรมดา'),
      opt('rare', 'Rare', 'หายาก'),
      opt('epic', 'Epic', 'มหากาพย์')
    ]
  },
  { key: 'fireResistant', label: t('Fire resistant', 'ทนไฟ'), kind: 'bool', default: false },
  { key: 'wearOnHead', label: t('Can be worn on the head', 'ใส่บนหัวได้'), kind: 'bool', default: false, hint: t('Right-click to put it on. It is shown with the model\'s "Head" display settings (Blockbench → Display → Head).', 'คลิกขวาเพื่อสวม — จะแสดงตามค่าการแสดงผลแบบ "Head" ของโมเดล (Blockbench → Display → Head)') },
  { key: 'glint', label: t('Enchant glint', 'มีประกายเอนชานต์'), kind: 'bool', default: false }
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
    options: [
      opt('stone', 'Stone', 'หิน'),
      opt('wood', 'Wood', 'ไม้'),
      opt('metal', 'Metal', 'โลหะ'),
      opt('glass', 'Glass', 'แก้ว'),
      opt('grass', 'Grass', 'หญ้า'),
      opt('sand', 'Sand', 'ทราย'),
      opt('gravel', 'Gravel', 'กรวด'),
      opt('wool', 'Wool', 'ขนแกะ')
    ]
  },
  {
    key: 'tool',
    label: t('Mined with', 'ขุดด้วย'),
    kind: 'select',
    default: 'pickaxe',
    options: [
      opt('none', 'Hand / any', 'มือเปล่า / อะไรก็ได้'),
      opt('pickaxe', 'Pickaxe', 'อีเต้อ'),
      opt('axe', 'Axe', 'ขวาน'),
      opt('shovel', 'Shovel', 'พลั่ว'),
      opt('hoe', 'Hoe', 'จอบ')
    ]
  },
  {
    key: 'toolLevel',
    label: t('Tool level', 'ระดับเครื่องมือ'),
    kind: 'select',
    default: 'wood',
    options: [
      opt('wood', 'Wood / Gold', 'ไม้ / ทอง'),
      opt('stone', 'Stone', 'หิน'),
      opt('iron', 'Iron', 'เหล็ก'),
      opt('diamond', 'Diamond', 'เพชร')
    ],
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

const slots = (n: number, prefix: string, en: string, th: string, type: 'ingredient' | 'item' = 'ingredient', extra: Partial<PinDef> = {}): PinDef[] =>
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

const effectIns = (en: string, th: string): PinDef[] =>
  [1, 2, 3].map((i) => ({ id: `effect${i}`, label: t(`${en} ${i}`, `${th} ${i}`), type: 'effect' as PinType, optional: true }))

export const NODE_DEFS: NodeDef[] = [
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
      { key: 'frameTime', label: t('Ticks per frame (20 = 1 s)', 'tick ต่อเฟรม (20 = 1 วินาที)'), kind: 'int', default: 2, min: 1, max: 200, showIf: (d) => !!d.animated },
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
      { id: 'places', label: t('Places block', 'วางเป็นบล็อก'), type: 'block', optional: true }
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [...nameProps('my_item', 'My Item'), ...itemCommon, { key: 'handheld', label: t('Held like a tool', 'ถือแบบเครื่องมือ'), kind: 'bool', default: false }]
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
      ...effectIns('Effect when eaten', 'เอฟเฟกต์ตอนกิน')
    ],
    outputs: [{ id: 'out', label: t('Item', 'ไอเทม'), type: 'item' }],
    props: [
      ...nameProps('my_food', 'My Food'),
      { key: 'nutrition', label: t('Hunger restored', 'ฟื้นฟูความหิว'), kind: 'int', default: 4, min: 0, max: 20 },
      { key: 'saturation', label: t('Saturation', 'ความอิ่ม'), kind: 'float', default: 0.3, min: 0, max: 5, step: 0.1 },
      { key: 'alwaysEdible', label: t('Edible when full', 'กินได้แม้อิ่ม'), kind: 'bool', default: false },
      { key: 'fast', label: t('Eat fast', 'กินเร็ว'), kind: 'bool', default: false },
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
      ...effectIns('Effect on hit target', 'เอฟเฟกต์ใส่ศัตรูที่ตี')
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
      { key: 'wearOnHead', label: t('Can be worn on the head', 'ใส่บนหัวได้'), kind: 'bool', default: false, hint: t('Right-click to put it on. It is shown with the model\'s "Head" display settings (Blockbench → Display → Head).', 'คลิกขวาเพื่อสวม — จะแสดงตามค่าการแสดงผลแบบ "Head" ของโมเดล (Blockbench → Display → Head)') },
      { key: 'rarity', label: t('Rarity', 'ความหายาก'), kind: 'select', default: 'common', options: itemCommon[1].options }
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
      ...effectIns('Effect while worn', 'เอฟเฟกต์ตอนสวม')
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
        hint: t('"The 3D model" shows the connected 3D model as the item, like a block in the inventory.', '"โมเดล 3D" จะแสดงโมเดลที่ต่อไว้เป็นตัวไอเทม แบบเดียวกับบล็อกในช่องเก็บของ')
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
    inputs: [
      { id: 'sound', label: t('Song (sound event)', 'เพลง (เสียงในเกม)'), type: 'soundEvent' },
      texIn()
    ],
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
        hint: t('Pop out / loop work when a player puts the disc in by hand (not via hoppers).', 'ดีดออก/ลูป ใช้ได้เมื่อผู้เล่นใส่แผ่นด้วยมือ (ไม่รวมใส่ผ่าน Hopper)')
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
    inputs: [
      { id: 'input', label: t('Input', 'วัตถุดิบ'), type: 'ingredient' },
      resultPin()
    ],
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
    inputs: [
      { id: 'input', label: t('Input', 'วัตถุดิบ'), type: 'ingredient' },
      resultPin()
    ],
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
  {
    type: 'fdCutting',
    category: 'fd',
    title: t('Cutting Board', 'เขียง'),
    description: t("Farmer's Delight cutting board recipe", "สูตรเขียงของ Farmer's Delight"),
    icon: '🔪',
    inputs: [
      { id: 'input', label: t('Input', 'วัตถุดิบ'), type: 'ingredient' },
      { id: 'out1', label: t('Result 1', 'ผลลัพธ์ 1'), type: 'item', right: true, group: 'out' },
      { id: 'out2', label: t('Result 2', 'ผลลัพธ์ 2'), type: 'item', optional: true, right: true, group: 'out' },
      { id: 'out3', label: t('Result 3', 'ผลลัพธ์ 3'), type: 'item', optional: true, right: true, group: 'out' },
      { id: 'out4', label: t('Result 4', 'ผลลัพธ์ 4'), type: 'item', optional: true, right: true, group: 'out' }
    ],
    outputs: [],
    props: [
      {
        key: 'tool',
        label: t('Tool', 'เครื่องมือ'),
        kind: 'select',
        default: 'knife',
        options: [opt('knife', 'Knife', 'มีด'), opt('axe', 'Axe', 'ขวาน'), opt('pickaxe', 'Pickaxe', 'อีเต้อ'), opt('shovel', 'Shovel', 'พลั่ว'), opt('shears', 'Shears', 'กรรไกร')]
      },
      { key: 'count1', label: t('Result 1 count', 'จำนวนผลลัพธ์ 1'), kind: 'int', default: 2, min: 1, max: 64 },
      { key: 'count2', label: t('Result 2 count', 'จำนวนผลลัพธ์ 2'), kind: 'int', default: 1, min: 1, max: 64 },
      { key: 'chance2', label: t('Result 2 chance', 'โอกาสผลลัพธ์ 2'), kind: 'float', default: 1, min: 0, max: 1, step: 0.05 },
      { key: 'count3', label: t('Result 3 count', 'จำนวนผลลัพธ์ 3'), kind: 'int', default: 1, min: 1, max: 64 },
      { key: 'chance3', label: t('Result 3 chance', 'โอกาสผลลัพธ์ 3'), kind: 'float', default: 1, min: 0, max: 1, step: 0.05 },
      { key: 'count4', label: t('Result 4 count', 'จำนวนผลลัพธ์ 4'), kind: 'int', default: 1, min: 1, max: 64 },
      { key: 'chance4', label: t('Result 4 chance', 'โอกาสผลลัพธ์ 4'), kind: 'float', default: 1, min: 0, max: 1, step: 0.05 }
    ]
  },
  {
    type: 'fdCooking',
    category: 'fd',
    title: t('Cooking Pot', 'หม้อต้ม'),
    description: t("Farmer's Delight cooking pot recipe (up to 6 ingredients)", "สูตรหม้อต้มของ Farmer's Delight (วัตถุดิบสูงสุด 6 อย่าง)"),
    icon: '🍲',
    inputs: [
      ...slots(6, 'i', 'Ingredient', 'วัตถุดิบ', 'ingredient', { group: 'ing' }),
      { id: 'container', label: t('Container (e.g. bowl)', 'ภาชนะ (เช่น ชาม)'), type: 'item', optional: true },
      resultPin()
    ],
    outputs: [],
    props: [
      countProp(),
      { key: 'xp', label: t('Experience', 'ค่าประสบการณ์'), kind: 'float', default: 1, min: 0, max: 100, step: 0.1 },
      { key: 'time', label: t('Cook time (ticks)', 'เวลา (tick)'), kind: 'int', default: 200, min: 1, max: 72000 },
      {
        key: 'tab',
        label: t('Recipe book tab', 'หมวดในสมุดสูตร'),
        kind: 'select',
        default: 'meals',
        options: [opt('meals', 'Meals', 'อาหารจานหลัก'), opt('drinks', 'Drinks', 'เครื่องดื่ม'), opt('misc', 'Misc', 'อื่น ๆ')]
      }
    ]
  },

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
      { key: 'titleTh', label: t('Title (TH)', 'ชื่อแท็บ (ไทย)'), kind: 'text', default: '' }
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

export const NODE_DEF_MAP: Record<string, NodeDef> = Object.fromEntries(NODE_DEFS.map((d) => [d.type, d]))

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
