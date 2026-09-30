import type { L10n } from './nodes/defs'

/** One vanilla item extracted from the official Minecraft client for a given version. */
export interface VanillaItem {
  id: string
  en: string
  th: string
  kind: 'item' | 'block'
  icon: boolean
  group: GroupId
}

export interface VanillaTag {
  id: string
  values: string[]
}

export interface VanillaData {
  v: number
  mc: string
  /** namespace of the items (minecraft, farmersdelight) */
  ns: string
  items: VanillaItem[]
  tags: VanillaTag[]
}

export const VANILLA_DATA_VERSION = 3

export type GroupId =
  | 'minerals'
  | 'wood'
  | 'stone'
  | 'food'
  | 'crops'
  | 'mob'
  | 'tools'
  | 'combat'
  | 'armor'
  | 'redstone'
  | 'colored'
  | 'brewing'
  | 'transport'
  | 'decoration'
  | 'music'
  | 'spawn'
  | 'smithing'
  | 'other'

/** Groups ordered by what they are typically used for when crafting. */
export const GROUPS: { id: GroupId; label: L10n; icon: string }[] = [
  { id: 'minerals', label: { en: 'Ores, ingots & gems', th: 'แร่ แท่งโลหะ อัญมณี' }, icon: '💎' },
  { id: 'wood', label: { en: 'Wood', th: 'ไม้' }, icon: '🪵' },
  { id: 'stone', label: { en: 'Stone & building', th: 'หินและวัสดุก่อสร้าง' }, icon: '🧱' },
  { id: 'crops', label: { en: 'Plants & farming', th: 'พืชและการเกษตร' }, icon: '🌾' },
  { id: 'food', label: { en: 'Food', th: 'อาหาร' }, icon: '🍖' },
  { id: 'mob', label: { en: 'Mob drops', th: 'ของดรอปจากม็อบ' }, icon: '🦴' },
  { id: 'tools', label: { en: 'Tools & utilities', th: 'เครื่องมือ' }, icon: '⛏' },
  { id: 'combat', label: { en: 'Weapons', th: 'อาวุธ' }, icon: '⚔' },
  { id: 'armor', label: { en: 'Armor', th: 'ชุดเกราะ' }, icon: '🛡' },
  { id: 'redstone', label: { en: 'Redstone', th: 'เรดสโตน' }, icon: '🔴' },
  { id: 'colored', label: { en: 'Dyes & colored blocks', th: 'สีย้อมและบล็อกสี' }, icon: '🎨' },
  { id: 'brewing', label: { en: 'Brewing & magic', th: 'ปรุงยาและเวทมนตร์' }, icon: '⚗' },
  { id: 'transport', label: { en: 'Transport', th: 'การเดินทาง' }, icon: '🛶' },
  { id: 'decoration', label: { en: 'Decoration & utility blocks', th: 'ของตกแต่งและบล็อกใช้งาน' }, icon: '🪑' },
  { id: 'music', label: { en: 'Music discs', th: 'แผ่นเพลง' }, icon: '💿' },
  { id: 'smithing', label: { en: 'Smithing templates', th: 'แม่แบบตีเหล็ก' }, icon: '⚒' },
  { id: 'spawn', label: { en: 'Spawn eggs', th: 'ไข่เรียกม็อบ' }, icon: '🥚' },
  { id: 'other', label: { en: 'Other', th: 'อื่น ๆ' }, icon: '📦' }
]

const COLORS = 'white|orange|magenta|light_blue|yellow|lime|pink|gray|light_gray|cyan|purple|blue|brown|green|red|black'
const WOODS = 'oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped'

