{{#import "net.minecraft.network.syncher.EntityDataAccessor"}}
{{#import "net.minecraft.network.syncher.EntityDataSerializers"}}
{{#import "net.minecraft.network.syncher.SynchedEntityData"}}
{{#import "net.minecraft.resources.ResourceLocation"}}
{{#import "net.minecraft.world.entity.player.Player"}}
/** The skins of this mod, and the data that tells every client which skin a player wears (and whether the mouth is open). */
public final class NkwSkins {
    public static final class Skin {
        public final String id;
        public final String name;
        public final String nameTh;
        public final ResourceLocation texture;
        /** shown while the player speaks (null: this skin has no mouth-open picture) */
        public final ResourceLocation open;
        public final boolean slim;

        Skin(String id, String name, String nameTh, ResourceLocation texture, ResourceLocation open, boolean slim) {
            this.id = id;
            this.name = name;
            this.nameTh = nameTh;
            this.texture = texture;
            this.open = open;
            this.slim = slim;
        }
    }

    public static final Skin[] ALL = {
{{#each ext.skins as s}}
        new Skin({{ s.id | quote }}, {{ s.name | quote }}, {{ s.nameTh | quote }}, NkwMod.id("textures/skins/{{ s.id }}.png"), {{#if s.openFile != ''}}NkwMod.id("textures/skins/{{ s.id }}_open.png"){{#else}}null{{/if}}, {{ s.slim }}){{#if !loop.last}},{{/if}}
{{/each}}
    };

    /** the skin id a player wears ("" = their own skin), shared with every client by the game's entity data */
    public static final EntityDataAccessor<String> SKIN = SynchedEntityData.defineId(Player.class, EntityDataSerializers.STRING);
    /** the mouth of the player's skin is open */
    public static final EntityDataAccessor<Boolean> MOUTH = SynchedEntityData.defineId(Player.class, EntityDataSerializers.BOOLEAN);

    private NkwSkins() {}

    /** Loads this class early so the data above exists before the first player does. */
    public static void init() {}

    public static Skin find(String id) {
        for (Skin s : ALL) if (s.id.equals(id)) return s;
        return null;
    }

    /** The skin a player wears, or null. */
    public static Skin of(Player player) {
        String id = player.getEntityData().get(SKIN);
        return id.isEmpty() ? null : find(id);
    }
}
