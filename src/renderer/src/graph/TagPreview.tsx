import { useMemo } from 'react'
import type { VanillaData, VanillaItem } from '@core/vanilla'
import { L } from '../i18n'
import { vanillaIconUrl } from '../api'
import { prettyId as pretty, useActiveMc, useItemSources } from './VanillaPanel'

export interface TagEntry {
  /** namespaced item id */
  id: string
  /** the item in the loaded data (null: a mod that is not linked, or not loaded) */
  item: VanillaItem | null
  /** icon source (minecraft, farmersdelight, mod:<id>) */
  ns: string
}

/** Every item of an item tag (nested #tags followed) from the game, Farmer's Delight and linked mods of the active version. */
function useTagItems(tagId: string): { items: TagEntry[]; found: boolean; mc: string; loaded: boolean } {
  const mc = useActiveMc()
  const sources = useItemSources(mc)
  const id = tagId.replace(/^#/, '')
  const items = useMemo(() => resolveTag(id, sources), [id, sources])
  return { ...items, mc, loaded: sources.some((x) => x.source === 'minecraft') }
}

function resolveTag(id: string, sources: { data: VanillaData; source: string }[]): { items: TagEntry[]; found: boolean } {
  const tags = new Map<string, string[]>()
  for (const { data } of sources) for (const tg of data.tags) tags.set(tg.id, [...(tags.get(tg.id) ?? []), ...tg.values])
  const out: TagEntry[] = []
  const seen = new Set<string>()
  const visit = (tag: string, depth: number) => {
    if (depth > 8) return
    for (const v of tags.get(tag) ?? []) {
      if (v.startsWith('#')) {
        visit(v.slice(1), depth + 1)
        continue
      }
      if (seen.has(v)) continue
      seen.add(v)
      const [ns, path] = v.includes(':') ? v.split(':') : ['minecraft', v]
      const src = sources.find((s) => s.data.ns === ns)
      out.push({ id: `${ns}:${path}`, ns: src?.source ?? ns, item: src?.data.items.find((i) => i.id === path) ?? null })
    }
  }
  visit(id, 0)
  return { items: out, found: tags.has(id) }
}

const nameOf = (e: TagEntry) => (e.item ? L({ en: e.item.en, th: e.item.th || e.item.en }) : pretty(e.id))

function Cell({ e, mc, small }: { e: TagEntry; mc: string; small?: boolean }) {
  return (
    <span className={small ? 'tag-cell small' : 'tag-cell'} title={`${nameOf(e)}\n${e.id}`}>
      {e.item?.icon ? (
        <img className="pixel frame0" src={vanillaIconUrl(mc, e.item.id, e.ns)} alt={nameOf(e)} draggable={false} />
      ) : (
        <span className="cg-letter">{nameOf(e).slice(0, 2)}</span>
      )}
    </span>
  )
}

/** Example items of a tag as a grid of icons; hovering an icon shows the item's name. */
export function TagGrid({ tagId }: { tagId: string }) {
  const { items, found, mc, loaded } = useTagItems(tagId)
  const tr = (en: string, th: string) => L({ en, th })
  if (!loaded) return null
  if (!found)
    return (
      <span className="hint">{tr('This tag is not in the game data: it may come from another mod.', 'ไม่พบแท็กนี้ในข้อมูลเกม: อาจเป็นแท็กของม็อดอื่น')}</span>
    )
  return (
    <div className="tag-preview">
      <span className="faint">
        {tr(`${items.length} items in this tag (hover an icon for its name)`, `ไอเทมในแท็กนี้ ${items.length} อย่าง (ชี้ที่รูปเพื่อดูชื่อ)`)}
      </span>
      <div className="tag-grid">
        {items.map((e) => (
          <Cell key={e.id} e={e} mc={mc} />
        ))}
      </div>
    </div>
  )
}

/** A few icons of a tag for the node on the canvas. */
export function TagStrip({ tagId, max = 6 }: { tagId: string; max?: number }) {
  const { items, mc } = useTagItems(tagId)
  if (!items.length) return null
  return (
    <span className="tag-strip">
      {items.slice(0, max).map((e) => (
        <Cell key={e.id} e={e} mc={mc} small />
      ))}
      {items.length > max && <span className="faint">+{items.length - max}</span>}
    </span>
  )
}
