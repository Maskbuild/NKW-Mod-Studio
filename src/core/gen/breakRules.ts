import type { BreakDrops, ModIR } from '../ir'
import { JavaFile, MC, forgeEvents } from './java'
import { fabricLike, type GenCtx } from './types'

const TOOL_CODE = { pickaxe: 0, axe: 1, shovel: 2, hoe: 3, sword: 4, shears: 5, any: 6 } as const
/** a plant rule: no tool ever passes (breaking it gives nothing) */
const NEVER = 7
const LEVEL_CODE = { wood: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 } as const

/** Plants (the mod's crops and game crops) that give nothing, or nothing while young, when a player breaks them. */
function plantRules(ir: ModIR): { block: string; drops: Exclude<BreakDrops, 'normal'> }[] {
  const out: { block: string; drops: Exclude<BreakDrops, 'normal'> }[] = []
  for (const b of ir.blocks) if (b.crop && b.crop.breakDrops !== 'normal') out.push({ block: `${ir.meta.modId}:${b.id}`, drops: b.crop.breakDrops })
  for (const g of ir.gameCrops) if (g.breakDrops !== 'normal') out.push({ block: g.block, drops: g.breakDrops })
  return out
}

/** Whether the mod needs NkwBreakRules (Break Rule nodes, or plants that drop nothing when broken). */
export const usesBreakRules = (ir: ModIR) => ir.breakRules.length > 0 || plantRules(ir).length > 0

/** Lang key of a Break Rule's action-bar message. */
export const breakRuleKey = (ns: string, index: number) => `message.${ns}.break_rule_${index}`

/**
 * Blocks that need a tool type and mining level (Break Rule nodes), and plants that give nothing when a
 * player breaks them. A wrong tool means no drops (Forge/NeoForge: the harvest check says no, so mining
 * is also slow like stone by hand; Fabric/Quilt: the block is removed without drops) or no breaking at all
 * (Forge/NeoForge: mining speed 0; Fabric/Quilt: the attack is refused). Creative players are never stopped.
 * Blocks are matched by registry id, so blocks of the game and of other mods work without depending on them.
 */
