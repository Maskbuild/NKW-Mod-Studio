{{#import "com.mojang.blaze3d.platform.InputConstants"}}
{{#import "net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents"}}
{{#import "net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper"}}
{{#import "net.minecraft.client.KeyMapping"}}
/** The key that opens the wardrobe (Fabric / Quilt). */
public final class NkwSkinsFabricClient {
    private NkwSkinsFabricClient() {}

    public static void init() {
{{#if ext.wardrobes[0].keyEnabled}}
        KeyMapping key = KeyBindingHelper.registerKeyBinding(new KeyMapping("key.{{ modId }}.wardrobe", InputConstants.Type.KEYSYM, (int) '{{ ext.wardrobes[0].key }}', "key.categories.misc"));
        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (key.consumeClick()) NkwSkinsClient.open();
        });
{{/if}}
    }
}
