{{#import "net.minecraft.world.item.Item"}}
{{#import "java.lang.reflect.Method"}}
{{#import "java.util.function.Consumer"}}
{{#if loader == 'neoforge'}}
{{#import "net.neoforged.fml.ModList"}}
{{#import "net.neoforged.bus.api.EventPriority"}}
{{#import "net.neoforged.neoforge.common.NeoForge"}}
{{#else}}
{{#import "net.minecraftforge.fml.ModList"}}
{{#import "net.minecraftforge.eventbus.api.EventPriority"}}
{{#import "net.minecraftforge.common.MinecraftForge"}}
{{/if}}
/** Thirst values for Thirst Was Taken, used only when it is installed. */
public final class NkwThirst {
    private NkwThirst() {}

    @SuppressWarnings({"unchecked", "rawtypes"})
    public static void init() {
        if (!ModList.get().isLoaded("thirst")) return;
        try {
            Class event = Class.forName("dev.ghen.thirst.foundation.common.event.RegisterThirstValueEvent");
            {{ forge.bus }}.addListener(EventPriority.NORMAL, false, event, (Consumer) NkwThirst::register);
        } catch (ReflectiveOperationException | LinkageError e) {
            NkwMod.LOGGER.warn("[NKW] Thirst Was Taken support is off: {}", e.toString());
        }
    }

    private static void register(Object event) {
        try {
            Method drink = event.getClass().getMethod("addDrink", Item.class, int.class, int.class);
            Method food = event.getClass().getMethod("addFood", Item.class, int.class, int.class);
{{#each ext.drinks as d}}
            {{ d.drink ? 'drink' : 'food' }}.invoke(event, {{ reg('ModItems', d.id) }}, {{ d.thirst }}, {{ d.hydration }});
{{/each}}
            NkwMod.LOGGER.info("[NKW] thirst values added for {{ len(ext.drinks) }} item(s) (Thirst Was Taken)");
        } catch (ReflectiveOperationException e) {
            NkwMod.LOGGER.warn("[NKW] Could not add thirst values: {}", e.toString());
        }
    }
}
