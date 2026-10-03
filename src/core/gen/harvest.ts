import type { HarvestUiIR, ModIR } from '../ir'
import { JavaFile, MC, forgeEvents, registry, translatable } from './java'
import { mcAtLeast } from './profiles'
import { fabricLike, type GenCtx } from './types'

/** The timer window used when a node has no Timer window node: text above the hotbar (white). */
const DEFAULT_HARVEST_UI: HarvestUiIR = {
  style: 'text',
  color: 0xffffff,
  back: 0,
  backAlpha: 128,
  place: 'hotbar',
  offset: 0,
  width: 60,
  height: 4,
  radius: 9,
  thickness: 3,
  time: true
}

/** Every timer window of the mod, the default first; a node's window is its index here. */
function harvestUis(ir: ModIR): HarvestUiIR[] {
  const list = [DEFAULT_HARVEST_UI]
  const keys = [JSON.stringify(DEFAULT_HARVEST_UI)]
  const used = [...ir.blocks.flatMap((b) => [b.crop?.ui, b.regen?.ui]), ...ir.gameCrops.map((g) => g.ui), ...ir.breakRules.map((r) => (r.timer ? r.ui : null))]
  for (const ui of used) {
    if (!ui || keys.includes(JSON.stringify(ui))) continue
    keys.push(JSON.stringify(ui))
    list.push(ui)
  }
  return list
}

/** Index of a timer window in harvestUis(ir). */
export function harvestUiIndex(ir: ModIR, ui: HarvestUiIR | null): number {
  return ui
    ? Math.max(
        0,
        harvestUis(ir).findIndex((u) => JSON.stringify(u) === JSON.stringify(ui))
      )
    : 0
}

/** Whether the mod picks any crop by hand (our crops with a right-click harvest, or game crops). */
export const usesHarvest = (ir: ModIR) =>
  ir.gameCrops.length > 0 || ir.blocks.some((b) => (b.crop && b.crop.input !== 'break') || (b.regen && b.regen.input !== 'break'))

/** Whether some block shows its breaking time on screen (Break Rules, Regenerating Blocks). */
const usesBreakTimer = (ir: ModIR) => ir.breakRules.some((r) => r.timer) || ir.blocks.some((b) => b.regen?.timer)

/** Whether the timer HUD is needed: hand harvests or breaking timers. */
export const usesHud = (ir: ModIR) => usesHarvest(ir) || usesBreakTimer(ir)

const INPUT = { click: 1, hold: 2, stand: 3 } as const
const AFTER = { break: 0, replant: 1, regrow: 2 } as const

/**
 * Picking crops by hand: a right-click harvests at once, or starts a timer the player keeps going by
 * holding the button (the game repeats the use every 4 ticks) or by standing still. Works for the mod's
 * crops and for crops of the game / other mods (found by block id, grown = highest "age"). Regenerating
 * Blocks are picked the same way with the left button (read from arm swings). The server runs the timer;
 * the client runs the same timer for the on-screen look (NkwHarvestHud).
 */
