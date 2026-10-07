{{#import "com.mojang.brigadier.CommandDispatcher"}}
{{#import "com.mojang.brigadier.arguments.BoolArgumentType"}}
{{#import "com.mojang.brigadier.arguments.StringArgumentType"}}
{{#import "java.io.IOException"}}
{{#import "java.nio.charset.StandardCharsets"}}
{{#import "java.nio.file.Files"}}
{{#import "java.nio.file.Path"}}
{{#import "java.util.ArrayList"}}
{{#import "java.util.HashMap"}}
{{#import "java.util.Iterator"}}
{{#import "java.util.List"}}
{{#import "java.util.Map"}}
{{#import "java.util.UUID"}}
{{#import "net.minecraft.commands.CommandSourceStack"}}
{{#import "net.minecraft.commands.Commands"}}
{{#import "net.minecraft.network.chat.Component"}}
{{#import "net.minecraft.server.MinecraftServer"}}
{{#import "net.minecraft.server.level.ServerPlayer"}}
{{#import "net.minecraft.world.level.storage.LevelResource"}}
/**
 * The server side of the skins: the command players (and the wardrobe window) use to choose a skin, the world file that
 * remembers each player's choice, and the mouth of the skin. The choice is stored in the player's entity data, which the
 * game sends to everybody who can see the player.
 */
public final class NkwSkinCommands {
    private static final Map<UUID, String> SAVED = new HashMap<>();
    /** players whose mouth is open because they wrote in chat: game tick when it closes */
    private static final Map<UUID, Integer> TALKING = new HashMap<>();
    private static MinecraftServer loadedFor;

    private NkwSkinCommands() {}

    private static Path file(MinecraftServer server) {
        return server.getWorldPath(LevelResource.ROOT).resolve("{{ modId }}_skins.txt");
    }

    /** Reads the saved choices when the server (world) changes. */
    private static void load(MinecraftServer server) {
        if (loadedFor == server) return;
        loadedFor = server;
        SAVED.clear();
        TALKING.clear();
        Path path = file(server);
        if (!Files.isRegularFile(path)) return;
        try {
            for (String line : Files.readAllLines(path, StandardCharsets.UTF_8)) {
                int eq = line.indexOf('=');
                if (eq <= 0) continue;
                try {
                    SAVED.put(UUID.fromString(line.substring(0, eq).trim()), line.substring(eq + 1).trim());
                } catch (IllegalArgumentException ignored) {
                    // a damaged line is skipped
                }
            }
        } catch (IOException e) {
            NkwMod.LOGGER.warn("[NKW] Could not read the saved skins: {}", e.toString());
        }
    }

    private static void save(MinecraftServer server) {
        List<String> lines = new ArrayList<>();
        for (Map.Entry<UUID, String> e : SAVED.entrySet()) lines.add(e.getKey() + "=" + e.getValue());
        try {
            Files.write(file(server), lines, StandardCharsets.UTF_8);
        } catch (IOException e) {
            NkwMod.LOGGER.warn("[NKW] Could not save the skins: {}", e.toString());
        }
    }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("{{ modId }}_skin")
            .then(Commands.literal("set").then(Commands.argument("id", StringArgumentType.word())
                .executes(c -> choose(c.getSource(), StringArgumentType.getString(c, "id")))))
            .then(Commands.literal("clear").executes(c -> choose(c.getSource(), "")))
            .then(Commands.literal("list").executes(c -> {
                StringBuilder sb = new StringBuilder();
                for (NkwSkins.Skin s : NkwSkins.ALL) sb.append(sb.length() == 0 ? "" : ", ").append(s.id);
                c.getSource().sendSuccess(() -> Component.literal(sb.toString()), false);
                return 1;
            }))
            .then(Commands.literal("mouth").then(Commands.argument("open", BoolArgumentType.bool())
                .executes(c -> {
                    ServerPlayer player = c.getSource().getPlayerOrException();
                    setSpeaking(player, BoolArgumentType.getBool(c, "open"));
                    return 1;
                }))));
    }

    private static int choose(CommandSourceStack source, String id) throws com.mojang.brigadier.exceptions.CommandSyntaxException {
        ServerPlayer player = source.getPlayerOrException();
        if (!id.isEmpty() && NkwSkins.find(id) == null) {
            source.sendFailure(Component.literal("Unknown skin: " + id));
            return 0;
        }
        MinecraftServer server = source.getServer();
        load(server);
        player.getEntityData().set(NkwSkins.SKIN, id);
        if (id.isEmpty()) SAVED.remove(player.getUUID());
        else SAVED.put(player.getUUID(), id);
        save(server);
        return 1;
    }

    /** A player came in: wear the skin they chose last time. */
    public static void onJoin(ServerPlayer player) {
        MinecraftServer server = player.getServer();
        if (server == null) return;
        load(server);
        String id = SAVED.get(player.getUUID());
        if (id != null && NkwSkins.find(id) != null) player.getEntityData().set(NkwSkins.SKIN, id);
    }

    /**
     * Opens or closes the mouth of a player's skin. Voice chat mods (and anything else) can call this: it is what moves the
     * mouth while a player speaks.
     */
    public static void setSpeaking(ServerPlayer player, boolean speaking) {
        if (player.getEntityData().get(NkwSkins.MOUTH) != speaking) player.getEntityData().set(NkwSkins.MOUTH, speaking);
    }

    /** The player wrote in chat: the mouth moves for two seconds. */
    public static void talk(ServerPlayer player) {
{{#if ext.wardrobes[0].speaking}}
        MinecraftServer server = player.getServer();
        if (server == null) return;
        TALKING.put(player.getUUID(), server.getTickCount() + 40);
        setSpeaking(player, true);
{{/if}}
    }

    /** Every server tick: closes the mouths of players who stopped talking. */
    public static void tick(MinecraftServer server) {
        if (TALKING.isEmpty()) return;
        Iterator<Map.Entry<UUID, Integer>> it = TALKING.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<UUID, Integer> e = it.next();
            if (server.getTickCount() < e.getValue()) continue;
            it.remove();
            ServerPlayer player = server.getPlayerList().getPlayer(e.getKey());
            if (player != null) setSpeaking(player, false);
        }
    }
}
