import type { ProjectMeta } from './project'
import type { L10n } from './nodes/defs'

export type Ingredient = { item: string } | { tag: string }

export interface ModelRef {
  asset: string
  /** texture asset per model texture slot (#0, #1 …) */
  textures: (string | null)[]
}

export interface GeoRef {
  asset: string
  texture: string
  /** GeckoLib animation file + the animation name to loop */
  animation: { asset: string; name: string } | null
}

/** A status effect: MobEffects field name, amplifier (level-1), duration in ticks, 0-1 chance. */
export interface EffectIR {
  effect: string
  amplifier: number
  ticks: number
  chance: number
  particles: boolean
  showIcon: boolean
  /** never runs out (ticks is ignored) */
  infinite: boolean
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic'
export type ToolType = 'sword' | 'pickaxe' | 'axe' | 'shovel' | 'hoe'
export type ArmorSlot = 'helmet' | 'chestplate' | 'leggings' | 'boots'
export type ToolLevel = 'wood' | 'stone' | 'iron' | 'diamond' | 'netherite'

interface Named {
  id: string
  name: string
  nameTh: string
  nodeId: string
}

export interface ItemIR extends Named {
  kind: 'basic' | 'food' | 'tool' | 'armor' | 'disc'
  texture: string | null
  model: ModelRef | null
  handheld: boolean
  maxStack: number
  rarity: Rarity
  fireResistant: boolean
  glint: boolean
  food?: { nutrition: number; saturation: number; alwaysEdible: boolean; fast: boolean; effects: EffectIR[] }
  tool?: { type: ToolType; material: string; damage: number; speed: number; effects: EffectIR[] }
  armor?: { material: string; slot: ArmorSlot; geo: GeoRef | null; effects: EffectIR[] }
  disc?: { sound: string; song: string; songTh: string; length: number; comparator: number; copyright: string }
  /** registry id (without namespace) of a mod block this item places */
  places?: string | null
  /** 3D model shown in hand while `texture` is used as the inventory icon */
  separateIcon?: boolean
}

export interface BlockIR extends Named {
  kind: 'cube' | 'model'
  /** registers a BlockItem for the block */
  hasItem: boolean
  shape: 'cube_all' | 'cube_bottom_top' | 'pillar'
  textures: { side: string | null; top: string | null; bottom: string | null }
  model: ModelRef | null
  rotatable: boolean
  solid: boolean
  hardness: number
  resistance: number
  sound: string
  tool: 'none' | 'pickaxe' | 'axe' | 'shovel' | 'hoe'
  toolLevel: 'wood' | 'stone' | 'iron' | 'diamond'
  requiresTool: boolean
  light: number
  drop: string | null
  dropMin: number
  dropMax: number
}

export interface ToolMatIR {
  id: string
  nodeId: string
  durability: number
  speed: number
  damage: number
  level: ToolLevel
  enchantability: number
  repair: Ingredient | null
}

export interface ArmorMatIR {
  id: string
  nodeId: string
  durability: number
  protection: Record<ArmorSlot, number>
  enchantability: number
  toughness: number
  knockback: number
  equipSound: string
  layer1: string | null
  layer2: string | null
  repair: Ingredient | null
}

export interface SoundIR {
  id: string
  nodeId: string
  files: string[]
  subtitle: string
  subtitleTh: string
  stream: boolean
  volume: number
  pitch: number
}

export type RecipeIR = { name: string; nodeId: string } & (
  | { kind: 'shaped'; pattern: string[]; key: Record<string, Ingredient>; result: string; count: number }
  | { kind: 'shapeless'; ingredients: Ingredient[]; result: string; count: number }
  | { kind: 'cooking'; station: 'smelting' | 'blasting' | 'smoking' | 'campfire_cooking'; input: Ingredient; result: string; xp: number; time: number }
  | { kind: 'stonecutting'; input: Ingredient; result: string; count: number }
  | { kind: 'smithing'; template: Ingredient | null; base: Ingredient; addition: Ingredient; result: string }
  | { kind: 'fdCutting'; input: Ingredient; tool: string; results: { item: string; count: number; chance: number }[] }
  | {
      kind: 'fdCooking'
      ingredients: Ingredient[]
      container: string | null
      result: string
      count: number
      xp: number
      time: number
      tab: string
    }
)

export interface TabIR {
  id: string
  nodeId: string | null
  title: string
  titleTh: string
  /** icon: an item id, or a texture asset (a hidden icon item is generated for it) */
  icon: string | null
  logo: string | null
  /** item ids shown in this tab (mod or vanilla) */
  items: string[]
}

export interface ModIR {
  meta: ProjectMeta
  items: ItemIR[]
  blocks: BlockIR[]
  toolMats: ToolMatIR[]
  armorMats: ArmorMatIR[]
  sounds: SoundIR[]
  recipes: RecipeIR[]
  tabs: TabIR[]
  /** animated textures (asset path → .mcmeta animation settings) */
  textureAnims: Record<string, { frametime: number; interpolate: boolean }>
}

export interface Diagnostic {
  severity: 'error' | 'warning'
  nodeId?: string
  message: L10n
}
