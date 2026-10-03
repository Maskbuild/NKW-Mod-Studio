import type { BlockIR, Ingredient, RecipeIR } from '../ir'
import { RES, json, type GenCtx } from './types'

/** Data-pack side: recipes, loot tables, tags, jukebox songs. */
export function genData(ctx: GenCtx): void {
  const { ir, ns, p, files } = ctx
  const D = `${RES}/data`
  const dir = (plural: string, singular: string) => (p.pluralDataDirs ? plural : singular)
  const recipeDir = `${D}/${ns}/${dir('recipes', 'recipe')}`
  const itemTags = dir('tags/items', 'tags/item')
  const blockTags = dir('tags/blocks', 'tags/block')

  const ing = (i: Ingredient): unknown => {
    if (p.stringIngredients) return 'item' in i ? i.item : `#${i.tag}`
    return 'item' in i ? { item: i.item } : { tag: i.tag }
  }
  const stack = (id: string, count = 1): Record<string, unknown> => {
    const s: Record<string, unknown> = p.stackId ? { id } : { item: id }
    if (count !== 1) s.count = count
    return s
  }

  for (const r of ir.recipes) {
    const body = recipeJson(ctx, r, ing, stack)
    if (body) files.push({ path: `${recipeDir}/${r.name}.json`, text: json(body) })
  }

  // ── loot tables ──
  for (const b of ir.blocks) {
    if (b.crop) {
      files.push({
        path: `${D}/${ns}/${dir('loot_tables', 'loot_table')}/blocks/${b.id}.json`,
        text: json(cropLoot(ns, b.id, b.crop, ir.items.find((i) => i.places === b.id)?.id ?? null))
      })
      continue
    }
    // a block without its own item drops whatever item places it (seeds-style), or nothing
    const placer = ir.items.find((i) => i.places === b.id)
    const drop = b.drop ?? (b.hasItem ? `${ns}:${b.id}` : placer ? `${ns}:${placer.id}` : null)
    if (!drop) {
      files.push({ path: `${D}/${ns}/${dir('loot_tables', 'loot_table')}/blocks/${b.id}.json`, text: json({ type: 'minecraft:block', pools: [] }) })
      continue
    }
    const entry: Record<string, unknown> = { type: 'minecraft:item', name: drop }
    if (b.dropMin !== 1 || b.dropMax !== 1)
      entry.functions = [
        {
          function: 'minecraft:set_count',
          count: b.dropMin === b.dropMax ? b.dropMin : { type: 'minecraft:uniform', min: b.dropMin, max: b.dropMax }
        }
      ]
    files.push({
      path: `${D}/${ns}/${dir('loot_tables', 'loot_table')}/blocks/${b.id}.json`,
      text: json({
        type: 'minecraft:block',
        pools: [{ rolls: 1, entries: [entry], conditions: [{ condition: 'minecraft:survives_explosion' }] }]
      })
    })
  }

  // ── mobs: drops, natural spawning (Forge / NeoForge biome modifiers; Fabric does it in code) ──
  for (const m of ir.mobs) {
    files.push({
      path: `${D}/${ns}/${dir('loot_tables', 'loot_table')}/entities/${m.id}.json`,
      text: json({
        type: 'minecraft:entity',
        pools: m.drops.map((id) => ({
          rolls: 1,
          entries: [
            {
              type: 'minecraft:item',
              name: id,
              functions: [{ function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: m.dropMin, max: m.dropMax } }]
            }
          ]
        }))
      })
    })
    if (!m.spawn || ctx.loader === 'fabric' || ctx.loader === 'quilt') continue
    const neo = ctx.loader === 'neoforge'
    files.push({
      path: `${D}/${ns}/${neo ? 'neoforge' : 'forge'}/biome_modifier/spawn_${m.id}.json`,
      text: json({
        type: `${neo ? 'neoforge' : 'forge'}:add_spawns`,
        biomes: `#minecraft:is_${m.spawn.where}`,
        spawners: { type: `${ns}:${m.id}`, weight: m.spawn.weight, minCount: m.spawn.min, maxCount: m.spawn.max }
      })
    })
  }

  // ── tags ──
  const tags = new Map<string, string[]>()
  const addTag = (path: string, value: string) => {
    const list = tags.get(path) ?? []
    list.push(value)
    tags.set(path, list)
  }
  if (p.mineableTags)
    for (const b of ir.blocks) {
      if (b.tool === 'none') continue
      addTag(`${D}/minecraft/${blockTags}/mineable/${b.tool}.json`, `${ns}:${b.id}`)
      if (b.toolLevel !== 'wood') addTag(`${D}/minecraft/${blockTags}/needs_${b.toolLevel}_tool.json`, `${ns}:${b.id}`)
    }
  // repair tags always exist (the Java code references them), possibly empty
  const repairTag = (kind: 'tool' | 'armor', id: string, i: Ingredient | null) => {
    const path = `${D}/${ns}/${itemTags}/repair/${kind}/${id}.json`
    tags.set(path, tags.get(path) ?? [])
    if (i) addTag(path, 'item' in i ? i.item : `#${i.tag}`)
  }
  for (const m of ir.toolMats) repairTag('tool', m.id, m.repair)
  for (const m of ir.armorMats) repairTag('armor', m.id, m.repair)
  if (!p.jukeboxSongs) for (const it of ir.items) if (it.disc) addTag(`${D}/minecraft/${itemTags}/music_discs.json`, `${ns}:${it.id}`)

  // ── thirst mods (Thirst add-on): data files the mods read when installed, ignored otherwise ──
  const drinks = ir.items.filter((it) => it.food?.thirst)
  const twt2: Record<string, { thirst: number; quenched: number }> = {}
  for (const it of drinks) {
    const w = it.food!.thirst!
    // Tough As Nails: thirst tags 1–20, hydration tags 10–100 (%)
    addTag(`${D}/toughasnails/${itemTags}/thirst/${w.thirst}_thirst_drinks.json`, `${ns}:${it.id}`)
    if (w.hydration > 0) addTag(`${D}/toughasnails/${itemTags}/hydration/${tanHydration(w.hydration)}_hydration_drinks.json`, `${ns}:${it.id}`)
    // Legendary Survival Overhaul: one file per item
    files.push({
      path: `${D}/${ns}/legendarysurvivaloverhaul/thirst/consumables/${it.id}.json`,
      text: json([{ effects: [], hydration: w.thirst, properties: {}, saturation: w.hydration }])
    })
    twt2[`${ns}:${it.id}`] = { thirst: w.thirst, quenched: w.hydration }
  }
  // Thirst Was Taken 2
  if (drinks.length) files.push({ path: `${D}/${ns}/thirstwastaken2/drinks/${ns}.json`, text: json({ values: twt2 }) })

  for (const [path, values] of tags)
    files.push({
      path,
      text: json({
        replace: false,
        values: values.map((v) => (v.startsWith(`${ns}:`) ? v : { id: v, required: false }))
      })
    })

  // ── jukebox songs (1.21+) ──
  if (p.jukeboxSongs)
    for (const it of ir.items) {
      if (!it.disc) continue
      files.push({
        path: `${D}/${ns}/jukebox_song/${it.id}.json`,
        text: json({
          sound_event: `${ns}:${it.disc.sound}`,
          description: { translate: `jukebox_song.${ns}.${it.id}` },
          length_in_seconds: it.disc.length,
          comparator_output: it.disc.comparator
        })
      })
    }
}

