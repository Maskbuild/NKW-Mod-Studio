{{#import "net.minecraft.core.BlockPos"}}
{{#import "net.minecraft.world.InteractionResult"}}
{{#import "net.minecraft.world.entity.player.Player"}}
{{#import "net.minecraft.world.level.Level"}}
{{#import "net.minecraft.world.level.block.Block"}}
{{#import "net.minecraft.world.level.block.state.BlockBehaviour"}}
{{#import "net.minecraft.world.level.block.state.BlockState"}}
{{#import "net.minecraft.world.phys.BlockHitResult"}}
{{#era "1.20.1-1.20.4"}}
{{#import "net.minecraft.world.InteractionHand"}}
{{/era}}
/** The wardrobe block: right-click it to open the wardrobe window. */
public class NkwSkinStationBlock extends Block {
    public NkwSkinStationBlock(BlockBehaviour.Properties properties) {
        super(properties);
    }

{{#era "1.20.1-1.20.4"}}
    @Override
    public InteractionResult use(BlockState state, Level level, BlockPos pos, Player player, InteractionHand hand, BlockHitResult hit) {
        if (level.isClientSide) NkwSkinsClient.open();
        return InteractionResult.sidedSuccess(level.isClientSide);
    }
{{#else}}
    @Override
    protected InteractionResult useWithoutItem(BlockState state, Level level, BlockPos pos, Player player, BlockHitResult hit) {
        if (level.isClientSide) NkwSkinsClient.open();
        return InteractionResult.sidedSuccess(level.isClientSide);
    }
{{/era}}
}
