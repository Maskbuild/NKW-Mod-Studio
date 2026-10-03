import { memo, useEffect, useMemo, useState } from 'react'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { useTranslation } from 'react-i18next'
import { GROUPS, groupOf, type GroupId, type VanillaData, type VanillaItem } from '@core/vanilla'
import { PROFILES } from '@core/gen/profiles'
import { L } from '../i18n'
import { api, vanillaIconUrl, type ItemSource } from '../api'
import { useStore } from '../store'
import type { LinkedMod } from '@core/project'
import { useAddCentered } from './Library'
import { ISearch, IDownload } from '../components/Icons'

/** Minecraft version whose item data the editor shows (the active target's). */
export function useActiveMc(): string {
  return useStore((s) => s.targets[s.activeTarget]?.mc ?? '1.21.1')
}

const key = (source: ItemSource, mc: string) => `${source}@${mc}`

/** Loads cached item data for a version/source into the store (no download). */
export function useVanilla(mc: string, source: ItemSource = 'minecraft'): VanillaData | undefined {
  const k = key(source, mc)
  const data = useStore((s) => s.vanilla[k])
  useEffect(() => {
    if (data) return
    let alive = true
    void api
      .vanilla(mc, source)
      .then((d) => {
        if (alive && d) useStore.setState((s) => ({ vanilla: { ...s.vanilla, [k]: d } }))
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [mc, source, k, data])
  return data
}

/** sources already asked for (also those with nothing cached), so lists do not ask again on every render */
const requested = new Set<string>()

/**
 * Every item source of a version whose data is on this computer: the game, Farmer's Delight and the mods
 * linked to the project. `source` is what icons are looked up by.
 */
export function useItemSources(mc: string): { data: VanillaData; source: ItemSource }[] {
  const mods = useStore((s) => s.mods)
  const sources = useMemo<ItemSource[]>(() => ['minecraft', 'farmersdelight', ...mods.map((m) => `mod:${m.id}` as const)], [mods])
  const loaded = useStoreWithEqualityFn(useStore, (s) => sources.map((src) => s.vanilla[key(src, mc)]), shallow)
  useEffect(() => {
    sources.forEach((src, i) => {
      const k = key(src, mc)
      if (loaded[i] || requested.has(k)) return
      requested.add(k)
      void api
        .vanilla(mc, src)
        .then((d) => d && useStore.setState((s) => ({ vanilla: { ...s.vanilla, [k]: d } })))
        .catch(() => undefined)
    })
  }, [sources, loaded, mc])
  return useMemo(() => sources.flatMap((source, i) => (loaded[i] ? [{ data: loaded[i]!, source }] : [])), [sources, loaded])
}

/** Icon source (minecraft, farmersdelight, mod:<id>) of an item namespace in the loaded data of a version. */
export function sourceOfNs(vanilla: Record<string, VanillaData>, mc: string, ns: string): ItemSource | null {
  if (ns === 'minecraft' || ns === 'farmersdelight') return ns
  for (const [k, d] of Object.entries(vanilla)) if (k.startsWith('mod:') && k.endsWith(`@${mc}`) && d.ns === ns) return k.slice(0, -mc.length - 1) as ItemSource
  return null
}

/** "minecraft:oak_planks" → "Oak Planks": a readable name while the game item list is not loaded. */
export const prettyId = (id: string) => (id.split(':').pop() ?? id).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Looks up a namespaced item id in the loaded data of the active version (ns: the icon source, for vanillaIconUrl). */
export function useItemInfo(id: string): { item: VanillaItem; mc: string; ns: string } | undefined {
  const mc = useStore((s) => s.targets[s.activeTarget]?.mc ?? '')
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  const source = useStore((s) => sourceOfNs(s.vanilla, mc, ns))
  const item = useStore((s) => (source ? s.vanilla[key(source, mc)]?.items.find((i) => i.id === path) : undefined))
  return item && source ? { item, mc, ns: source } : undefined
}

const Tile = memo(function Tile({ it, mc, ns, icon, onAdd }: { it: VanillaItem; mc: string; ns: string; icon: ItemSource; onAdd: (id: string) => void }) {
  return (
    <div
      className="v-tile"
      draggable
      title={`${it.en}\n${ns}:${it.id}`}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/nkw-vanilla', `${ns}:${it.id}`)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onDoubleClick={() => onAdd(`${ns}:${it.id}`)}
    >
      {it.icon ? <img className="pixel frame0" src={vanillaIconUrl(mc, it.id, icon)} alt="" loading="lazy" draggable={false} /> : <div className="ph">?</div>}
      <span className="ellipsis">{it.en}</span>
    </div>
  )
})

/** Error text of an IPC call without Electron's prefix. */
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Adds mods to the project: search Modrinth, or pick .jar files / a mods folder on this computer. */
function ModPicker({ mc, onAdded, onClose }: { mc: string; onAdded: (source: ItemSource) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ slug: string; title: string; description: string; downloads: number }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const mods = useStore((s) => s.mods)
  const toast = useStore((s) => s.toast)
  const link = (add: LinkedMod[]) => {
    const now = useStore.getState().mods
    const next = [...now, ...add.filter((m) => !now.some((x) => x.id === m.id))]
    if (next.length !== now.length) useStore.getState().setMods(next)
  }
  const search = async () => {
    setBusy(true)
    try {
      setHits(await api.searchMods(q.trim(), mc))
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }
  const pick = async (folder: boolean) => {
    setBusy(true)
    try {
      const r = await api.importModJars(mc, folder)
      link(r.mods.map((m) => ({ id: m.id, title: m.title, source: 'file' as const })))
      // re-read: a .jar picked again replaces what was read before
      for (const m of r.mods) requested.delete(key(`mod:${m.id}`, mc))
      useStore.setState((s) => {
        const vanilla = { ...s.vanilla }
        for (const m of r.mods) delete vanilla[key(`mod:${m.id}`, mc)]
        return { vanilla }
      })
      if (r.errors.length) toast(r.errors.slice(0, 3).join('\n') + (r.errors.length > 3 ? `\n+${r.errors.length - 3}` : ''), true)
      if (r.mods.length) {
        toast(L({ en: `Added ${r.mods.length} mod(s)`, th: `เพิ่มแล้ว ${r.mods.length} ม็อด` }))
        onAdded(`mod:${r.mods[0].id}`)
      }
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mod-picker">
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="lib-search grow" style={{ marginBottom: 0 }}>
          <ISearch size={14} />
          <input
            className="input"
            autoFocus
            placeholder={L({ en: `Search Modrinth (Minecraft ${mc})`, th: `ค้นหาม็อดใน Modrinth (Minecraft ${mc})` })}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
        </div>
        <button className="btn" disabled={busy} onClick={() => void search()}>
          {L({ en: 'Search', th: 'ค้นหา' })}
        </button>
        <button className="btn ghost" onClick={onClose} title={L({ en: 'Close', th: 'ปิด' })}>
          ✕
        </button>
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <button className="btn grow" disabled={busy} onClick={() => void pick(false)}>
          {L({ en: 'Pick .jar files…', th: 'เลือกไฟล์ .jar…' })}
        </button>
        <button className="btn grow" disabled={busy} onClick={() => void pick(true)}>
          {L({ en: 'Pick a mods folder…', th: 'เลือกโฟลเดอร์ mods…' })}
        </button>
      </div>
      {hits && !hits.length && <p className="muted">{L({ en: 'No mods found for this version.', th: 'ไม่พบม็อดสำหรับเวอร์ชันนี้' })}</p>}
      {hits?.map((h) => {
        const linked = mods.some((m) => m.id === h.slug)
        return (
          <div key={h.slug} className="lib-item mod-hit" title={h.description}>
            <div className="grow">
              <span>{h.title}</span>
              <small className="ellipsis">{h.description}</small>
              <small className="faint">
                {h.slug} · {h.downloads.toLocaleString()} {L({ en: 'downloads', th: 'ดาวน์โหลด' })}
              </small>
            </div>
            <button
              className="btn"
              disabled={linked}
              onClick={() => {
                link([{ id: h.slug, title: h.title, source: 'modrinth' }])
                onAdded(`mod:${h.slug}`)
              }}
            >
              {linked ? L({ en: 'Added', th: 'เพิ่มแล้ว' }) : L({ en: 'Add', th: 'เพิ่ม' })}
            </button>
          </div>
        )
      })}
      <p className="faint" style={{ margin: '6px 2px' }}>
        {L({
          en: "Only the mods' item list is read (names, icons, tags, crops) for the editor; your mod does not need them to run.",
          th: 'อ่านแค่รายการไอเทมของม็อด (ชื่อ ไอคอน แท็ก พืช) มาใช้ในแอป ม็อดของเราไม่ต้องพึ่งม็อดเหล่านี้ตอนเล่น'
        })}
      </p>
    </div>
  )
}

export function VanillaPanel() {
  const { t } = useTranslation()
  const activeMc = useActiveMc()
  const [mc, setMc] = useState(activeMc)
  const [source, setSource] = useState<ItemSource>('minecraft')
  const [adding, setAdding] = useState(false)
  useEffect(() => setMc(activeMc), [activeMc])
  const mods = useStore((s) => s.mods)
  const mod = source.startsWith('mod:') ? mods.find((m) => `mod:${m.id}` === source) : undefined
  // a mod removed from the project: back to the game's items
  useEffect(() => {
    if (source.startsWith('mod:') && !mod) setSource('minecraft')
  }, [source, mod])
  const data = useVanilla(mc, source)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<GroupId | 'all' | 'tags'>('all')
  const [loading, setLoading] = useState<{ msg: string; done?: number; total?: number } | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const addCentered = useAddCentered()
  const ns = data?.ns ?? source

  useEffect(
    () =>
      api.on<{ mc: string; source: string; msg: string; done?: number; total?: number }>('vanilla:progress', (p) => {
        if (p.mc === mc && (p.source === source || p.source === 'import')) setLoading(p)
      }),
    [mc, source]
  )
  useEffect(() => setUnavailable(null), [mc, source])

  const download = async () => {
    setLoading({ msg: '…' })
    try {
      const d = await api.downloadVanilla(mc, source, mod?.title)
      if (d) useStore.setState((s) => ({ vanilla: { ...s.vanilla, [key(source, mc)]: d } }))
      else setUnavailable(mc)
    } catch (e) {
      useStore.getState().toast(errText(e), true)
    } finally {
      setLoading(null)
    }
  }
  const unlink = () => {
    if (!mod) return
    useStore.getState().setMods(mods.filter((m) => m.id !== mod.id))
    setSource('minecraft')
  }

  const needle = q
    .trim()
    .toLowerCase()
    .replace(/^[a-z0-9_]+:/, '')
  const grouped = source === 'minecraft'
  const items = useMemo(() => {
    if (!data) return []
    return data.items.filter(
      (it) =>
        (!grouped || group === 'all' || groupOf(it.id) === group) &&
        (!needle || it.id.includes(needle) || it.en.toLowerCase().includes(needle) || it.th.includes(needle))
    )
  }, [data, group, needle, grouped])
  const tags = useMemo(() => (data ? data.tags.filter((tg) => !needle || tg.id.includes(needle)) : []), [data, needle])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const it of data?.items ?? []) c[groupOf(it.id)] = (c[groupOf(it.id)] ?? 0) + 1
    return c
  }, [data])

  const versions = [...PROFILES].reverse().map((p) => p.mc)
  const addItem = (id: string) => addCentered('itemRef', { item: id })
  const sourceName = source === 'minecraft' ? `Minecraft ${mc}` : mod ? `${mod.title} (${mc})` : `Farmer's Delight (${mc})`
  const fileMod = mod?.source === 'file'

  return (
    <div className="vanilla">
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="input grow" value={source} onChange={(e) => setSource(e.target.value as ItemSource)} title={L({ en: 'Items of', th: 'ไอเทมของ' })}>
          <option value="minecraft">Minecraft</option>
          <option value="farmersdelight">Farmer's Delight</option>
          {mods.map((m) => (
            <option key={m.id} value={`mod:${m.id}`}>
              {m.title}
              {m.source === 'file' ? ' (.jar)' : ''}
            </option>
          ))}
        </select>
        {mod && (
          <button className="btn ghost" onClick={unlink} title={L({ en: 'Remove this mod from the project', th: 'เอาม็อดนี้ออกจากโปรเจกต์' })}>
            ✕
          </button>
        )}
        <button
          className={`btn${adding ? ' primary' : ''}`}
          onClick={() => setAdding((a) => !a)}
          title={L({ en: 'Add mods (Modrinth or .jar files)', th: 'เพิ่มม็อด (Modrinth หรือไฟล์ .jar)' })}
        >
          + {L({ en: 'Mod', th: 'ม็อด' })}
        </button>
      </div>
      {adding && (
        <ModPicker
          mc={mc}
          onClose={() => setAdding(false)}
          onAdded={(src) => {
            setSource(src)
            setAdding(false)
          }}
        />
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <select className="input" style={{ width: 96 }} value={mc} onChange={(e) => setMc(e.target.value)} title="Minecraft">
          {versions.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <div className="lib-search grow" style={{ marginBottom: 0 }}>
          <ISearch size={14} />
          <input className="input" placeholder={t('ws.searchItems')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {!data ? (
        <div className="v-empty">
          {unavailable === mc ? (
            <p className="muted">
              {mod
                ? L({ en: `${mod.title} has no build for Minecraft ${mc} on Modrinth.`, th: `${mod.title} ไม่มีเวอร์ชันสำหรับ Minecraft ${mc} ใน Modrinth` })
                : t('ws.fdUnavailable', { mc })}
            </p>
          ) : fileMod ? (
            <p className="muted">
              {L({
                en: `Pick the .jar of ${mod!.title} for Minecraft ${mc} again to see its items here.`,
                th: `เลือกไฟล์ .jar ของ ${mod!.title} สำหรับ Minecraft ${mc} อีกครั้งเพื่อดูไอเทม`
              })}
            </p>
          ) : (
            <p className="muted">
              {mod
                ? L({
                    en: `Load the items of ${mod.title} for Minecraft ${mc} from Modrinth.`,
                    th: `โหลดไอเทมของ ${mod.title} สำหรับ Minecraft ${mc} จาก Modrinth`
                  })
                : t(source === 'minecraft' ? 'ws.vanillaNeed' : 'ws.fdNeed', { mc })}
            </p>
          )}
          {loading ? (
            <div className="progress" style={{ maxWidth: 'none' }}>
              <span className="ellipsis grow">{loading.msg}</span>
              <span className={`bar${loading.total ? '' : ' indet'}`}>
                <i style={{ width: `${loading.total ? Math.round(((loading.done ?? 0) / loading.total) * 100) : 0}%` }} />
              </span>
            </div>
          ) : fileMod ? (
            <button className="btn primary" onClick={() => setAdding(true)}>
              {L({ en: 'Pick the .jar…', th: 'เลือกไฟล์ .jar…' })}
            </button>
          ) : (
            unavailable !== mc && (
              <button className="btn primary" onClick={download}>
                <IDownload size={14} /> {t('ws.loadItems', { name: sourceName })}
              </button>
            )
          )}
        </div>
      ) : (
        <>
          <div className="chips">
            <button className={group === 'all' ? 'on' : ''} onClick={() => setGroup('all')}>
              {t('ws.all')} <small>{data.items.length}</small>
            </button>
            {grouped &&
              GROUPS.filter((g) => counts[g.id]).map((g) => (
                <button key={g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)} title={L(g.label)}>
                  {g.icon} {L(g.label)} <small>{counts[g.id]}</small>
                </button>
              ))}
            <button className={group === 'tags' ? 'on' : ''} onClick={() => setGroup('tags')}>
              # {t('ws.tags')} <small>{data.tags.length}</small>
            </button>
          </div>
          <div className="faint" style={{ margin: '6px 2px' }}>
            {t('ws.vanillaHint')}
            {data.crops?.length ? ` ${L({ en: `Crops: ${data.crops.length}.`, th: `พืช: ${data.crops.length}` })}` : ''}
          </div>
          {group === 'tags' ? (
            <div className="v-tags">
              {tags.map((tg) => (
                <div
                  key={tg.id}
                  className="lib-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('application/nkw-tag', tg.id)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => addCentered('tagRef', { tag: tg.id })}
                  title={tg.values.join('\n')}
                >
                  <span className="li-icon">#</span>
                  <div className="grow">
                    <span className="mono">{tg.id}</span>
                    <small className="ellipsis">{tg.values.map((v) => v.replace('minecraft:', '')).join(', ')}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="v-grid">
              {items.slice(0, 1600).map((it) => (
                <Tile key={it.id} it={it} mc={mc} ns={ns} icon={source} onAdd={addItem} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
