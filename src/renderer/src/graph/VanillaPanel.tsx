import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GROUPS, groupOf, type GroupId, type VanillaData, type VanillaItem } from '@core/vanilla'
import { PROFILES } from '@core/gen/profiles'
import { L } from '../i18n'
import { api, vanillaIconUrl, type ItemSource } from '../api'
import { useStore } from '../store'
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

/** "minecraft:oak_planks" → "Oak Planks": a readable name while the game item list is not loaded. */
export const prettyId = (id: string) => (id.split(':').pop() ?? id).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Looks up a namespaced item id in the loaded data of the active version. */
export function useItemInfo(id: string): { item: VanillaItem; mc: string; ns: string } | undefined {
  const mc = useStore((s) => s.targets[s.activeTarget]?.mc ?? '')
  const [ns, path] = id.includes(':') ? id.split(':') : ['minecraft', id]
  const source: ItemSource | null = ns === 'minecraft' || ns === 'farmersdelight' ? ns : null
  const item = useStore((s) => (source ? s.vanilla[key(source, mc)]?.items.find((i) => i.id === path) : undefined))
  return item ? { item, mc, ns } : undefined
}

const Tile = memo(function Tile({ it, mc, ns, onAdd }: { it: VanillaItem; mc: string; ns: string; onAdd: (id: string) => void }) {
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
      {it.icon ? <img className="pixel frame0" src={vanillaIconUrl(mc, it.id, ns)} alt="" loading="lazy" draggable={false} /> : <div className="ph">?</div>}
      <span className="ellipsis">{it.en}</span>
    </div>
  )
})

export function VanillaPanel() {
  const { t } = useTranslation()
  const activeMc = useActiveMc()
  const [mc, setMc] = useState(activeMc)
  const [source, setSource] = useState<ItemSource>('minecraft')
  useEffect(() => setMc(activeMc), [activeMc])
  const data = useVanilla(mc, source)
  const [q, setQ] = useState('')
  const [group, setGroup] = useState<GroupId | 'all' | 'tags'>('all')
  const [loading, setLoading] = useState<{ msg: string; done?: number; total?: number } | null>(null)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const addCentered = useAddCentered()
  const ns = source

  useEffect(
    () =>
      api.on<{ mc: string; source: ItemSource; msg: string; done?: number; total?: number }>('vanilla:progress', (p) => {
        if (p.mc === mc && p.source === source) setLoading(p)
      }),
    [mc, source]
  )
  useEffect(() => setUnavailable(null), [mc, source])

  const download = async () => {
    setLoading({ msg: '…' })
    try {
      const d = await api.downloadVanilla(mc, source)
      if (d) useStore.setState((s) => ({ vanilla: { ...s.vanilla, [key(source, mc)]: d } }))
      else setUnavailable(mc)
    } catch (e) {
      useStore.getState().toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
    } finally {
      setLoading(null)
    }
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
  const sourceName = source === 'minecraft' ? `Minecraft ${mc}` : `Farmer's Delight (${mc})`

  return (
    <div className="vanilla">
      <div className="seg" style={{ marginBottom: 8, display: 'flex' }}>
        <button className={source === 'minecraft' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setSource('minecraft')}>
          Minecraft
        </button>
        <button className={source === 'farmersdelight' ? 'on' : ''} style={{ flex: 1 }} onClick={() => setSource('farmersdelight')}>
          Farmer's Delight
        </button>
      </div>
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
            <p className="muted">{t('ws.fdUnavailable', { mc })}</p>
          ) : (
            <p className="muted">{t(source === 'minecraft' ? 'ws.vanillaNeed' : 'ws.fdNeed', { mc })}</p>
          )}
          {loading ? (
            <div className="progress" style={{ maxWidth: 'none' }}>
              <span className="ellipsis grow">{loading.msg}</span>
              <span className={`bar${loading.total ? '' : ' indet'}`}>
                <i style={{ width: `${loading.total ? Math.round(((loading.done ?? 0) / loading.total) * 100) : 0}%` }} />
              </span>
            </div>
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
                <Tile key={it.id} it={it} mc={mc} ns={ns} onAdd={addItem} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
