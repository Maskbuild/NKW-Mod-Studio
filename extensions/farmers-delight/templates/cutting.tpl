{
  "type": "farmersdelight:cutting",
  "ingredients": [{{ ing(item.input) }}],
  "tool": {{#if item.tool == 'knife'}}{"tag": {{ cfg.knifeTag | quote }}}{{#elif item.tool == 'shears'}}{"item": "minecraft:shears"}{{#elif profile.smithingTransform}}{"tag": "minecraft:{{ item.tool }}s"}{{#else}}{"type": "farmersdelight:tool_action", "action": "{{ item.tool }}_dig"}{{/if}},
  "result": [{{#each item.results as x}}{{#if !loop.first}}, {{/if}}{"item": {{#if profile.stackId}}{"id": {{ x.item | quote }}, "count": {{ x.count }}}{{#else}}{{ x.item | quote }}{{/if}}{{#if !profile.stackId && x.count != 1}}, "count": {{ x.count }}{{/if}}{{#if x.chance < 1}}, "chance": {{ x.chance }}{{/if}}}{{/each}}]
}
