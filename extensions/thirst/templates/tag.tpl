{
  "replace": false,
  "values": [
{{#each item.ids as id}}
    "{{ modId }}:{{ id }}"{{#if !loop.last}},{{/if}}
{{/each}}
  ]
}
