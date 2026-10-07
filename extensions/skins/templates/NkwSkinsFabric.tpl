{{#import "net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback"}}
{{#import "net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents"}}
{{#import "net.fabricmc.fabric.api.message.v1.ServerMessageEvents"}}
{{#import "net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents"}}
/** Hooks the skins into Fabric / Quilt: the command, joining players, chat and the server tick. */
public final class NkwSkinsFabric {
    private NkwSkinsFabric() {}

    public static void init() {
        NkwSkins.init();
        CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> NkwSkinCommands.register(dispatcher));
        ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> NkwSkinCommands.onJoin(handler.player));
        ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> NkwSkinCommands.talk(sender));
        ServerTickEvents.END_SERVER_TICK.register(NkwSkinCommands::tick);
    }
}
