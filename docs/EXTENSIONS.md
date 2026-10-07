# Writing extensions for NKW Mod Studio

An extension adds nodes to the editor and tells the generator what those nodes add to a mod. It is **data only**: JSON files, text templates and pictures. The app never runs anything from an extension, so installing one is as safe as opening a text file; an archive that contains scripts or programs (`.js`, `.jar`, `.exe` …) is refused.

Users install extensions from a GitHub address (*Settings → Extensions*); the files are downloaded once and then used offline.

- [Layout](#layout)
- [The manifest](#the-manifest)
- [Nodes](#nodes)
- [From node to mod data (`compile`)](#from-node-to-mod-data-compile)
- [Adding to nodes of the app (`extendNodes`)](#adding-to-nodes-of-the-app-extendnodes)
- [Records from records (`derive`)](#records-from-records-derive)
- [Generating files (`generate`, `hooks`)](#generating-files-generate-hooks)
- [Templates (NKW-T)](#templates-nkw-t)
- [Expressions](#expressions)
- [Other manifest fields](#other-manifest-fields)
- [Limits](#limits)
- [Checking and publishing](#checking-and-publishing)

## Layout

```
nkw-extension.json      the manifest (required)
nodes/*.json            one node per file
templates/**/*.tpl      code and data templates
assets/**               pictures and other files
README.md, LICENSE      anything else is ignored
```

A repository can hold the extension at its root, or in a folder (`owner/repo#main:extensions/thing`). A starting point lives in `extensions/_template/`.

## The manifest

`nkw-extension.json` (every unknown field is an error):

| Field | |
|---|---|
| `schema` | always `1` |
| `id` | `a-z`, `0-9`, `-`; 3–41 characters; unique |
| `name`, `description` | `{ "en": "…", "th": "…" }` |
| `version` | `1.2.3` |
| `minApp` | the oldest app version it works with |
| `requires` | other extensions it needs: `{ "roleplay": ">=1.0.0" }` (ranges: `*`, `1.2.3`, `>=1.2.3`, `^1.2`) |
| `targets` | `{ "loaders": ["fabric", "neoforge"], "mc": "1.20.1-1.21.1" }` — what it supports; for other targets the app warns and leaves its output out. `mc` takes ranges like `1.20.1+`, `-1.19.2`, `1.16.5-1.18.2, 1.21+` |
| `categories` | node library groups: `{ "id": { "label": {en, th}, "color": "#rrggbb", "order": 20 } }` |
| `pinTypes` | new wire types: `{ "myType": "#rrggbb" }` (wires only join equal types, or `any`) |
| `nodes` | paths of node files |
| `extendNodes`, `derive`, `generate`, `hooks`, `mixins`, `lang`, `assetChecks`, `testMods`, `targetConfig`, `contribute` | see below |

## Nodes

`nodes/greeting.json`:

```json
{
  "type": "myGreeting",
  "category": "greetings",
  "title": { "en": "Greeting", "th": "…" },
  "description": { "en": "…", "th": "…" },
  "icon": "👋",
  "inputs":  [{ "id": "item", "label": { "en": "Item", "th": "…" }, "type": "item", "optional": true }],
  "outputs": [],
  "props": [
    { "key": "text", "label": { "en": "Text", "th": "…" }, "kind": "text", "default": "Hello" },
    { "key": "times", "label": { "en": "Times", "th": "…" }, "kind": "int", "default": 1, "min": 1, "max": 5, "showIf": "data.text != ''" }
  ],
  "compile": { "…": "see below" }
}
```

- **type**: letters and digits only; unique across the app and all extensions. **category**: one of yours, or the app's (`item`, `block`, `farm`, `armor`, `effect`, `sound`, `recipe`, `mob`, `addon`, `asset`, `util`).
- **Pins**: `id`, `label`, `type` (`item`, `block`, `texture`, `ingredient`, `model`, … or yours), `optional`, `multi` (any number of wires), `group` (pins of a group appear one at a time), `right` (drawn on the right edge). `count: 6` makes pins `id1` … `id6` labelled "Label 1" …
- **Props** (`kind`): `text`, `id`, `int`, `float`, `bool`, `select` (needs `options: [{ "value", "label" }]`), `multi`, `asset` (+ `assetKind`: `texture`, `model`, `geo`, `sound`, `animation`), `nsid`, `textarea`, `color`, `blockList`, and the app's own editors `timerUi` and `wardrobe`. Also `min`, `max`, `step`, `hint`, and `showIf`: an [expression](#expressions) over `data` (the node's settings); the setting is shown when it is true.

## From node to mod data (`compile`)

A node's `compile` copies its settings into the mod's data (`ir.ext.<id>.<slot>` — a list of records, one per node) and checks them:

```json
"compile": {
  "emit": {
    "slot": "greetings",
    "mode": "push",
    "when": "v.text != ''",
    "value": {
      "text":  { "prop": "text", "as": "string", "default": "Hello", "trim": true },
      "times": { "prop": "times", "as": "int", "min": 1, "max": 5, "default": 1 }
    }
  },
  "validate": [
    { "if": "v.text == ''", "diag": "warning", "msg": { "en": "Empty greeting", "th": "…" } },
    { "unique": "text",     "diag": "error",   "msg": { "en": "Duplicate {v.text}", "th": "…" } }
  ]
}
```

`mode: "ref"` keeps the value only for nodes that read it through a wire (it is not added to the slot). Every field of `value` is one **source**:

| Source | Gives |
|---|---|
| `{ "prop": "key", "as": …, "default": …, "min": …, "max": …, "mul": …, "values": […], "trim": true, "optional": true }` | the setting, cleaned up: `as` is `string`, `number`, `int`, `bool`, `list`, `nsid`, `nsidList`; numbers are clamped (`mul` multiplies first, e.g. seconds → ticks); `values` limits a string to a list (otherwise the default) |
| `{ "input": "pin", "required": true }` | what is wired into the pin: another extension node's record, or the id of an item/block |
| `{ "ingredient": "pin" }` | `{ "item": "…" }` or `{ "tag": "…" }` |
| `{ "texture": "pin" }` | the project texture's asset path |
| `{ "rows": { "count": 4, "required": "item", "fields": { "item": { "input": "out{i}" }, "count": { "prop": "count{i}", … } } } }` | a list from numbered pins/settings (`{i}` = 1…count); rows whose `required` field is empty are left out |
| `{ "const": value }`, `{ "nodeId": true }` | a fixed value; the node's id |
| `{ "computed": "expression" }` | an [expression](#expressions) over `prop`, `v` (fields so far), `input`, `target` (`{loader, mc}`), `cfg` (see `targetConfig`), and `i` inside `rows` |

`validate` rules run for every node: `if` (an expression over the same names) reports `diag` (`error` stops a build, `warning` does not) with `msg` — `{path}` pieces such as `{v.text}` or `{target.mc}` are filled in. `unique` reports a second node with the same value in that field.

## Adding to nodes of the app (`extendNodes`)

Adds settings and pins to a node type that exists already (the app's, or another extension's), and can collect data from every node of that type:

```json
"extendNodes": [{
  "type": "food",
  "afterInput": "hit3",
  "inputs": [{ "id": "thirst", "label": { "en": "Thirst", "th": "…" }, "type": "thirst", "optional": true }],
  "afterProp": "saturation",
  "props": [ … ],
  "compile": { "emit": { "slot": "drinks", "when": "input.thirst != null", "value": { "id": { "prop": "id" } } } }
}]
```

`afterInput` / `afterProp` choose the position. A clash with an existing setting or pin is refused. The settings are stored in the node's data with their own keys; when the extension is off they are ignored.

## Records from records (`derive`)

```json
"derive": [{ "slot": "byThirst", "from": "thirst.drinks", "where": "item.hydration > 0", "groupBy": "thirst",
             "value": { "thirst": { "item": "thirst" }, "ids": { "collect": "id" } } }]
```

Makes new records from the records of a slot (`<extension id>.<slot>`): one per record, or one per distinct `groupBy` value (then `collect` gives the list of a field of the group). Sources here: `item` (a field of the record, dotted paths allowed), `const`, `computed`, `collect`.

## Generating files (`generate`, `hooks`)

```json
"generate": [
  { "id": "classes", "when": "len(ext.greetings) > 0",
    "emit": [{ "kind": "java", "class": "MyGreetings", "template": "templates/MyGreetings.tpl" }] },
  { "id": "per-item", "each": "ext.recipes",
    "emit": [{ "kind": "json", "path": "resources/data/{{ modId }}/recipe/{{ item.name }}.json", "template": "templates/recipe.tpl" }] }
],
"hooks": [{ "site": "commonInit", "order": 90, "when": "len(ext.greetings) > 0", "line": "MyGreetings.init();" }]
```

- `when`: an expression; `each`: a list — the entry runs once per element, which is `item` in the template (`loop.index`, `loop.first`, `loop.last` too).
- `emit.kind`:
  - `java` — a class of the mod's package (`package`: `"mixin"` puts it in a sub-package). The template writes the class text; `{{#import "…"}}` lines become the import list.
  - `json` — a file; the template writes JSON in any spacing, it is checked and written in the app's usual layout.
  - `file` — a text file as written. `path` is a template; a path starting `resources/` is inside the mod's resources.
  - `copy` — copies a project file: `from` (template, a project asset path), `path` (template).
- `hooks` add a line of Java to the mod's start-up: `site` is `commonInit` (both sides), `forgeClientInit` (client only on Forge / NeoForge; the line can use `bus`), `fabricClientInit` (Fabric / Quilt client). Lines run in `order`.

## Templates (NKW-T)

A template is text with `{{ … }}` tags. It can read values, repeat over a list and choose; it cannot define anything or call anything but the helpers below.

```
{{ expr | filter | filter(arg) }}   write a value (a missing value is an error; use | default(x))
{{#if cond}} … {{#elif cond}} … {{#else}} … {{/if}}
{{#each list as item, i}} … {{#else}} (empty) … {{/each}}      loop.index / loop.first / loop.last
{{#era "1.16.5-1.18.2, 1.20+"}} … {{#else}} … {{/era}}          Minecraft version ranges
{{#import "net.minecraft.world.level.Level"}}                   a Java import (collected, deduplicated)
{{> partialName}}                                               another template of the extension
{{! comment }}                                                  nothing
```

A line that holds only a block tag disappears completely. For a literal `{{` write `{{ "{{" }}`.

**Names**: `ir` (the compiled mod), `ext` (this extension's slots: `ext.greetings`), `profile` (the version's flags: `profile.java`, `profile.stringIngredients`, `profile.stackId` …), `loader` (`fabric`, `quilt`, `forge`, `neoforge`), `mc`, `meta` (mod name, authors …), `modId`, `pkg` (Java package), `forge` (`bus`, `player`, `level` names on Forge), `paths` (data pack folders: `itemTags`, `recipes` …), `cfg` (`targetConfig` values), `item`, `loop`.

**Filters**: `upper`, `lower`, `pascal`, `camel`, `constant` (`ruby_ore` → `RUBY_ORE`), `javaStr` (inside a string literal), `quote` (a Java string literal; non-ASCII becomes `\uXXXX`), `json`, `int`, `float` (a Java float literal), `str`, `join(sep)`, `indent(n)`, `default(x)`.

**Helpers**: `any('prefix:')` (does the mod use an id with this prefix), `reg('ModItems', id)` (how Java reaches a registered object on this loader), `ing(x)` (an ingredient as JSON text for this version), `stack(id)` (an item stack without count as JSON text), plus the [expression functions](#expressions).

## Expressions

Literals (`1`, `1.5`, `'text'`, `true`, `null`, `[a, b]`), names with dots and `[index]`, `! - * / + - < <= > >= == != && ||`, `a ? b : c`, and these functions: `round floor ceil abs min max clamp(x, lo, hi) len lower upper trim startsWith endsWith contains isNull isId isNsid after(text, sep) replace(text, a, b)`; in `compile` also `unique(name)` (name, name_2, name_3 …). Version-like strings compare number by number (`mc >= '1.20.1'`). Missing values are `null`, never an error. Expressions are checked when the extension is installed.

## Other manifest fields

- `mixins`: `[{ "name": "skins", "when": "…", "common": ["PlayerMixin"], "client": ["…"], "server": [] }]` — writes `<modid>.<name>.mixins.json` and registers it with Fabric / Quilt / NeoForge. The classes come from `generate` entries with `"package": "mixin"`.
- `lang`: `[{ "when": "…", "each": "ext.skins", "key": "skin.{{ modId }}.{{ item.id }}", "en": "{{ item.name }}", "th": "…" }]` — entries of the mod's language files (`%` is escaped for you).
- `assetChecks`: `[{ "slot": "skins", "field": "file", "optional": false, "png": { "sizes": [64, 128], "square": true } }]` — before a build the project files that records name are checked (PNG, size).
- `testMods`: `[{ "when": "cfg != null", "slug": "cfg.slug" }]` — Modrinth projects added to test runs (not dependencies of the mod).
- `targetConfig`: `[{ "loaders": ["forge"], "mc": "1.20.1", "values": { "slug": "…" } }]` — per-target values, read as `cfg` (the first entry that fits; none = the extension has nothing for that target).
- `contribute`: `{ "blocks": [{ "from": "skins.stations", "value": { "id": { "item": "id" }, "side": { "item": "texture" }, "javaClass": { "const": "MyBlock" } } }] }` — blocks made through the app's own block generator (models, loot, item, tab); `javaClass` is a class you generate that extends `Block`.

## Limits

2 000 files, 100 MB unpacked, 20 MB per file; templates 300 000 characters; at most 200 nodes, 48 timer elements, and so on — an extension over a limit is refused with the reason. Forbidden file types: `.js .mjs .cjs .jar .class .exe .dll .so .dylib .bat .cmd .sh .ps1 .msi .node .wasm .lnk .scr .vbs .jsx .ts`.

## Checking and publishing

```
npx tsx scripts/ext-validate.ts extensions/my-extension     checks it like the app does
npx tsx scripts/ext-validate.ts --schema schemas/            writes JSON schemas for editor completion
```

Push the folder to GitHub and tag releases (`v1.0.0`); the app installs the latest release, or any tag, branch or commit you name.
