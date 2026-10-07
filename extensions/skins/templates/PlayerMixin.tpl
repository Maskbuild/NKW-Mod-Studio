{{#import "net.minecraft.world.entity.player.Player"}}
{{#import "org.spongepowered.asm.mixin.Mixin"}}
{{#import "org.spongepowered.asm.mixin.injection.At"}}
{{#import "org.spongepowered.asm.mixin.injection.Inject"}}
{{#import "org.spongepowered.asm.mixin.injection.callback.CallbackInfo"}}
{{#era "1.21+"}}
{{#import "net.minecraft.network.syncher.SynchedEntityData"}}
{{/era}}
/** Adds the skin data to every player (the game then sends it to everyone who can see the player). */
@Mixin(Player.class)
public abstract class PlayerMixin {
{{#era "1.21+"}}
    @Inject(method = "defineSynchedData", at = @At("TAIL"))
    private void nkw$defineSkinData(SynchedEntityData.Builder builder, CallbackInfo ci) {
        builder.define({{ pkg }}.NkwSkins.SKIN, "");
        builder.define({{ pkg }}.NkwSkins.MOUTH, false);
    }
{{#else}}
    @Inject(method = "defineSynchedData", at = @At("TAIL"))
    private void nkw$defineSkinData(CallbackInfo ci) {
        Player self = (Player) (Object) this;
        self.getEntityData().define({{ pkg }}.NkwSkins.SKIN, "");
        self.getEntityData().define({{ pkg }}.NkwSkins.MOUTH, false);
    }
{{/era}}
}
