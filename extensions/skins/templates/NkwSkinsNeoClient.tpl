{{#import "com.mojang.blaze3d.platform.InputConstants"}}
{{#import "net.minecraft.client.KeyMapping"}}
{{#import "net.neoforged.bus.api.IEventBus"}}
{{#import "net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent"}}
{{#import "net.neoforged.neoforge.common.NeoForge"}}
{{#era "1.20.4"}}
{{#import "net.neoforged.neoforge.event.TickEvent"}}
{{#else}}
{{#import "net.neoforged.neoforge.client.event.ClientTickEvent"}}
{{/era}}
/** The key that opens the wardrobe (NeoForge). */
public final class NkwSkinsNeoClient {
    private static KeyMapping key;

    private NkwSkinsNeoClient() {}

    public static void init(IEventBus modBus) {
{{#if ext.wardrobes[0].keyEnabled}}
        key = new KeyMapping("key.{{ modId }}.wardrobe", InputConstants.Type.KEYSYM, (int) '{{ ext.wardrobes[0].key }}', "key.categories.misc");
        modBus.addListener(NkwSkinsNeoClient::onKeys);
        NeoForge.EVENT_BUS.addListener(NkwSkinsNeoClient::onTick);
{{/if}}
    }

    private static void onKeys(RegisterKeyMappingsEvent event) {
        event.register(key);
    }

{{#era "1.20.4"}}
    private static void onTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        while (key.consumeClick()) NkwSkinsClient.open();
    }
{{#else}}
    private static void onTick(ClientTickEvent.Post event) {
        while (key.consumeClick()) NkwSkinsClient.open();
    }
{{/era}}
}
