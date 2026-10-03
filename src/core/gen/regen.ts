import type { BlockIR, ModIR } from '../ir'
import { JavaFile, MC } from './java'
import { harvestUiIndex } from './harvest'
import { fabricLike, type GenCtx } from './types'

/** Whether the mod has Regenerating Blocks. */
export const usesRegen = (ir: ModIR) => ir.blocks.some((b) => b.regen)

const INPUT = { break: 0, click: 1, hold: 2, stand: 3 } as const

/** Java expression that makes a Regenerating Blocks block or its depleted form (`props` = its block properties). */
export function regenCtor(ctx: GenCtx, b: BlockIR, props: string): string {
  const fab = fabricLike(ctx.loader)
  const ref = (id: string) => (fab ? `ModBlocks.${id.toUpperCase()}` : `ModBlocks.${id.toUpperCase()}.get()`)
  if (b.depleted) return `new NkwDepletedBlock(${props}, () -> ${ref(b.depleted.restore)}, ${b.depleted.ticks})`
  const r = b.regen!
  const ui = harvestUiIndex(ctx.ir, r.ui)
  const drop = r.drop ? `"${r.drop.item}", ${r.drop.min}, ${r.drop.max}` : 'null, 0, 0'
  return `new NkwRegenBlock(${props}, "${r.original}", () -> ${ref(r.depleted)}, ${INPUT[r.input]}, ${r.harvestTicks}, ${ui}, ${r.timer ? ui : -1}, ${r.give}, ${r.adventure}, ${drop})`
}

/**
 * Regenerating Blocks: NkwRegenBlock looks like a block of the game / another mod and gives its drops
 * when harvested, then turns into NkwDepletedBlock (cannot be broken or pushed) that turns back after a
 * scheduled tick. NkwRegenBlockItem: only operators can place them; named after the original block.
 */