export function genBreakRules(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, loader, p, ns, ir } = ctx
  const fab = fabricLike(loader)
  const tagged = p.mc !== '1.16.5'
  const j = new JavaFile(pkg, 'NkwBreakRules').use(
    MC.Block,
    MC.BlockState,
    MC.Item,
    MC.ItemStack,
    MC.Player,
    'net.minecraft.world.item.PickaxeItem',
    'net.minecraft.world.item.AxeItem',
    'net.minecraft.world.item.ShovelItem',
    'net.minecraft.world.item.HoeItem',
    'net.minecraft.world.item.SwordItem',
    'net.minecraft.world.item.ShearsItem',
    MC.Items,
    'net.minecraft.world.level.block.state.properties.IntegerProperty',
    'net.minecraft.world.level.block.state.properties.Property',
    'net.minecraft.ChatFormatting',
    'java.util.Collections',
    'java.util.HashMap',
    'java.util.Map',
    'java.util.UUID',
    'java.util.concurrent.ConcurrentHashMap'
  )
  const blockKey = p.builtInRegistries
    ? (j.use(MC.BuiltIn), 'BuiltInRegistries.BLOCK.getKey(state.getBlock())')
    : (j.use(MC.Registry), 'Registry.BLOCK.getKey(state.getBlock())')
  const message = ['1.16.5', '1.18.2'].includes(p.mc)
    ? (j.use('net.minecraft.network.chat.TranslatableComponent'), 'new TranslatableComponent(rule.message)')
    : (j.use(MC.Component), 'Component.translatable(rule.message)')

  // ── rules ──
  const lines: string[] = []
  const tags: { tag: string; rule: string }[] = []
  ir.breakRules.forEach((r, i) => {
    const name = `RULE_${i}`
    const msg = r.message ? `"${breakRuleKey(ns, i)}"` : 'null'
    lines.push(`        Rule ${name} = new Rule(${TOOL_CODE[r.tool]}, ${LEVEL_CODE[r.level]}, ${r.onFail === 'cantBreak'}, false, ${msg});`)
    for (const b of r.blocks) lines.push(`        add("${b}", ${name});`)
    if (tagged) for (const t of r.tags) tags.push({ tag: t, rule: name })
  })
  const plants = plantRules(ir)
  if (plants.some((x) => x.drops === 'none')) lines.push(`        Rule PLANT_NONE = new Rule(${NEVER}, 0, false, false, null);`)
  if (plants.some((x) => x.drops === 'grown')) lines.push(`        Rule PLANT_YOUNG = new Rule(${NEVER}, 0, false, true, null);`)
  for (const x of plants) lines.push(`        add("${x.block}", ${x.drops === 'none' ? 'PLANT_NONE' : 'PLANT_YOUNG'});`)

  let tagFields = ''
  let tagLookup = ''
  if (tags.length) {
    j.use(MC.TagKey, MC.RL, 'java.util.ArrayList', 'java.util.List')
    const registry = p.builtInRegistries ? (j.use(MC.Registries), 'Registries.BLOCK') : (j.use(MC.Registry), 'Registry.BLOCK_REGISTRY')
    const rl = (id: string) => (p.rlFactory ? `ResourceLocation.parse("${id}")` : `new ResourceLocation("${id}")`)
    for (const t of tags) lines.push(`        TAGS.add(TagKey.create(${registry}, ${rl(t.tag)}));\n        TAG_RULES.add(${t.rule});`)
    tagFields = `
    /** block tags of the rules, checked after the ids */
    private static final List<TagKey<Block>> TAGS = new ArrayList<>();
    private static final List<Rule> TAG_RULES = new ArrayList<>();`
    tagLookup = `
        if (rule == null)
            for (int i = 0; i < TAGS.size(); i++)
                if (state.is(TAGS.get(i))) {
                    rule = TAG_RULES.get(i);
                    break;
                }`
  }

  // ── tool type: the vanilla classes (modded tools extend them), plus the tool tags on 1.20+ ──
  const tag = (name: string) => (p.smithingTransform ? (j.use(MC.ItemTags), ` || stack.is(ItemTags.${name})`) : '')
  const typeCases = `            case 0: return item instanceof PickaxeItem${tag('PICKAXES')};
            case 1: return item instanceof AxeItem${tag('AXES')};
            case 2: return item instanceof ShovelItem${tag('SHOVELS')};
            case 3: return item instanceof HoeItem${tag('HOES')};
            case 4: return item instanceof SwordItem${tag('SWORDS')};
            case 5: return item instanceof ShearsItem || item == Items.SHEARS;
            case 6: return true;
            default: return false;`

  // ── mining level (0 wood/gold … 4 netherite) of the held item, per tool API era ──
  let levelOf: string
  const fromTag = `
    /** Level of a tier from the blocks it cannot mine (vanilla levels by their reference blocks). */
    private static int levelOfIncorrect(TagKey<Block> incorrect) {
        if (incorrect.equals(BlockTags.INCORRECT_FOR_NETHERITE_TOOL)) return 4;
        if (!Blocks.OBSIDIAN.defaultBlockState().is(incorrect)) return 3;
        if (!Blocks.DIAMOND_ORE.defaultBlockState().is(incorrect)) return 2;
        if (!Blocks.IRON_ORE.defaultBlockState().is(incorrect)) return 1;
        return 0;
    }`
  if (p.toolApi === 'tierLevel') {
    j.use('net.minecraft.world.item.TieredItem')
    levelOf = `    private static int levelOf(ItemStack stack) {
        Item item = stack.getItem();
        return item instanceof TieredItem ? ((TieredItem) item).getTier().getLevel() : 0;
    }`
  } else if (p.toolApi === 'tierTag') {
    j.use('net.minecraft.world.item.TieredItem', MC.TagKey, MC.BlockTags, MC.Blocks)
    levelOf = `    private static int levelOf(ItemStack stack) {
        Item item = stack.getItem();
        return item instanceof TieredItem ? levelOfIncorrect(((TieredItem) item).getTier().getIncorrectBlocksForDrops()) : 0;
    }
${fromTag}`
  } else {
    j.use(MC.DataComponents, 'net.minecraft.world.item.component.Tool', 'java.util.Optional', MC.TagKey, MC.BlockTags, MC.Blocks)
    levelOf = `    private static int levelOf(ItemStack stack) {
        Tool tool = stack.get(DataComponents.TOOL);
        if (tool == null) return 0;
        for (Tool.Rule rule : tool.rules()) {
            if (rule.correctForDrops().orElse(true)) continue;
            Optional<TagKey<Block>> incorrect = rule.blocks().unwrapKey();
            if (incorrect.isPresent()) return levelOfIncorrect(incorrect.get());
        }
        return 0;
    }
${fromTag}`
  }

  // ── loader hooks ──
  let hooks: string
  if (fab) {
    j.use('net.fabricmc.fabric.api.event.player.AttackBlockCallback', 'net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents', MC.InteractionResult)
    hooks = `    public static void init() {
        // cannot be broken: refuse to start mining (the client asks first, so the message is shown there)
        AttackBlockCallback.EVENT.register((player, level, hand, pos, direction) -> {
            Rule rule = failed(player, level.getBlockState(pos));
            if (rule == null || !rule.cancel) return InteractionResult.PASS;
            if (level.isClientSide) tell(player, rule);
            return InteractionResult.FAIL;
        });
        PlayerBlockBreakEvents.BEFORE.register((level, player, pos, state, blockEntity) -> {
            Rule rule = failed(player, state);
            if (rule == null) return true;
            tell(player, rule);
            // no drops: remove the block ourselves without its loot
            if (!rule.cancel) level.destroyBlock(pos, false, player);
            return false;
        });
    }`
  } else {
    const ev = forgeEvents(ctx, j)
    const old = loader !== 'neoforge' && (p.mc === '1.16.5' || p.mc === '1.18.2')
    j.use(`${ev.base}.event.entity.player.PlayerEvent`, `${ev.base}.event.${old ? 'world' : 'level'}.BlockEvent`)
    hooks = `    public static void init() {
        ${ev.bus}.addListener(NkwBreakRules::onHarvestCheck);
        ${ev.bus}.addListener(NkwBreakRules::onBreakSpeed);
        ${ev.bus}.addListener(NkwBreakRules::onBreak);
    }

    /** Wrong tool: no drops (and slow mining, like stone by hand). */
    private static void onHarvestCheck(PlayerEvent.HarvestCheck event) {
        if (event.canHarvest() && failed(event.${ev.player}, event.getTargetBlock()) != null) event.setCanHarvest(false);
    }

    /** Cannot be broken: no mining progress at all. */
    private static void onBreakSpeed(PlayerEvent.BreakSpeed event) {
        Rule rule = failed(event.${ev.player}, event.getState());
        if (rule == null || !rule.cancel) return;
        event.setNewSpeed(0.0F);
        tell(event.${ev.player}, rule);
    }

    private static void onBreak(BlockEvent.BreakEvent event) {
        Rule rule = failed(event.getPlayer(), event.getState());
        if (rule == null) return;
        tell(event.getPlayer(), rule);
        if (rule.cancel) event.setCanceled(true);
    }`
  }

  out(
    'NkwBreakRules',
    j.render(`
/** Blocks that need a tool and mining level (Break Rule nodes), and plants that give nothing when broken. */
public final class NkwBreakRules {
    /** tool: 0 pickaxe, 1 axe, 2 shovel, 3 hoe, 4 sword, 5 shears, 6 any, 7 none passes · level: 0 wood/gold … 4 netherite */
    private static final class Rule {
        final int tool;
        final int level;
        /** the block cannot be broken (else: it breaks without drops) */
        final boolean cancel;
        /** only while the plant is not fully grown */
        final boolean young;
        /** lang key of the action-bar message, or null */
        final String message;

        Rule(int tool, int level, boolean cancel, boolean young, String message) {
            this.tool = tool;
            this.level = level;
            this.cancel = cancel;
            this.young = young;
            this.message = message;
        }
    }

    /** rules by block id (the first rule of a block wins) */
    private static final Map<String, Rule> BLOCKS = new HashMap<>();${tagFields}
    /** when each player last saw the message (no spam while mining) */
    private static final Map<UUID, Long> TOLD = new ConcurrentHashMap<>();

    static {
${lines.join('\n')}
    }

    private NkwBreakRules() {}

    private static void add(String block, Rule rule) {
        if (!BLOCKS.containsKey(block)) BLOCKS.put(block, rule);
    }

${hooks}

    /** The rule the player fails with what they hold, or null when they may break the block and get its drops. */
    private static Rule failed(Player player, BlockState state) {
        if (player == null || player.isCreative()) return null;
        Rule rule = BLOCKS.isEmpty() ? null : BLOCKS.get(String.valueOf(${blockKey}));${tagLookup}
        if (rule == null || (rule.young && grown(state))) return null;
        return passes(player.getMainHandItem(), rule) ? null : rule;
    }

    private static boolean passes(ItemStack stack, Rule rule) {
        if (!isTool(stack, rule.tool)) return false;
        return rule.level == 0 || levelOf(stack) >= rule.level;
    }

    private static boolean isTool(ItemStack stack, int tool) {
        Item item = stack.getItem();
        switch (tool) {
${typeCases}
        }
    }

${levelOf}

    /** A plant at its highest "age" (blocks without one count as grown). */
    private static boolean grown(BlockState state) {
        for (Property<?> property : state.getProperties())
            if (property instanceof IntegerProperty && property.getName().equals("age")) {
                IntegerProperty age = (IntegerProperty) property;
                return state.getValue(age) >= Collections.max(age.getPossibleValues());
            }
        return true;
    }

    private static void tell(Player player, Rule rule) {
        if (rule.message == null) return;
        long now = System.currentTimeMillis();
        Long last = TOLD.get(player.getUUID());
        if (last != null && now - last < 1000) return;
        TOLD.put(player.getUUID(), now);
        player.displayClientMessage(${message}.withStyle(ChatFormatting.RED), true);
    }
}`)
  )
}