const countFn = (min: number, max: number) =>
  min === max && min === 1 ? [] : [{ function: 'minecraft:set_count', count: min === max ? min : { type: 'minecraft:uniform', min, max } }]

/** Crop loot: the harvest when fully grown, seeds back when fully grown (replant crops), else one seed. */
function cropLoot(ns: string, id: string, c: NonNullable<BlockIR['crop']>, seed: string | null): unknown {
  const grown = [{ condition: 'minecraft:block_state_property', block: `${ns}:${id}`, properties: { age: '7' } }]
  const pools: unknown[] = []
  if (c.produce)
    pools.push({ rolls: 1, entries: [{ type: 'minecraft:item', name: c.produce, functions: countFn(c.produceMin, c.produceMax) }], conditions: grown })
  if (seed) {
    const children: unknown[] = []
    if (c.mode === 'replant' && c.seedMax > 0)
      children.push({ type: 'minecraft:item', name: `${ns}:${seed}`, conditions: grown, functions: countFn(c.seedMin, c.seedMax) })
    children.push({ type: 'minecraft:item', name: `${ns}:${seed}`, conditions: [{ condition: 'minecraft:inverted', term: grown[0] }] })
    pools.push({ rolls: 1, entries: [{ type: 'minecraft:alternatives', children }] })
  }
  return { type: 'minecraft:block', pools }
}

