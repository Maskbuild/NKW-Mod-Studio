{
  "type": "farmersdelight:cooking",
  "recipe_book_tab": {{ item.tab | quote }},
  "ingredients": [{{#each item.ingredients as g}}{{#if !loop.first}}, {{/if}}{{ ing(g.v) }}{{/each}}],
  "result": {"{{ profile.stackId ? 'id' : 'item' }}": {{ item.result | quote }}, "count": {{ item.count }}}{{#if item.container != null}},
  "container": {{ stack(item.container) }}{{/if}},
  "experience": {{ item.xp }},
  "cookingtime": {{ item.time }}
}
