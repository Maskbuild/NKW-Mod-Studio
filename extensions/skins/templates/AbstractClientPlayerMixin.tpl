{{#import "net.minecraft.client.player.AbstractClientPlayer"}}
{{#import "org.spongepowered.asm.mixin.Mixin"}}
{{#import "org.spongepowered.asm.mixin.injection.At"}}
{{#import "org.spongepowered.asm.mixin.injection.Inject"}}
{{#import "org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable"}}
{{#era "1.20.1"}}
{{#import "net.minecraft.resources.ResourceLocation"}}
{{#else}}
{{#import "net.minecraft.client.resources.PlayerSkin"}}
{{/era}}
/** Shows the chosen skin on the player (body and, in first person, the arm). */
@Mixin(AbstractClientPlayer.class)
public abstract class AbstractClientPlayerMixin {
{{#era "1.20.1"}}
    @Inject(method = "getSkinTextureLocation", at = @At("RETURN"), cancellable = true)
    private void nkw$skin(CallbackInfoReturnable<ResourceLocation> cir) {
        ResourceLocation texture = {{ pkg }}.NkwSkinsClient.textureFor((AbstractClientPlayer) (Object) this);
        if (texture != null) cir.setReturnValue(texture);
    }
{{#else}}
    @Inject(method = "getSkin", at = @At("RETURN"), cancellable = true)
    private void nkw$skin(CallbackInfoReturnable<PlayerSkin> cir) {
        net.minecraft.resources.ResourceLocation texture = {{ pkg }}.NkwSkinsClient.textureFor((AbstractClientPlayer) (Object) this);
        if (texture == null) return;
        PlayerSkin old = cir.getReturnValue();
        cir.setReturnValue(new PlayerSkin(texture, old.textureUrl(), old.capeTexture(), old.elytraTexture(), old.model(), old.secure()));
    }
{{/era}}
}