const RULES: [GroupId, RegExp][] = [
  ['spawn', /_spawn_egg$/],
  ['smithing', /_smithing_template$/],
  ['food', /^(sugar|popped_chorus_fruit|dried_kelp_block)$/],
  ['minerals', /amethyst|^ancient_debris$/],
  ['crops', /_mushroom_block$|^(nether_sprouts|vine|sculk_vein)$/],
  ['stone', /^(?!raw_)(?!copper_block$).*copper(?!_ingot|_ore|_nugget)|^(packed_mud|soul_soil|dirt_path|bone_block|sponge|wet_sponge|smooth_quartz|honeycomb_block|sculk|sculk_catalyst|sculk_shrieker|cobweb)$/],
  ['decoration', /froglight$/],
  ['music', /^music_disc_|^disc_fragment/],
  ['armor', /(_helmet|_chestplate|_leggings|_boots|_horse_armor)$|^(shield|elytra|wolf_armor|turtle_helmet)$/],
  ['combat', /(_sword|^bow|^crossbow|^trident|^mace|^arrow|_arrow|^wind_charge)$|^(bow|crossbow|arrow|spectral_arrow|tipped_arrow|trident|mace)$/],
  ['tools', /(_pickaxe|_axe|_shovel|_hoe|_bucket)$|^(shears|flint_and_steel|fishing_rod|carrot_on_a_stick|warped_fungus_on_a_stick|compass|recovery_compass|clock|spyglass|brush|lead|name_tag|bucket|map|filled_map|bundle|writable_book|book|written_book|saddle)$/],
  ['transport', /(_boat|_raft|minecart|_rail|^rail)$|^(minecart|rail)$/],
  ['colored', new RegExp(`(^|_)(${COLORS})_(wool|carpet|bed|banner|candle|concrete|concrete_powder|terracotta|glazed_terracotta|stained_glass|stained_glass_pane|shulker_box|dye|harness)$|_dye$`)],
  ['redstone', /redstone|repeater|comparator|piston|observer|hopper|dropper|dispenser|^lever$|_button$|pressure_plate|^tnt|daylight_detector|^target$|tripwire|trapped_chest|note_block|sculk_sensor|lightning_rod|crafter|^slime_block$|^honey_block$/],
  ['minerals', /(_ingot|_nugget|_ore|^raw_|_block_of|^block_of)|^(diamond|emerald|coal|charcoal|lapis_lazuli|quartz|amethyst_shard|netherite_scrap|redstone|flint|echo_shard|prismarine_shard|prismarine_crystals|glowstone_dust|resin_brick)$|^(iron|gold|copper|diamond|emerald|lapis|netherite|coal|redstone|raw_iron|raw_gold|raw_copper|amethyst|quartz)_block$/],
  ['brewing', /potion|^brewing_stand|^cauldron|blaze_powder|blaze_rod|ghast_tear|nether_wart|magma_cream|fermented_spider_eye|glistering_melon|golden_carrot|dragon_breath|experience_bottle|enchant|^glass_bottle|rabbit_foot|phantom_membrane|^ender_eye|^end_crystal|totem|^beacon|nether_star|heart_of_the_sea|conduit|^breeze_rod|ominous|trial_key/],
  ['food', /^(apple|golden_apple|enchanted_golden_apple|bread|cookie|cake|pumpkin_pie|mushroom_stew|rabbit_stew|beetroot_soup|suspicious_stew|baked_potato|poisonous_potato|carrot|potato|beetroot|melon_slice|sweet_berries|glow_berries|chorus_fruit|honey_bottle|dried_kelp|tropical_fish|pufferfish|cod|salmon|beef|porkchop|chicken|mutton|rabbit|rotten_flesh|spider_eye|milk_bucket)$|^cooked_/],
  ['mob', /^(bone|bone_meal|string|feather|leather|gunpowder|slime_ball|ender_pearl|ink_sac|glow_ink_sac|egg|blue_egg|brown_egg|rabbit_hide|scute|armadillo_scute|turtle_scute|shulker_shell|nautilus_shell|honeycomb|goat_horn|sniffer_egg|turtle_egg|frogspawn)$|_head$|_skull$/],
  ['crops', /(_sapling|_seeds|_leaves|_mushroom|_fungus|_roots|_flower|_tulip|_propagule|_petals|_bush|_vine|_vines|_plant|_coral|_coral_fan|_coral_block)$|^(wheat|sugar_cane|bamboo|cactus|kelp|seagrass|fern|large_fern|short_grass|grass|tall_grass|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|lily_pad|moss_block|moss_carpet|azalea|flowering_azalea|big_dripleaf|small_dripleaf|spore_blossom|hanging_roots|sea_pickle|pumpkin|carved_pumpkin|melon|hay_block|cocoa_beans|pitcher_pod|torchflower|nether_wart_block|warped_wart_block|shroomlight|sweet_berry_bush|chorus_flower|chorus_plant|dead_bush|glow_lichen|mangrove_roots|muddy_mangrove_roots|pink_petals|pitcher_plant|farmland|dirt|coarse_dirt|rooted_dirt|podzol|mycelium|grass_block|mud|clay|clay_ball|snowball|snow|snow_block|ice|packed_ice|blue_ice)$/],
  ['wood', new RegExp(`^(stripped_)?(${WOODS})_|^stick$|^bowl$|^(${WOODS})$|bamboo_(block|mosaic|planks)|_log$|_wood$|_hyphae$|_stem$|_planks$`)],
  ['stone', /stone|brick|deepslate|granite|andesite|diorite|tuff|calcite|terracotta|concrete|glass|sandstone|prismarine|blackstone|basalt|obsidian|purpur|end_stone|netherrack|quartz_|sand$|gravel|mud_brick|dripstone|^magma_block$|^bedrock$|_slab$|_stairs$|_wall$/],
  ['decoration', /(chest|barrel|furnace|smoker|crafting_table|table|anvil|bell|campfire|lantern|torch|candle|sign|banner|bookshelf|lectern|loom|stonecutter|grindstone|composter|beehive|bee_nest|jukebox|flower_pot|painting|item_frame|armor_stand|ladder|scaffolding|chain|bars|door|trapdoor|fence|fence_gate|carpet|bed|pot|head|skull|end_rod|respawn_anchor|lodestone|shulker_box|ender_chest|spawner|vault|heavy_core)/]
]

export function groupOf(id: string): GroupId {
  for (const [g, re] of RULES) if (re.test(id)) return g
  return 'other'
}