export function genHarvest(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, loader, p, ns, ir } = ctx
  const fab = fabricLike(loader)
  const j = new JavaFile(pkg, 'NkwHarvest').use(
    MC.Level,
    MC.ServerLevel,
    MC.BlockPos,
    MC.BlockState,
    MC.ItemStack,
    MC.Item,
    MC.Player,
    MC.SoundEvents,
    MC.SoundSource,
    MC.Component,
    MC.Block,
    'net.minecraft.world.level.block.state.properties.IntegerProperty',
    'net.minecraft.world.level.block.state.properties.Property',
    'net.minecraft.world.InteractionHand',
    'java.util.Collections',
    'java.util.HashMap',
    'java.util.IdentityHashMap',
    'java.util.List',
    'java.util.Map',
    'java.util.UUID'
  )
  const tr = (key: string) => translatable(p, j, `"${key}"`)
  const blockKey = `${registry(p, j, 'BLOCK')}.getKey(block)`
  // some block is picked with the left button (Regenerating Blocks with a click harvest): read from arm swings,
  // but placing a block, using an item or clicking a mob swings the arm too, so those right-clicks are remembered
  const leftButton = ir.blocks.some((b) => b.regen && b.regen.input !== 'break')
  if (leftButton) j.use('net.minecraft.world.phys.HitResult', 'net.minecraft.world.phys.BlockHitResult', 'java.util.concurrent.ConcurrentHashMap')
  let hooks: string
  if (fab) {
    j.use('net.fabricmc.fabric.api.event.player.UseBlockCallback', 'net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents', MC.InteractionResult)
    let rightClicks = ''
    if (leftButton) {
      j.use('net.fabricmc.fabric.api.event.player.UseItemCallback', 'net.fabricmc.fabric.api.event.player.UseEntityCallback')
      // 1.21.2+: UseItemCallback returns an InteractionResult, before an InteractionResultHolder
      const pass = p.propertiesId
        ? 'InteractionResult.PASS'
        : (j.use('net.minecraft.world.InteractionResultHolder'), 'InteractionResultHolder.pass(player.getItemInHand(hand))')
      rightClicks = `
        UseItemCallback.EVENT.register((player, level, hand) -> {
            rightClicked(player, level);
            return ${pass};
        });
        UseEntityCallback.EVENT.register((player, level, hand, entity, hit) -> {
            rightClicked(player, level);
            return InteractionResult.PASS;
        });`
    }
    hooks = `    public static void init() {
        UseBlockCallback.EVENT.register((player, level, hand, hit) -> use(player, level, hit.getBlockPos(), hand) ? InteractionResult.SUCCESS : InteractionResult.PASS);${rightClicks}
        ServerTickEvents.END_WORLD_TICK.register(level -> tick(level));
    }`
  } else {
    const ev = forgeEvents(ctx, j)
    j.use(`${ev.base}.event.entity.player.PlayerInteractEvent`, MC.InteractionResult)
    hooks = `    public static void init() {
        ${ev.bus}.addListener(NkwHarvest::onRightClick);${
          leftButton
            ? `
        ${ev.bus}.addListener(NkwHarvest::onUseItem);
        ${ev.bus}.addListener(NkwHarvest::onUseEntity);`
            : ''
        }
        ${ev.bus}.addListener(NkwHarvest::onTick);
    }
${
  leftButton
    ? `
    private static void onUseItem(PlayerInteractEvent.RightClickItem event) {
        rightClicked(event.${ev.player}, event.${ev.level});
    }

    private static void onUseEntity(PlayerInteractEvent.EntityInteract event) {
        rightClicked(event.${ev.player}, event.${ev.level});
    }
`
    : ''
}
    private static void onRightClick(PlayerInteractEvent.RightClickBlock event) {
        if (use(event.${ev.player}, event.${ev.level}, event.getPos(), event.getHand())) {
            event.setCancellationResult(InteractionResult.SUCCESS);
            event.setCanceled(true);
        }
    }

${ev.tickHandler()}`
  }
  const games = ir.gameCrops.map(
    (g) =>
      `        GAME.put("${g.block}", new Rule(${INPUT[g.input]}, ${g.harvestTicks}, ${AFTER[g.after]}, ${g.back}, ${harvestUiIndex(ir, g.ui)}, ${g.give}, ${g.adventure}, ${g.sneak}, false));`
  )
  // the mod's own crops (only when it has any: NkwCropBlock is not generated otherwise)
  const ownCrops = ir.blocks.some((b) => b.crop)
  const regen = ir.blocks.some((b) => b.regen)
  // Regenerating Blocks are "grown" while they are not depleted; after 3 = their own harvest
  const regenRule = regen
    ? `        if (block instanceof NkwRegenBlock) {
            NkwRegenBlock r = (NkwRegenBlock) block;
            if (r.input > 0) rule = new Rule(r.input, r.harvestTicks, 3, 0, r.ui, r.give, r.adventure, false, true);
        } else `
    : ''
  const ownRule = ownCrops
    ? `        ${regenRule.trimStart()}if (block instanceof NkwCropBlock) {
            NkwCropBlock crop = (NkwCropBlock) block;
            if (crop.input > 0) rule = new Rule(crop.input, crop.harvestTicks, crop.regrow ? 2 : crop.replant ? 1 : 0, crop.replant ? 0 : crop.regrowAge, crop.ui, crop.give, crop.adventure, crop.sneak, false);
        } else `
    : regen
      ? regenRule
      : '        '
  out(
    'NkwHarvest',
    j.render(`
/** Picking crops by hand, with a timer on screen (NkwHarvestHud). */
public final class NkwHarvest {
    /**
     * How a crop is picked. input: 1 click, 2 hold, 3 click then stand still (left: with the left mouse button,
     * else the right); after: 0 break, 1 replant, 2 back to an age, 3 a Regenerating Blocks block.
     */
    public static final class Rule {
        public final int input;
        public final int ticks;
        public final int after;
        public final int back;
        /** timer look (NkwHarvestHud) */
        public final int ui;
        /** the harvest goes straight into the inventory instead of dropping */
        public final boolean give;
        /** players in adventure mode may pick it */
        public final boolean adventure;
        /** picked only while sneaking */
        public final boolean sneak;
        /** picked with the left mouse button (Regenerating Blocks), else the right */
        public final boolean left;

        Rule(int input, int ticks, int after, int back, int ui, boolean give, boolean adventure, boolean sneak, boolean left) {
            this.input = input;
            this.ticks = Math.max(1, ticks);
            this.after = after;
            this.back = back;
            this.ui = ui;
            this.give = give;
            this.adventure = adventure;
            this.sneak = sneak;
            this.left = left;
        }
    }

    public static final class Session {
        public final BlockPos pos;
        public final Rule rule;
        public final long start;
        long lastUse;
        final double x;
        final double y;
        final double z;

        Session(BlockPos pos, Rule rule, long now, Player player) {
            this.pos = pos;
            this.rule = rule;
            this.start = now;
            this.lastUse = now;
            this.x = player.getX();
            this.y = player.getY();
            this.z = player.getZ();
        }
    }

    /** crops of the game and of other mods, by block id */
    private static final Map<String, Rule> GAME = new HashMap<>();
    /** rule cache (read by the client render thread and the server thread: synchronized; null = no rule) */
    private static final Map<Block, Rule> RULES = Collections.synchronizedMap(new IdentityHashMap<>());
    private static final Map<UUID, Session> SESSIONS = new HashMap<>();
    /** ticks without a new swing after which a held left button counts as let go (a held button swings every 4) */
    private static final int LEFT_GAP = 6;
    /** the local player's harvest (client side) */
    private static Session client;

    static {
${games.join('\n')}
    }

    private NkwHarvest() {}

${hooks}

    /** How a block is picked by hand, or null. */
    public static Rule ruleOf(Block block) {
        if (RULES.containsKey(block)) return RULES.get(block);
        Rule rule = null;
${ownRule}if (!GAME.isEmpty()) {
            rule = GAME.get(String.valueOf(${blockKey}));
        }
        RULES.put(block, rule);
        return rule;
    }

    /** The block's growth stage property ("age"), or null. */
    private static IntegerProperty age(BlockState state) {
        for (Property<?> property : state.getProperties())
            if (property instanceof IntegerProperty && property.getName().equals("age")) return (IntegerProperty) property;
        return null;
    }

    private static int maxAge(IntegerProperty age) {
        return Collections.max(age.getPossibleValues());
    }

    /** Fully grown and picked by hand. */
    private static Rule grown(BlockState state) {
        Rule rule = ruleOf(state.getBlock());
        if (rule == null) return null;
        if (rule.after == 3) return rule;
        IntegerProperty age = age(state);
        return age != null && state.getValue(age) >= maxAge(age) ? rule : null;
    }

    /** A right-click on a block: true when it was a grown crop picked by hand (the click is used up). */
    static boolean use(Player player, Level level, BlockPos pos, InteractionHand hand) {${leftButton ? '\n        rightClicked(player, level);' : ''}
        BlockState state = level.getBlockState(pos);
        Rule rule = grown(state);
        if (rule == null || rule.left) return false;
        // adventure mode (players who may not build): picking by hand only when the crop allows it
        if (!rule.adventure && !player.mayBuild()) return false;
        // sneaking only: a normal right-click does what it does in the game, with a hint
        if (rule.sneak && !player.isShiftKeyDown()) {
            if (!level.isClientSide && hand == InteractionHand.MAIN_HAND) player.displayClientMessage(${tr(`message.${ns}.harvest_sneak`)}, true);
            return false;
        }
        if (hand != InteractionHand.MAIN_HAND) return true;
        long now = level.getGameTime();
        if (level.isClientSide) {
            if (rule.input >= 2) client = track(client, pos, rule, now, player);
            return true;
        }
        if (rule.input == 1) {
            harvest(player, level, pos, state, rule);
            return true;
        }
        SESSIONS.put(player.getUUID(), track(SESSIONS.get(player.getUUID()), pos, rule, now, player));
        return true;
    }

    private static Session track(Session s, BlockPos pos, Rule rule, long now, Player player) {
        // left button: a gap in the swings means the button was let go, so pressing again starts over
        if (s != null && s.pos.equals(pos) && s.rule == rule && !(rule.left && now - s.lastUse > LEFT_GAP)) {
            s.lastUse = now;
            return s;
        }
        return new Session(pos, rule, now, player);
    }

    /** 0 still going, 1 the crop is gone, 2 the button was let go, 3 the player moved, 4 the player stood up (sneaking only). */
    private static int check(Session s, Player player, Level level, long now) {
        if (grown(level.getBlockState(s.pos)) != s.rule) return 1;
        if (s.rule.sneak && !player.isShiftKeyDown()) return 4;
        if (s.rule.input == 2 && now - s.lastUse > (s.rule.left ? LEFT_GAP : 7)) return 2;
        if (s.rule.input == 3 && player.distanceToSqr(s.x, s.y, s.z) > 0.04) return 3;
        return 0;
    }

    /** A grown block picked with the left button that adventure-mode players may pick (client side: the tool swings). */
    public static boolean adventurePick(Level level, BlockPos pos) {
        Rule rule = grown(level.getBlockState(pos));
        return rule != null && rule.left && rule.adventure;
    }

    /** The local player's running harvest, for the timer on screen (client side), or null. */
    public static Session client(Player player, Level level) {
        long now = level.getGameTime();${
          leftButton
            ? `
        BlockPos swung = swingTarget(player, level);
        if (swung != null) {
            Rule rule = grown(level.getBlockState(swung));
            if (rule != null && rule.input >= 2) client = track(client, swung, rule, now, player);
        }`
            : ''
        }
        if (client != null && check(client, player, level, now) != 0) client = null;
        return client;
    }${
      leftButton
        ? `

    /** game time of each player's last right-click (both sides) */
    private static final Map<UUID, Long> RIGHT_CLICKED = new ConcurrentHashMap<>();

    /** A right-click happened: its arm swing is not a left click. */
    static void rightClicked(Player player, Level level) {
        RIGHT_CLICKED.put(player.getUUID(), level.getGameTime());
    }

    /**
     * Left-button picking: the grown block picked with the left button that the player swings the arm at (a
     * click, or held on a block that cannot be mined), or null. Works on both sides from the swing and the look.
     */
    private static BlockPos swingTarget(Player player, Level level) {
        // only a swing that just started: a held button starts one every 4 ticks, a let-go button none
        if (!player.swinging || player.swingTime > 1 || player.isSpectator()) return null;
        // the swing of a right-click (placing a block, using an item …) is no left click: a swing that started
        // within 2 ticks (0.1 s) of a right-click is ignored for as long as it lasts, later swings count right away
        Long right = RIGHT_CLICKED.get(player.getUUID());
        if (right != null) {
            long started = level.getGameTime() - Math.max(0, player.swingTime) - right;
            if (started >= -1 && started <= 2) return null;
        }
        HitResult hit = player.pick(${p.stackId ? 'player.blockInteractionRange()' : '4.5'}, 1.0F, false);
        if (!(hit instanceof BlockHitResult) || hit.getType() != HitResult.Type.BLOCK) return null;
        BlockPos pos = ((BlockHitResult) hit).getBlockPos().immutable();
        Rule rule = grown(level.getBlockState(pos));
        if (rule == null || !rule.left || (!rule.adventure && !player.mayBuild())) return null;
        // the tool must be good enough for the original block, like mining it
        return ((NkwRegenBlock) level.getBlockState(pos).getBlock()).canHarvest(player) ? pos : null;
    }`
        : ''
    }

    private static void tick(Level level) {
        if (level.isClientSide${leftButton ? '' : ' || SESSIONS.isEmpty()'}) return;
        long now = level.getGameTime();
        for (Player player : level.players()) {${
          leftButton
            ? `
            BlockPos swung = swingTarget(player, level);
            if (swung != null) {
                Rule swing = grown(level.getBlockState(swung));
                SESSIONS.put(player.getUUID(), track(SESSIONS.get(player.getUUID()), swung, swing, now, player));
            }`
            : ''
        }
            Session s = SESSIONS.get(player.getUUID());
            if (s == null) continue;
            int stop = check(s, player, level, now);
            if (stop != 0) {
                SESSIONS.remove(player.getUUID());
                if (stop == 2) player.displayClientMessage(s.rule.left ? ${tr(`message.${ns}.harvest_released_left`)} : ${tr(`message.${ns}.harvest_released`)}, true);
                if (stop == 4) player.displayClientMessage(${tr(`message.${ns}.harvest_sneak`)}, true);
                if (stop == 3) player.displayClientMessage(s.rule.left ? ${tr(`message.${ns}.harvest_moved_left`)} : ${tr(`message.${ns}.harvest_moved`)}, true);
                continue;
            }
            // holding the left button: only the time it was held counts (up to its last swing)
            long counted = s.rule.left && s.rule.input == 2 ? s.lastUse : now;
            if (counted - s.start >= s.rule.ticks) {
                SESSIONS.remove(player.getUUID());
                harvest(player, level, s.pos, level.getBlockState(s.pos), s.rule);
                player.displayClientMessage(${tr(`message.${ns}.harvest_done`)}, true);
            }
        }
    }

    private static void harvest(Player player, Level level, BlockPos pos, BlockState state, Rule rule) {${
      regen
        ? `
        if (rule.after == 3) {
            ((NkwRegenBlock) state.getBlock()).harvest(level, pos, player, player.getMainHandItem(), false);
            return;
        }`
        : ''
    }
        IntegerProperty age = age(state);
        if ((rule.after == 0 || age == null) && !rule.give) {
            level.destroyBlock(pos, true, player);
            return;
        }
        List<ItemStack> drops = Block.getDrops(state, (ServerLevel) level, pos, level.getBlockEntity(pos));
        if (rule.after == 0 || age == null) {
            level.destroyBlock(pos, false, player);
            give(player, level, pos, drops);
            return;
        }
        if (rule.after == 1) {
            // replanted: one seed goes back into the ground
            Item seed = state.getBlock().asItem();
            for (ItemStack stack : drops)
                if (stack.getItem() == seed && !stack.isEmpty()) {
                    stack.shrink(1);
                    break;
                }
        }
        if (rule.give) give(player, level, pos, drops);
        else for (ItemStack stack : drops) if (!stack.isEmpty()) Block.popResource(level, pos, stack);
        level.playSound(null, pos, rule.after == 1 ? SoundEvents.CROP_BREAK : SoundEvents.SWEET_BERRY_BUSH_PICK_BERRIES, SoundSource.BLOCKS, 1.0F, 0.8F + level.getRandom().nextFloat() * 0.4F);
        level.setBlock(pos, state.setValue(age, Math.max(0, Math.min(rule.back, maxAge(age) - 1))), 2);
    }

    /** Puts the harvest into the player's inventory; what does not fit drops at the player's feet. */
    private static void give(Player player, Level level, BlockPos pos, List<ItemStack> drops) {
        boolean any = false;
        for (ItemStack stack : drops) {
            if (stack.isEmpty()) continue;
            any = true;
            if (!player.addItem(stack) && !stack.isEmpty()) player.drop(stack, false);
        }
        if (any) level.playSound(null, player.getX(), player.getY(), player.getZ(), SoundEvents.ITEM_PICKUP, SoundSource.PLAYERS, 0.2F, 1.4F + level.getRandom().nextFloat() * 0.4F);
    }
}`)
  )
}

