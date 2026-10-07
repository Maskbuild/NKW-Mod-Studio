{{#import "java.lang.reflect.Method"}}
{{#import "java.util.UUID"}}
{{#import "net.minecraft.client.Minecraft"}}
{{#import "net.minecraft.client.player.AbstractClientPlayer"}}
{{#import "net.minecraft.resources.ResourceLocation"}}
/** Client side of the skins: which picture a player is drawn with, and the wardrobe window. */
public final class NkwSkinsClient {
    private static Method figura;
    private static boolean figuraChecked;

    private NkwSkinsClient() {}

    /** The picture to draw this player with, or null to keep their own skin. */
    public static ResourceLocation textureFor(AbstractClientPlayer player) {
        NkwSkins.Skin skin = NkwSkins.of(player);
        if (skin == null) return null;
{{#if ext.wardrobes[0].yieldFigura}}
        if (figuraAvatar(player.getUUID())) return null;
{{/if}}
        return skin.open != null && player.getEntityData().get(NkwSkins.MOUTH) ? skin.open : skin.texture;
    }

    /** Figura (when installed) draws its own avatar: then the skin stays out of the way. */
    private static boolean figuraAvatar(UUID id) {
        try {
            if (!figuraChecked) {
                figuraChecked = true;
                figura = Class.forName("org.figuramc.figura.avatar.AvatarManager").getMethod("getAvatarForPlayer", UUID.class);
            }
            return figura != null && figura.invoke(null, id) != null;
        } catch (ReflectiveOperationException | LinkageError e) {
            figura = null;
            return false;
        }
    }

    /** Opens the wardrobe window. */
    public static void open() {
        Minecraft.getInstance().setScreen(new NkwWardrobeScreen());
    }

    /** The skin id the local player wears ("" = none). */
    public static String current() {
        Minecraft mc = Minecraft.getInstance();
        return mc.player == null ? "" : mc.player.getEntityData().get(NkwSkins.SKIN);
    }

    /** Asks the server to give the local player this skin ("" = their own). */
    public static void choose(String id) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.getConnection() != null) mc.getConnection().sendCommand("{{ modId }}_skin " + (id.isEmpty() ? "clear" : "set " + id));
    }
}
