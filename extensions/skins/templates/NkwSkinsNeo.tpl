{{#import "net.minecraft.server.level.ServerPlayer"}}
{{#import "net.neoforged.neoforge.common.NeoForge"}}
{{#import "net.neoforged.neoforge.event.RegisterCommandsEvent"}}
{{#import "net.neoforged.neoforge.event.ServerChatEvent"}}
{{#import "net.neoforged.neoforge.event.entity.player.PlayerEvent"}}
{{#era "1.20.4"}}
{{#import "net.neoforged.neoforge.event.TickEvent"}}
{{#else}}
{{#import "net.neoforged.neoforge.event.tick.ServerTickEvent"}}
{{/era}}
/** Hooks the skins into NeoForge: the command, joining players, chat and the server tick. */
public final class NkwSkinsNeo {
    private NkwSkinsNeo() {}

    public static void init() {
        NkwSkins.init();
        NeoForge.EVENT_BUS.addListener(NkwSkinsNeo::onCommands);
        NeoForge.EVENT_BUS.addListener(NkwSkinsNeo::onJoin);
        NeoForge.EVENT_BUS.addListener(NkwSkinsNeo::onChat);
        NeoForge.EVENT_BUS.addListener(NkwSkinsNeo::onTick);
    }

    private static void onCommands(RegisterCommandsEvent event) {
        NkwSkinCommands.register(event.getDispatcher());
    }

    private static void onJoin(PlayerEvent.PlayerLoggedInEvent event) {
        if (event.getEntity() instanceof ServerPlayer player) NkwSkinCommands.onJoin(player);
    }

    private static void onChat(ServerChatEvent event) {
        NkwSkinCommands.talk(event.getPlayer());
    }

{{#era "1.20.4"}}
    private static void onTick(TickEvent.ServerTickEvent event) {
        if (event.phase == TickEvent.Phase.END) NkwSkinCommands.tick(event.getServer());
    }
{{#else}}
    private static void onTick(ServerTickEvent.Post event) {
        NkwSkinCommands.tick(event.getServer());
    }
{{/era}}
}