/** ARGB int literal. */
const argb = (rgb: number, alpha = 255) => `0x${((((alpha & 0xff) << 24) | rgb) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`

/**
 * The timer on screen (client only) for picking by hand and for breaking blocks that show their breaking
 * time: text, a bar that fills up or a circle that fills around the crosshair. Drawn on the HUD with the
 * loader's hook; GuiGraphics on 1.20+, PoseStack before.
 */
export function genHarvestHud(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, loader, p, ns, ir } = ctx
  const harvest = usesHarvest(ir)
  const breaking = usesBreakTimer(ir)
  const fab = fabricLike(loader)
  const neo = loader === 'neoforge'
  const graphics = mcAtLeast(p.mc, '1.20.1')
  const j = new JavaFile(pkg, 'NkwHarvestHud').use('net.minecraft.client.Minecraft', 'net.minecraft.client.resources.language.I18n')
  const G = graphics ? (j.use('net.minecraft.client.gui.GuiGraphics'), 'GuiGraphics') : (j.use('com.mojang.blaze3d.vertex.PoseStack'), 'PoseStack')
  if (!graphics) j.use('net.minecraft.client.gui.GuiComponent')
  let hooks: string
  if (fab) {
    j.use('net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback')
    hooks = `    public static void init() {
        HudRenderCallback.EVENT.register((graphics, delta) -> render(graphics));
    }`
  } else {
    const base = neo ? 'net.neoforged.neoforge' : 'net.minecraftforge'
    j.use(neo ? 'net.neoforged.bus.api.IEventBus' : 'net.minecraftforge.eventbus.api.IEventBus')
    j.use(neo ? 'net.neoforged.neoforge.common.NeoForge' : 'net.minecraftforge.common.MinecraftForge')
    const bus = neo ? 'NeoForge.EVENT_BUS' : 'MinecraftForge.EVENT_BUS'
    if (!neo && (p.mc === '1.16.5' || p.mc === '1.18.2')) {
      j.use('net.minecraftforge.client.event.RenderGameOverlayEvent')
      hooks = `    public static void init(IEventBus modBus) {
        ${bus}.addListener(NkwHarvestHud::onOverlay);
    }

    private static void onOverlay(RenderGameOverlayEvent.Post event) {
        if (event.getType() == RenderGameOverlayEvent.ElementType.ALL) render(event.getMatrixStack());
    }`
    } else if (!neo && p.mc === '1.21.1') {
      // Forge 1.21.1 has no HUD event: the chat is drawn on every HUD frame
      j.use('net.minecraftforge.client.event.CustomizeGuiOverlayEvent')
      hooks = `    public static void init(IEventBus modBus) {
        ${bus}.addListener(NkwHarvestHud::onChat);
    }

    private static void onChat(CustomizeGuiOverlayEvent.Chat event) {
        render(event.getGuiGraphics());
    }`
    } else if (!neo && mcAtLeast(p.mc, '1.21.4')) {
      j.use('net.minecraftforge.client.event.AddGuiOverlayLayersEvent')
      hooks = `    public static void init(IEventBus modBus) {
        modBus.addListener(NkwHarvestHud::onLayers);
    }

    private static void onLayers(AddGuiOverlayLayersEvent event) {
        event.getLayeredDraw().add(NkwMod.id("harvest_timer"), (graphics, delta) -> render(graphics));
    }`
    } else {
      j.use(`${base}.client.event.RenderGuiEvent`)
      hooks = `    public static void init(IEventBus modBus) {
        ${bus}.addListener(NkwHarvestHud::onGui);
    }

    private static void onGui(RenderGuiEvent.Post event) {
        render(event.${graphics ? 'getGuiGraphics' : 'getPoseStack'}());
    }`
    }
  }
  const STYLE = { text: 0, bar: 1, ring: 2 } as const
  const PLACE = { crosshair: 0, hotbar: 1, top: 2 } as const
  const rows = harvestUis(ir).map(
    (u) =>
      `        { ${STYLE[u.style]}, ${argb(u.color)}, ${argb(u.back, u.backAlpha)}, ${PLACE[u.place]}, ${u.offset}, ${u.width}, ${u.height}, ${u.radius}, ${u.thickness}, ${u.time ? 1 : 0} }`
  )
  const fill = graphics ? 'graphics.fill(x1, y1, x2, y2, color);' : 'GuiComponent.fill(graphics, x1, y1, x2, y2, color);'
  const text = graphics
    ? 'graphics.drawString(Minecraft.getInstance().font, s, x, y, color);'
    : 'Minecraft.getInstance().font.drawShadow(graphics, s, x, y, color);'
  const harvestPart = `        NkwHarvest.Session s = NkwHarvest.client(mc.player, mc.level);
        // holding the left button: the timer goes away the moment it is let go
        if (s != null && s.rule.left && s.rule.input == 2 && !mc.options.keyAttack.isDown()) s = null;
        if (s != null) {
            long done = mc.level.getGameTime() - s.start;
            ui = s.rule.ui;
            progress = Math.max(0.0F, Math.min(1.0F, done / (float) s.rule.ticks));
            ticksLeft = Math.max(0L, s.rule.ticks - done);
        }`
  const breakPart = `if (ui < 0) {
            float[] b = breaking(mc);
            if (b != null) {
                ui = (int) b[0];
                progress = b[1];
                ticksLeft = b[2];
                mining = true;
            }
        }`
  const timerSource = `        int ui = -1;
        float progress = 0.0F;
        double ticksLeft = 0;
        boolean mining = false;
${[harvest ? harvestPart : '', breaking ? `        ${breakPart}` : ''].filter(Boolean).join('\n')}
        if (ui < 0) return;`
  // adventure mode cannot mine, so the game stops swinging the tool after the first hit: keep it swinging
  // while the left button is held on a block picked with it (the swings also reach the server)
  const BOB_FIELD = '    /** game time of the last up-down bob of the item in hand (adventure mode) */\n    private static long lastBob = -1;\n\n'
  let adventureSwing = ''
  if (ir.blocks.some((b) => b.regen && b.regen.input !== 'break' && b.regen.adventure)) {
    j.use('net.minecraft.world.phys.BlockHitResult', 'net.minecraft.world.phys.HitResult', 'net.minecraft.world.InteractionHand')
    adventureSwing = `
        if (mc.screen == null && !mc.player.mayBuild() && !mc.player.isSpectator() && mc.options.keyAttack.isDown()
                && mc.hitResult instanceof BlockHitResult && mc.hitResult.getType() == HitResult.Type.BLOCK
                && NkwHarvest.adventurePick(mc.level, ((BlockHitResult) mc.hitResult).getBlockPos())) {
            mc.player.swing(InteractionHand.MAIN_HAND);
            // the item in hand also bobs up and down (the game's "item used" dip, every 4 ticks)
            long now = mc.level.getGameTime();
            if (now != lastBob && now % 4 == 0) {
                lastBob = now;
                ${p.mc === '1.16.5' ? 'mc.getItemInHandRenderer()' : 'mc.gameRenderer.itemInHandRenderer'}.itemUsed(InteractionHand.MAIN_HAND);
            }
        }`
  }
  let breakTracker = ''
  if (breaking) {
    const breakLook = [
      ...(ir.blocks.some((b) => b.regen?.timer) ? ['state.getBlock() instanceof NkwRegenBlock ? ((NkwRegenBlock) state.getBlock()).breakUi'] : []),
      ir.breakRules.some((r) => r.timer) ? 'NkwBreakRules.timerLook(state)' : '-1'
    ].join(' : ')
    j.use(MC.BlockPos, MC.BlockState, 'net.minecraft.world.phys.BlockHitResult')
    breakTracker = `    /** the block being mined (client side), the game time it was last counted and its progress (0–1) */
    private static BlockPos minedPos;
    private static long minedTime;
    private static float minedProgress;

    /**
     * Mining of a block that shows its breaking time (Break Rule, Regenerating Blocks): { window, progress, ticks left }, or null. Counts the
     * progress per tick the way the game does (the same speed the game uses for this player and tool).
     */
    private static float[] breaking(Minecraft mc) {
        if (mc.gameMode == null || !mc.gameMode.isDestroying() || !(mc.hitResult instanceof BlockHitResult) || mc.player.isCreative()) {
            minedPos = null;
            return null;
        }
        BlockPos pos = ((BlockHitResult) mc.hitResult).getBlockPos();
        BlockState state = mc.level.getBlockState(pos);
        int look = ${breakLook};
        if (look < 0) {
            minedPos = null;
            return null;
        }
        float perTick = state.getDestroyProgress(mc.player, mc.level, pos);
        long now = mc.level.getGameTime();
        if (!pos.equals(minedPos)) {
            minedPos = pos.immutable();
            minedTime = now;
            minedProgress = 0.0F;
        } else if (now > minedTime) {
            minedProgress += perTick * (now - minedTime);
            minedTime = now;
        }
        if (perTick <= 0.0F || perTick >= 1.0F) return null;
        float progress = Math.min(1.0F, minedProgress);
        return new float[] { look, progress, (1.0F - progress) / perTick };
    }

`
  }
  out(
    'NkwHarvestHud',
    j.render(`
/** The harvest timer, and the breaking timer of Break Rule blocks, on screen (client only). */
public final class NkwHarvestHud {
    /** style (0 text, 1 bar, 2 circle), colour, background, place (0 crosshair, 1 hotbar, 2 top), offset, width, height, radius, thickness, seconds */
    private static final int[][] LOOKS = {
${rows.join(',\n')}
    };

    private NkwHarvestHud() {}

${hooks}

    private static void render(${G} graphics) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.level == null) return;${adventureSwing}
        if (mc.options.hideGui) return;
${timerSource}
        int[] look = LOOKS[ui < LOOKS.length ? ui : 0];
        String left = String.format("%.1f", ticksLeft / 20.0);
        String key = mining ? "message.${ns}.breaking" : "message.${ns}.harvest";
        int w = mc.getWindow().getGuiScaledWidth();
        int h = mc.getWindow().getGuiScaledHeight();
        int cx = w / 2;
        int cy = h / 2;
        boolean time = look[9] != 0;
        if (look[0] == 2) {
            ring(graphics, cx, cy, look[7], look[8], progress, look[1], look[2]);
            if (time) centered(graphics, I18n.get("message.${ns}.harvest_seconds", left), cx, cy + look[7] + 3, 0xFFFFFFFF);
            return;
        }
        int height = look[0] == 1 ? look[6] + 2 : 9;
        int y = look[3] == 0 ? cy + 10 : look[3] == 1 ? h - 50 - height : 10;
        y += look[4];
        if (look[0] == 0) {
            StringBuilder bar = new StringBuilder();
            int filled = (int) (10 * progress);
            for (int i = 0; i < 10; i++) bar.append(i < filled ? '\\u25A0' : '\\u25A1');
            String line = time ? I18n.get(key, bar.toString(), left) : I18n.get(key + "_notime", bar.toString());
            centered(graphics, line, cx, y, look[1]);
            return;
        }
        int x = cx - look[5] / 2;
        if ((look[2] >>> 24) != 0) fill(graphics, x - 1, y, x + look[5] + 1, y + look[6] + 2, look[2]);
        fill(graphics, x, y + 1, x + Math.round(look[5] * progress), y + 1 + look[6], look[1]);
        if (time) text(graphics, I18n.get("message.${ns}.harvest_seconds", left), x + look[5] + 4, y + look[6] / 2 - 3, 0xFFFFFFFF);
    }

${adventureSwing ? BOB_FIELD : ''}${breakTracker}
    /** A circle that fills clockwise from the top (thickness >= radius: a filled disc), drawn in runs of pixels. */
    private static void ring(${G} graphics, int cx, int cy, int radius, int thickness, float progress, int color, int back) {
        float inner = Math.max(0, radius - thickness);
        for (int dy = -radius; dy < radius; dy++) {
            int runStart = -radius;
            int runColor = 0;
            for (int dx = -radius; dx <= radius; dx++) {
                int c = 0;
                if (dx < radius) {
                    double px = dx + 0.5;
                    double py = dy + 0.5;
                    double d = Math.sqrt(px * px + py * py);
                    if (d <= radius && d >= inner) {
                        double angle = Math.atan2(px, -py);
                        if (angle < 0) angle += Math.PI * 2;
                        c = angle / (Math.PI * 2) <= progress ? color : back;
                    }
                }
                if (c != runColor || dx == radius) {
                    if ((runColor >>> 24) != 0) fill(graphics, cx + runStart, cy + dy, cx + dx, cy + dy + 1, runColor);
                    runStart = dx;
                    runColor = c;
                }
            }
        }
    }

    private static void centered(${G} graphics, String s, int cx, int y, int color) {
        text(graphics, s, cx - Minecraft.getInstance().font.width(s) / 2, y, color);
    }

    private static void fill(${G} graphics, int x1, int y1, int x2, int y2, int color) {
        ${fill}
    }

    private static void text(${G} graphics, String s, int x, int y, int color) {
        ${text}
    }
}`)
  )
}
