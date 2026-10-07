import type { Loader } from '../project'

/**
 * A version profile describes every API/data-format difference the generators care about.
 * Adding a new Minecraft version = adding a profile here (plus fallback dependency versions).
 */
export interface VersionProfile {
  mc: string
  java: 8 | 17 | 21
  loaders: Loader[]
  /** ≥1.19.3: BuiltInRegistries / Registries instead of Registry.ITEM */
  builtInRegistries: boolean
  /** ≥1.21: ResourceLocation.fromNamespaceAndPath */
  rlFactory: boolean
  /** ≤1.20.6: recipes/, loot_tables/, tags/items/ ; ≥1.21 singular folder names */
  pluralDataDirs: boolean
  /** ≥1.20.5: {"id": ...} item stacks in recipe results */
  stackId: boolean
  /** ≥1.21.2: ingredients are plain strings ("minecraft:stick", "#minecraft:planks") */
  stringIngredients: boolean
  /** ≥1.20: CreativeModeTab registry + builder; below: Item.Properties.tab() */
  tabRegistry: boolean
  /** ≤1.19.x: BlockBehaviour.Properties.of(Material) */
  blockMaterial: boolean
  /** Tool material API era */
  toolApi: 'tierLevel' | 'tierTag' | 'toolMaterial'
  /** Armor API era */
  armorApi: 'slot' | 'type' | 'holder' | 'equipment'
  /** ≥1.21: jukebox_song data + Item.Properties.jukeboxPlayable */
  jukeboxSongs: boolean
  /** RecordItem constructor takes a length argument (≥1.19) */
  recordLength: boolean
  /** ≥1.21.4: assets/<ns>/items/<id>.json item model definitions */
  itemDefinitions: boolean
  /** ≥1.21.2: Item/Block properties need setId(ResourceKey) */
  propertiesId: boolean
  /** food builder naming era */
  foodApi: 'legacy' | 'modern' | 'consumable'
  /** ≥1.19.3: SoundEvent.createVariableRangeEvent */
  soundFactory: boolean
  /** ≥1.17: minecraft:mineable/* block tags */
  mineableTags: boolean
  /** ≥1.20: smithing_transform with template */
  smithingTransform: boolean
  /** ≥1.19: Forge supports "render_type" inside block model json */
  modelRenderType: boolean
  /** Mojang pack formats */
  resourcePack: number
  dataPack: number
  /** Minecraft Direction property type ≥1.21.2 is EnumProperty<Direction> */
  enumDirectionProperty: boolean
  /** Forge ≥1.20.5 runs on Mojang names: no reobf */
  forgeNoReobf: boolean
  /** GeckoLib 3D armor support for this profile */
  geckoArmor: boolean
}

const base = {
  builtInRegistries: true,
  rlFactory: true,
  pluralDataDirs: false,
  stackId: true,
  stringIngredients: false,
  tabRegistry: true,
  blockMaterial: false,
  jukeboxSongs: true,
  recordLength: true,
  itemDefinitions: false,
  propertiesId: false,
  foodApi: 'modern',
  soundFactory: true,
  mineableTags: true,
  smithingTransform: true,
  modelRenderType: true,
  enumDirectionProperty: false,
  forgeNoReobf: true,
  geckoArmor: false
} as const

export const PROFILES: VersionProfile[] = [
  {
    ...base,
    mc: '1.16.5',
    java: 8,
    loaders: ['fabric', 'forge'],
    builtInRegistries: false,
    rlFactory: false,
    pluralDataDirs: true,
    stackId: false,
    tabRegistry: false,
    blockMaterial: true,
    toolApi: 'tierLevel',
    armorApi: 'slot',
    jukeboxSongs: false,
    recordLength: false,
    foodApi: 'legacy',
    soundFactory: false,
    mineableTags: false,
    smithingTransform: false,
    modelRenderType: false,
    resourcePack: 6,
    dataPack: 6,
    forgeNoReobf: false
  },
  {
    ...base,
    mc: '1.18.2',
    java: 17,
    loaders: ['fabric', 'quilt', 'forge'],
    builtInRegistries: false,
    rlFactory: false,
    pluralDataDirs: true,
    stackId: false,
    tabRegistry: false,
    blockMaterial: true,
    toolApi: 'tierLevel',
    armorApi: 'slot',
    jukeboxSongs: false,
    recordLength: false,
    foodApi: 'legacy',
    soundFactory: false,
    smithingTransform: false,
    modelRenderType: false,
    resourcePack: 8,
    dataPack: 9,
    forgeNoReobf: false
  },
  {
    ...base,
    mc: '1.19.2',
    java: 17,
    loaders: ['fabric', 'quilt', 'forge'],
    builtInRegistries: false,
    rlFactory: false,
    pluralDataDirs: true,
    stackId: false,
    tabRegistry: false,
    blockMaterial: true,
    toolApi: 'tierLevel',
    armorApi: 'slot',
    jukeboxSongs: false,
    foodApi: 'legacy',
    soundFactory: false,
    smithingTransform: false,
    resourcePack: 9,
    dataPack: 10,
    forgeNoReobf: false
  },
  {
    ...base,
    mc: '1.20.1',
    java: 17,
    loaders: ['fabric', 'quilt', 'forge'],
    rlFactory: false,
    pluralDataDirs: true,
    stackId: false,
    toolApi: 'tierLevel',
    armorApi: 'type',
    jukeboxSongs: false,
    foodApi: 'legacy',
    resourcePack: 15,
    dataPack: 15,
    forgeNoReobf: false,
    geckoArmor: true
  },
  {
    ...base,
    mc: '1.20.4',
    java: 17,
    loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    rlFactory: false,
    pluralDataDirs: true,
    stackId: false,
    toolApi: 'tierLevel',
    armorApi: 'type',
    jukeboxSongs: false,
    foodApi: 'legacy',
    resourcePack: 22,
    dataPack: 26,
    forgeNoReobf: false
  },
  {
    ...base,
    mc: '1.21.1',
    java: 21,
    loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    toolApi: 'tierTag',
    armorApi: 'holder',
    resourcePack: 34,
    dataPack: 48,
    geckoArmor: true
  },
  {
    ...base,
    mc: '1.21.4',
    java: 21,
    loaders: ['fabric', 'quilt', 'forge', 'neoforge'],
    stringIngredients: true,
    toolApi: 'toolMaterial',
    armorApi: 'equipment',
    itemDefinitions: true,
    propertiesId: true,
    foodApi: 'consumable',
    enumDirectionProperty: true,
    resourcePack: 46,
    dataPack: 61
  }
]

/** Whether Minecraft version `mc` is `min` or newer (e.g. mcAtLeast('1.21.1', '1.20.4')). */
export function mcAtLeast(mc: string, min: string): boolean {
  const a = mc.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

export function getProfile(mc: string): VersionProfile {
  const p = PROFILES.find((x) => x.mc === mc)
  if (!p) throw new Error(`Unsupported Minecraft version ${mc}`)
  return p
}

export function isSupported(loader: Loader, mc: string): boolean {
  const p = PROFILES.find((x) => x.mc === mc)
  return !!p && p.loaders.includes(loader)
}