/** Tough As Nails only has hydration tags for 10, 20 … 100 %: hydration 0–20 → nearest step. */
function tanHydration(hydration: number): number {
  return Math.min(100, Math.max(10, Math.round(hydration / 2) * 10))
}

function recipeJson(ctx: GenCtx, r: RecipeIR, ing: (i: Ingredient) => unknown, stack: (id: string, count?: number) => Record<string, unknown>): unknown {
  const { p } = ctx
  switch (r.kind) {
    case 'shaped':
      return {
        type: 'minecraft:crafting_shaped',
        ...(p.builtInRegistries ? { category: 'misc' } : {}),
        pattern: r.pattern,
        key: Object.fromEntries(Object.entries(r.key).map(([k, v]) => [k, ing(v)])),
        result: { ...stack(r.result), count: r.count }
      }
    case 'shapeless':
      return {
        type: 'minecraft:crafting_shapeless',
        ...(p.builtInRegistries ? { category: 'misc' } : {}),
        ingredients: r.ingredients.map(ing),
        result: { ...stack(r.result), count: r.count }
      }
    case 'cooking':
      return {
        type: `minecraft:${r.station}`,
        ...(p.builtInRegistries ? { category: 'misc' } : {}),
        ingredient: ing(r.input),
        result: p.stackId ? { id: r.result } : r.result,
        experience: r.xp,
        cookingtime: r.time
      }
    case 'stonecutting':
      return p.stackId
        ? { type: 'minecraft:stonecutting', ingredient: ing(r.input), result: { id: r.result, count: r.count } }
        : { type: 'minecraft:stonecutting', ingredient: ing(r.input), result: r.result, count: r.count }
    case 'smithing':
      if (!p.smithingTransform) return { type: 'minecraft:smithing', base: ing(r.base), addition: ing(r.addition), result: stack(r.result) }
      return {
        type: 'minecraft:smithing_transform',
        template: ing(r.template ?? { item: 'minecraft:netherite_upgrade_smithing_template' }),
        base: ing(r.base),
        addition: ing(r.addition),
        result: stack(r.result)
      }
    case 'fdCutting': {
      if (!ctx.fd) return null
      return {
        type: 'farmersdelight:cutting',
        ingredients: [ing(r.input)],
        tool: fdTool(ctx, r.tool),
        result: r.results.map((x) => {
          const base = p.stackId ? { item: { id: x.item, count: x.count } } : { item: x.item, ...(x.count !== 1 ? { count: x.count } : {}) }
          return x.chance < 1 ? { ...base, chance: x.chance } : base
        })
      }
    }
    case 'fdCooking': {
      if (!ctx.fd) return null
      return {
        type: 'farmersdelight:cooking',
        recipe_book_tab: r.tab,
        ingredients: r.ingredients.map(ing),
        result: { ...stack(r.result), count: r.count },
        ...(r.container ? { container: stack(r.container) } : {}),
        experience: r.xp,
        cookingtime: r.time
      }
    }
  }
}

function fdTool(ctx: GenCtx, tool: string): unknown {
  const modern = ctx.p.smithingTransform // 1.20+: vanilla tool tags exist
  switch (tool) {
    case 'knife':
      return { tag: ctx.fd!.knifeTag }
    case 'shears':
      return { item: 'minecraft:shears' }
    default:
      return modern ? { tag: `minecraft:${tool}s` } : { type: 'farmersdelight:tool_action', action: `${tool}_dig` }
  }
}
