{{#import "java.lang.reflect.Field"}}
{{#import "java.util.List"}}
{{#import "net.fabricmc.loader.api.FabricLoader"}}
{{#import "net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents"}}
/** Thirst values for Thirsty, used only when it is installed. */
public final class NkwThirst {
    private NkwThirst() {}

    public static void init() {
        if (FabricLoader.getInstance().isModLoaded("thirsty")) ServerLifecycleEvents.SERVER_STARTING.register(server -> thirsty());
    }

    @SuppressWarnings("unchecked")
    private static void thirsty() {
        try {
            Class<?> config = Class.forName("net.obe107.thirsty.config.ModConfig");
            Object instance = config.getMethod("getInstance").invoke(null);
            List<Object> items = (List<Object>) config.getField("customItems").get(instance);
            // an empty list gets Thirsty's defaults first
            if (items.isEmpty()) config.getMethod("validatePostLoad").invoke(instance);
            Class<?> entry = Class.forName("net.obe107.thirsty.config.ModConfig$ItemEntry");
            Field itemId = entry.getField("itemId");
{{#each ext.drinks as d}}
            add(items, entry, itemId, "{{ modId }}:{{ d.id }}", {{ d.thirst }}, {{ d.hydration }});
{{/each}}
            config.getMethod("validatePostLoad").invoke(instance);
            NkwMod.LOGGER.info("[NKW] thirst values added for {{ len(ext.drinks) }} item(s) (Thirsty)");
        } catch (ReflectiveOperationException | LinkageError | ClassCastException e) {
            NkwMod.LOGGER.warn("[NKW] Thirsty support is off: {}", e.toString());
        }
    }

    private static void add(List<Object> items, Class<?> entry, Field itemId, String id, int thirst, int saturation) throws ReflectiveOperationException {
        for (Object o : items) if (id.equals(itemId.get(o))) return;
        items.add(entry.getConstructor(String.class, int.class, int.class).newInstance(id, thirst, saturation));
    }
}
