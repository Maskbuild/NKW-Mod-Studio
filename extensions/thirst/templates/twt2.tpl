{
  "values": {
{{#each ext.drinks as d}}
    "{{ modId }}:{{ d.id }}": {
      "thirst": {{ d.thirst }},
      "quenched": {{ d.hydration }}
    }{{#if !loop.last}},{{/if}}
{{/each}}
  }
}
