/** Writes the greetings of the Greeting nodes to the game log. */
public final class MyGreetings {
    private MyGreetings() {}

    public static void init() {
{{#each ext.greetings as g}}
        for (int i = 0; i < {{ g.times }}; i++) NkwMod.LOGGER.info({{ g.text | quote }});
{{/each}}
    }
}
