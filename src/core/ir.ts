import type { ArmorFit } from './gen/geo'
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
  /** armor pieces: position / rotation / size adjustment */
  fit?: ArmorFit | null
  /** set when the model is a Java block/item model (.json): its textures in slot order, merged into one sheet */
  java?: { textures: string[] }
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
  food?: {
    nutrition: number
    saturation: number
    alwaysEdible: boolean
    fast: boolean
    effects: EffectIR[]
    /** abilities applied to whoever eats it (fire, freeze …) */
    hits: HitIR[]
    /** drunk like a potion (animation + gulping sound) instead of eaten */
    drink: boolean
    /** water value for thirst mods (Thirst add-on node) */
    thirst: ThirstIR | null
  }
  tool?: {
    type: ToolType
    material: string
    damage: number
    speed: number
    effects: EffectIR[]
    /** on-hit abilities (fire, lightning, freeze) */
    hits: HitIR[]
    /** uses before it breaks; 0 = the material's */
    durability: number
    unbreakable: boolean
  }
  /** stat bonuses while held / worn / carried (Stat Bonus nodes) */
  attributes?: AttributeIR[]
  armor?: { material: string; slot: ArmorSlot; geo: GeoRef | null; effects: EffectIR[] }
  disc?: {
    sound: string
    song: string
    songTh: string
    length: number
    comparator: number
    copyright: string
    /** what the jukebox does when the song ends */
    onEnd: 'eject' | 'loop' | 'stay'
    /** hearing range in blocks (vanilla 64) */
    range: number
  }
  /** registry id (without namespace) of a mod block this item places */
  places?: string | null
  /** 3D model shown in hand while `texture` is used as the inventory icon */
  separateIcon?: boolean
  /** can be worn on the head (drawn with the model's "head" display) */
  headwear?: boolean
  /** right-click puts it on (default); off: only the helmet slot */
  headwearRightClick?: boolean
  /** armor piece shown in the inventory / hand as its 3D (GeckoLib) model */
  geoIcon?: boolean
}

/** A plant (Crop node): ages 0–7 like vanilla crops, drawn with 1–8 stage textures. */
export interface CropIR {
  /** stage textures (assets), at least one */
  stages: string[]
  look: 'crop' | 'cross'
  soil: 'farmland' | 'dirt'
  /** ticks per age step; 0 = random growth like wheat */
  growStep: number
  mode: 'replant' | 'regrow'
  /** regrow: the age a harvest goes back to, and the ticks from there to fully grown */
  regrowAge: number
  regrowTicks: number
  input: 'break' | 'click' | 'hold' | 'stand'
  harvestTicks: number
  produce: string | null
  produceMin: number
  produceMax: number
  seedMin: number
  seedMax: number
  /** harvest timer look (Harvest UI node); null = the default text */
  ui: HarvestUiIR | null
  /** a hand harvest goes straight into the inventory instead of dropping */
  give: boolean
}

/** How the harvest timer is drawn (Harvest UI node). Colours are 0xRRGGBB. */
export interface HarvestUiIR {
  style: 'text' | 'bar' | 'ring'
  color: number
  back: number
  /** background opacity 0–255 */
  backAlpha: number
  /** bar / text: where on the screen, moved down by offset */
  place: 'crosshair' | 'hotbar' | 'top'
  offset: number
  width: number
  height: number
  /** ring around the crosshair: radius and line thickness (thickness >= radius = a filled circle) */
  radius: number
  thickness: number
  /** show the seconds left */
  time: boolean
}

/** Picking a crop of the game or of another mod by hand (Game Crop Harvest node). */
export interface GameCropIR {
  nodeId: string
  /** block id, e.g. minecraft:wheat */
  block: string
  input: 'click' | 'hold' | 'stand'
  harvestTicks: number
  /** break: like breaking it; replant: drops minus one seed, back to the start; regrow: back to an age */
  after: 'break' | 'replant' | 'regrow'
  back: number
  ui: HarvestUiIR | null
  /** the harvest goes straight into the inventory instead of dropping */
  give: boolean
}

export interface BlockIR extends Named {
  kind: 'cube' | 'model' | 'crop'
  /** Crop node settings */
  crop?: CropIR
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
  /** worn with a vanilla armor look (textures of minecraft:<name>) instead of own layer textures */
  vanillaLook?: string
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

/** A Java source file written by the user (Script node). */
export interface ScriptIR {
  nodeId: string
  /** the public class = file name */
  className: string
  /** targets it applies to, as "loader-mc"; empty = all */
  targets: string[]
  code: string
  /** Fabric/Quilt entrypoints the class implements */
  entry: { main: boolean; client: boolean }
}

/** Where a stat bonus is active. */
export type AttrSlot = 'mainhand' | 'offhand' | 'hand' | 'head' | 'chest' | 'legs' | 'feet' | 'inventory'

/** A player attribute modifier from a Stat Bonus node. */
export interface AttributeIR {
  /** Mojang field name in Attributes, e.g. MAX_HEALTH */
  field: string
  amount: number
  operation: 'add' | 'base' | 'total'
  slot: AttrSlot
  tooltip: boolean
}

/** Something that happens to the target when a weapon hits. */
export interface HitIR {
  ability: 'fire' | 'lightning' | 'freeze' | 'teleport' | 'clear'
  ticks: number
  chance: number
}

/** Thirst restored by a food in thirst mods: points on a 20-point bar, like hunger and saturation. */
export interface ThirstIR {
  thirst: number
  hydration: number
}

/** A creature (Mob node). */
export interface MobIR extends Named {
  /** a game body, or a GeckoLib 3D model */
  body: 'zombie' | 'skeleton' | 'spider' | 'cow' | 'pig' | 'model3d'
  behavior: 'hostile' | 'neutral' | 'passive'
  /** skin texture (game bodies) */
  skin: string | null
  geo: GeoRef | null
  health: number
  attack: number
  speed: number
  armor: number
  width: number
  height: number
  anims: { idle: string; walk: string; attack: string }
  spawn: { where: 'overworld' | 'nether' | 'end'; weight: number; min: number; max: number } | null
  drops: string[]
  dropMin: number
  dropMax: number
  /** spawn egg colours, 0xRRGGBB */
  egg: [number, number]
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
  scripts: ScriptIR[]
  mobs: MobIR[]
  gameCrops: GameCropIR[]
  /** animated textures (asset path → .mcmeta animation settings) */
  textureAnims: Record<string, { frametime: number; interpolate: boolean }>
}

export interface Diagnostic {
  severity: 'error' | 'warning'
  nodeId?: string
  message: L10n
}