export function genRegen(ctx: GenCtx, out: (cls: string, text: string) => void): void {
  const { pkg, p, ns } = ctx
  const oldPush = p.blockMaterial // ≤1.19: push reaction is a method, later a block property
  const tr = (key: string, arg = '') =>
    ['1.16.5', '1.18.2'].includes(p.mc) ? `new TranslatableComponent("${key}"${arg})` : `Component.translatable("${key}"${arg})`
  const trImport = ['1.16.5', '1.18.2'].includes(p.mc) ? 'net.minecraft.network.chat.TranslatableComponent' : MC.Component
  const reg = p.builtInRegistries ? 'BuiltInRegistries.BLOCK' : 'Registry.BLOCK'
  const regItems = p.builtInRegistries ? 'BuiltInRegistries.ITEM' : 'Registry.ITEM'
  const lookup = p.propertiesId ? 'getValue' : 'get'
  const rl = (v: string) => (p.rlFactory ? `ResourceLocation.parse(${v})` : `new ResourceLocation(${v})`)
  const push = (j: JavaFile) =>
    oldPush
      ? (j.use('net.minecraft.world.level.material.PushReaction'),
        `

    /** Pistons cannot move it (moving it would copy the resource). */
    @Override
    public PushReaction getPistonPushReaction(BlockState state) {
        return PushReaction.BLOCK;
    }`)
      : ''

  // ── the block that is harvested ──
  {
    const j = new JavaFile(pkg, 'NkwRegenBlock').use(
      MC.Block,
      MC.Blocks,
      MC.BlockBehaviour,
      MC.BlockState,
      MC.BlockPos,
      MC.BlockEntity,
      MC.Level,
      MC.ServerLevel,
      MC.Player,
      MC.ItemStack,
      MC.Item,
      MC.RL,
      'java.util.Collections',
      p.builtInRegistries ? MC.BuiltIn : MC.Registry,
      'java.util.List',
      'java.util.function.Supplier'
    )
    out(
      'NkwRegenBlock',
      j.render(`
/** A Regenerating Blocks block: looks like and drops like the original block, then waits as its depleted form. */
public class NkwRegenBlock extends Block {
    private final String original;
    private final Supplier<Block> depleted;
    /** 0 break, 1 right-click, 2 hold right-click, 3 right-click and stand still */
    public final int input;
    public final int harvestTicks;
    /** harvest timer look (NkwHarvestHud) */
    public final int ui;
    /** breaking timer look, -1 = none */
    public final int breakUi;
    /** the harvest goes straight into the inventory */
    public final boolean give;
    /** players in adventure mode may pick it by hand */
    public final boolean adventure;
    /** item given instead of the original's drops (null: the original's drops), with its count */
    private final String drop;
    private final int dropMin;
    private final int dropMax;
    private BlockState originalState;

    public NkwRegenBlock(BlockBehaviour.Properties properties, String original, Supplier<Block> depleted, int input, int harvestTicks, int ui, int breakUi, boolean give, boolean adventure, String drop, int dropMin, int dropMax) {
        super(properties);
        this.original = original;
        this.depleted = depleted;
        this.input = input;
        this.harvestTicks = harvestTicks;
        this.ui = ui;
        this.breakUi = breakUi;
        this.give = give;
        this.adventure = adventure;
        this.drop = drop;
        this.dropMin = dropMin;
        this.dropMax = dropMax;
    }

    /** The block this one stands for (stone when it is not in the game). */
    public BlockState original() {
        if (originalState == null) {
            Block block = ${reg}.${lookup}(${rl('original')});
            originalState = (block == null || block == Blocks.AIR ? Blocks.STONE : block).defaultBlockState();
        }
        return originalState;
    }

    /** Mined by a player (survival): the harvest. Creative players just remove it. */
    @Override
    public void playerDestroy(Level level, Player player, BlockPos pos, BlockState state, BlockEntity blockEntity, ItemStack tool) {
        harvest(level, pos, player, tool, true);
    }

    /**
     * The original block's drops for this player and tool (fortune, silk touch …), then the depleted block.
     * needsTool: like mining the original (e.g. iron ore needs a stone pickaxe or better to drop anything).
     */
    public void harvest(Level level, BlockPos pos, Player player, ItemStack tool, boolean needsTool) {
        if (!(level instanceof ServerLevel)) return;
        BlockState from = original();
        if (!needsTool || player.hasCorrectToolForDrops(from)) {
            List<ItemStack> drops = drop != null ? dropInstead(level) : Block.getDrops(from, (ServerLevel) level, pos, null, player, tool);
            for (ItemStack stack : drops) {
                if (stack.isEmpty()) continue;
                if (give) {
                    if (!player.addItem(stack) && !stack.isEmpty()) player.drop(stack, false);
                } else Block.popResource(level, pos, stack);
            }
        }
        if (!needsTool) level.levelEvent(2001, pos, Block.getId(from));
        level.setBlock(pos, depleted.get().defaultBlockState(), 3);
    }

    /** The "Drops instead" item with a count between min and max. */
    private List<ItemStack> dropInstead(Level level) {
        Item item = ${regItems}.${lookup}(${rl('drop')});
        int count = dropMin + (dropMax > dropMin ? level.getRandom().nextInt(dropMax - dropMin + 1) : 0);
        return Collections.singletonList(new ItemStack(item, count));
    }${push(j)}
}`)
    )
  }

  // ── the depleted form ──
  {
    const j = new JavaFile(pkg, 'NkwDepletedBlock').use(
      MC.Block,
      MC.BlockBehaviour,
      MC.BlockState,
      MC.BlockPos,
      MC.Level,
      MC.ServerLevel,
      'java.util.function.Supplier'
    )
    const random = p.mc === '1.16.5' || p.mc === '1.18.2' ? (j.use('java.util.Random'), 'Random') : (j.use('net.minecraft.util.RandomSource'), 'RandomSource')
    const schedule = p.mc === '1.16.5' ? 'level.getBlockTicks().scheduleTick(pos, this, ticks)' : 'level.scheduleTick(pos, this, ticks)'
    out(
      'NkwDepletedBlock',
      j.render(`
/** A harvested Regenerating Blocks block: cannot be broken, turns back after a while. */
public class NkwDepletedBlock extends Block {
    private final Supplier<Block> restore;
    private final int ticks;

    public NkwDepletedBlock(BlockBehaviour.Properties properties, Supplier<Block> restore, int ticks) {
        super(properties);
        this.restore = restore;
        this.ticks = ticks;
    }

    @Override
    public void onPlace(BlockState state, Level level, BlockPos pos, BlockState oldState, boolean moved) {
        super.onPlace(state, level, pos, oldState, moved);
        if (!level.isClientSide) ${schedule};
    }

    @Override
    public void tick(BlockState state, ServerLevel level, BlockPos pos, ${random} random) {
        level.setBlock(pos, restore.get().defaultBlockState(), 3);
    }${push(j)}
}`)
    )
  }

  // ── the item: only operators can place it ──
  {
    const j = new JavaFile(pkg, 'NkwRegenBlockItem').use(
      MC.Block,
      MC.BlockItem,
      MC.Item,
      MC.ItemStack,
      MC.Player,
      MC.BlockPlaceContext,
      MC.InteractionResult,
      MC.Component,
      'net.minecraft.ChatFormatting',
      trImport
    )
    out(
      'NkwRegenBlockItem',
      j.render(`
/** Places a Regenerating Blocks block: operators (permission level 2+) only. Named after the original block. */
public class NkwRegenBlockItem extends BlockItem {
    public NkwRegenBlockItem(Block block, Item.Properties properties) {
        super(block, properties);
    }

    @Override
    public InteractionResult place(BlockPlaceContext context) {
        Player player = context.getPlayer();
        if (player == null || !player.hasPermissions(2)) {
            if (player != null && !context.getLevel().isClientSide)
                player.displayClientMessage(${tr(`message.${ns}.regen_op`)}.withStyle(ChatFormatting.RED), true);
            return InteractionResult.FAIL;
        }
        return super.place(context);
    }

    @Override
    public Component getName(ItemStack stack) {
        return ${tr(`item.${ns}.regen_name`, ', ((NkwRegenBlock) getBlock()).original().getBlock().getName()')};
    }
}`)
    )
  }
}
