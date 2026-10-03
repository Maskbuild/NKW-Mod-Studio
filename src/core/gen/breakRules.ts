import type { BreakDrops, ModIR } from '../ir'
import { JavaFile, MC, forgeEvents, registry, translatable } from './java'
import { harvestUiIndex } from './harvest'
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
  const blockKey = `${registry(p, j, 'BLOCK')}.getKey(state.getBlock())`
  const message = translatable(p, j, 'rule.message')

  // ── rules ──
  const lines: string[] = []
  const tags: { tag: string; rule: string }[] = []
  ir.breakRules.forEach((r, i) => {
    const name = `RULE_${i}`
    const msg = r.message ? `"${breakRuleKey(ns, i)}"` : 'null'
    const ui = r.timer ? harvestUiIndex(ir, r.ui) : -1
    lines.push(`        Rule ${name} = new Rule(${TOOL_CODE[r.tool]}, ${LEVEL_CODE[r.level]}, ${r.onFail === 'cantBreak'}, false, ${msg}, ${ui});`)
    for (const b of r.blocks) lines.push(`        add("${b}", ${name});`)
    if (tagged) for (const t of r.tags) tags.push({ tag: t, rule: name })
    if (r.adventure) {
      const all = [...r.blocks, ...(tagged ? r.tags.map((x) => `#${x}`) : [])]
      lines.push(`        ADVENTURE.put(${name}, new String[] {${all.map((x) => `"${x}"`).join(', ')}});`)
    }
  })
  const adventure = ir.breakRules.some((r) => r.adventure)
  const plants = plantRules(ir)
  if (plants.some((x) => x.drops === 'none')) lines.push(`        Rule PLANT_NONE = new Rule(${NEVER}, 0, false, false, null, -1);`)
  if (plants.some((x) => x.drops === 'grown')) lines.push(`        Rule PLANT_YOUNG = new Rule(${NEVER}, 0, false, true, null, -1);`)
  for (const x of plants) lines.push(`        add("${x.block}", ${x.drops === 'none' ? 'PLANT_NONE' : 'PLANT_YOUNG'});`)

  let tagFields = ''
  let tagLookup = ''
  if (tags.length) {
    j.use(MC.TagKey, MC.RL, 'java.util.ArrayList', 'java.util.List')
    const blockKeys = p.builtInRegistries ? (j.use(MC.Registries), 'Registries.BLOCK') : (j.use(MC.Registry), 'Registry.BLOCK_REGISTRY')
    const rl = (id: string) => (p.rlFactory ? `ResourceLocation.parse("${id}")` : `new ResourceLocation("${id}")`)
    for (const t of tags) lines.push(`        TAGS.add(TagKey.create(${blockKeys}, ${rl(t.tag)}));\n        TAG_RULES.add(${t.rule});`)
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

  // ── adventure mode: tools that pass a rule get the rule's blocks as their hidden "can break" list ──
  let adventureCode = ''
  if (adventure) {
    j.use(MC.Level, 'java.util.ArrayList', 'java.util.List', 'java.util.LinkedHashMap')
    let apply: string
    if (p.stackId) {
      // 1.20.5+: the can_break item component
      j.use(
        MC.DataComponents,
        MC.Holder,
        MC.TagKey,
        MC.RL,
        MC.BuiltIn,
        MC.Registries,
        'net.minecraft.core.HolderSet',
        'net.minecraft.world.item.AdventureModePredicate',
        'net.minecraft.advancements.critereon.BlockPredicate',
        'java.util.Optional'
      )
      apply = `        if (stack.has(DataComponents.CAN_BREAK)) return;
        List<Holder<Block>> holders = new ArrayList<>();
        for (String id : blocks) {
            if (id.startsWith("#")) {
                TagKey<Block> tag = TagKey.create(Registries.BLOCK, ResourceLocation.parse(id.substring(1)));
                for (Block block : BuiltInRegistries.BLOCK)
                    if (block.defaultBlockState().is(tag) && !holders.contains(block.builtInRegistryHolder())) holders.add(block.builtInRegistryHolder());
            } else {
                Optional<Block> block = BuiltInRegistries.BLOCK.getOptional(ResourceLocation.parse(id));
                if (block.isPresent() && !holders.contains(block.get().builtInRegistryHolder())) holders.add(block.get().builtInRegistryHolder());
            }
        }
        if (holders.isEmpty()) return;
        stack.set(DataComponents.CAN_BREAK, new AdventureModePredicate(List.of(new BlockPredicate(Optional.of(HolderSet.direct(holders)), Optional.empty(), Optional.empty())), false));`
    } else {
      // older versions: the CanDestroy tag (accepts ids and #tags), hidden from the tooltip
      j.use('net.minecraft.nbt.CompoundTag', 'net.minecraft.nbt.ListTag', 'net.minecraft.nbt.StringTag')
      apply = `        CompoundTag tag = stack.getOrCreateTag();
        if (tag.contains("CanDestroy")) return;
        ListTag list = new ListTag();
        for (String id : blocks) list.add(StringTag.valueOf(id));
        tag.put("CanDestroy", list);
        tag.putInt("HideFlags", tag.getInt("HideFlags") | 8);`
    }
    adventureCode = `

    /** Adventure mode can break nothing: a held tool that passes a rule gets that rule's blocks as its "can break" list. */
    private static void tick(Level level) {
        if (level.isClientSide || ADVENTURE.isEmpty() || level.getGameTime() % 10 != 0) return;
        for (Player player : level.players()) {
            if (player.mayBuild() || player.isSpectator()) continue;
            ItemStack stack = player.getMainHandItem();
            if (stack.isEmpty()) continue;
            List<String> blocks = new ArrayList<>();
            for (Map.Entry<Rule, String[]> e : ADVENTURE.entrySet())
                if (passes(stack, e.getKey()))
                    for (String id : e.getValue())
                        if (!blocks.contains(id)) blocks.add(id);
            if (!blocks.isEmpty()) allowInAdventure(stack, blocks);
        }
    }

    /** Gives a tool a hidden "can break" list (a list the map maker already set is kept). */
    private static void allowInAdventure(ItemStack stack, List<String> blocks) {
${apply}
    }`
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
        });${adventure ? (j.use('net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents'), '\n        ServerTickEvents.END_WORLD_TICK.register(level -> tick(level));') : ''}
    }`
  } else {
    const ev = forgeEvents(ctx, j)
    const old = loader !== 'neoforge' && (p.mc === '1.16.5' || p.mc === '1.18.2')
    j.use(`${ev.base}.event.entity.player.PlayerEvent`, `${ev.base}.event.${old ? 'world' : 'level'}.BlockEvent`)
    hooks = `    public static void init() {
        ${ev.bus}.addListener(NkwBreakRules::onHarvestCheck);
        ${ev.bus}.addListener(NkwBreakRules::onBreakSpeed);
        ${ev.bus}.addListener(NkwBreakRules::onBreak);${adventure ? `\n        ${ev.bus}.addListener(NkwBreakRules::onTick);` : ''}
    }
