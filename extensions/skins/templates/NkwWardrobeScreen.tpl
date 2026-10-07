{{#import "net.minecraft.client.gui.GuiGraphics"}}
{{#import "net.minecraft.client.gui.components.Button"}}
{{#import "net.minecraft.client.gui.screens.Screen"}}
{{#import "net.minecraft.network.chat.Component"}}
/** The wardrobe: a list of the skins of the mod. Click one to wear it (everyone on the server sees it). */
public class NkwWardrobeScreen extends Screen {
    private static final int ROW = 22;
    private int page;

    public NkwWardrobeScreen() {
        super(Component.translatable("gui.{{ modId }}.wardrobe"));
    }

    @Override
    protected void init() {
        int perPage = Math.max(1, (this.height - 96) / ROW);
        int pages = (NkwSkins.ALL.length + perPage - 1) / perPage;
        if (page >= pages) page = Math.max(0, pages - 1);
        int width = 200;
        int x = (this.width - width) / 2;
        int from = page * perPage;
        String current = NkwSkinsClient.current();
        for (int i = from; i < Math.min(NkwSkins.ALL.length, from + perPage); i++) {
            NkwSkins.Skin skin = NkwSkins.ALL[i];
            Component name = Component.translatable("skin.{{ modId }}." + skin.id);
            Component label = skin.id.equals(current) ? Component.literal("> ").append(name) : name;
            this.addRenderableWidget(Button.builder(label, b -> {
                NkwSkinsClient.choose(skin.id);
                this.onClose();
            }).bounds(x, 36 + (i - from) * ROW, width, 20).build());
        }
        int y = this.height - 52;
        if (pages > 1) {
            this.addRenderableWidget(Button.builder(Component.translatable("gui.{{ modId }}.wardrobe.prev"), b -> {
                page = Math.max(0, page - 1);
                this.rebuildWidgets();
            }).bounds(x, y, 98, 20).build());
            this.addRenderableWidget(Button.builder(Component.translatable("gui.{{ modId }}.wardrobe.next"), b -> {
                page = Math.min(pages - 1, page + 1);
                this.rebuildWidgets();
            }).bounds(x + 102, y, 98, 20).build());
        }
        this.addRenderableWidget(Button.builder(Component.translatable("gui.{{ modId }}.wardrobe.reset"), b -> {
            NkwSkinsClient.choose("");
            this.onClose();
        }).bounds(x, y + 24, 98, 20).build());
        this.addRenderableWidget(Button.builder(Component.translatable("gui.{{ modId }}.wardrobe.close"), b -> this.onClose()).bounds(x + 102, y + 24, 98, 20).build());
    }

    @Override
    public void render(GuiGraphics graphics, int mouseX, int mouseY, float delta) {
        graphics.fill(0, 0, this.width, this.height, 0xB0000000);
        graphics.drawCenteredString(this.font, this.title, this.width / 2, 14, 0xFFFFFF);
        super.render(graphics, mouseX, mouseY, delta);
    }
}