${adventure ? `\n${ev.tickHandler()}\n` : ''}
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
        /** look of the breaking timer (NkwHarvestHud), -1 = no timer */
        final int ui;

        Rule(int tool, int level, boolean cancel, boolean young, String message, int ui) {
            this.tool = tool;
            this.level = level;
            this.cancel = cancel;
            this.young = young;
            this.message = message;
            this.ui = ui;
        }
    }

    /** rules by block id (the first rule of a block wins) */
    private static final Map<String, Rule> BLOCKS = new HashMap<>();${tagFields}
    /** when each player last saw the message (no spam while mining) */
    private static final Map<UUID, Long> TOLD = new ConcurrentHashMap<>();${adventure ? '\n    /** rules whose blocks can be broken in adventure mode, with those blocks (ids and #tags) */\n    private static final Map<Rule, String[]> ADVENTURE = new LinkedHashMap<>();' : ''}

    static {
${lines.join('\n')}
    }

    private NkwBreakRules() {}

    private static void add(String block, Rule rule) {
        if (!BLOCKS.containsKey(block)) BLOCKS.put(block, rule);
    }

${hooks}

    /** The rule of a block (by id, then by tag), or null. */
    private static Rule ruleOf(BlockState state) {
        Rule rule = BLOCKS.isEmpty() ? null : BLOCKS.get(String.valueOf(${blockKey}));${tagLookup}
        return rule;
    }

    /** Look of the breaking timer for a block (NkwHarvestHud), or -1 when it shows none. */
    public static int timerLook(BlockState state) {
        Rule rule = ruleOf(state);
        return rule == null ? -1 : rule.ui;
    }

    /** The rule the player fails with what they hold, or null when they may break the block and get its drops. */
    private static Rule failed(Player player, BlockState state) {
        if (player == null || player.isCreative()) return null;
        Rule rule = ruleOf(state);
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
    }${adventureCode}
}`)
  )
}
