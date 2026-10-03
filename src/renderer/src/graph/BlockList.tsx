import { useMemo, useState } from 'react'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { breakRuleEntries, type PropDef } from '@core/nodes/defs'
import { NSID_RE } from '@core/project'
import { L } from '../i18n'
import { vanillaIconUrl } from '../api'
import { useActiveMc, useItemInfo, useVanilla } from './VanillaPanel'
import { useStore, type FlowNode } from '../store'

/** Block tags that are handy in Break Rules (they exist on every supported version that has tags). */
const BLOCK_TAGS = [
  'minecraft:logs',
  'minecraft:planks',
  'minecraft:leaves',
  'minecraft:wool',
  'minecraft:sand',
  'minecraft:dirt',
  'minecraft:base_stone_overworld',
  'minecraft:base_stone_nether',
  'minecraft:coal_ores',
  'minecraft:iron_ores',
  'minecraft:copper_ores',
  'minecraft:gold_ores',
  'minecraft:redstone_ores',
  'minecraft:lapis_ores',
  'minecraft:diamond_ores',
  'minecraft:emerald_ores',
  'minecraft:mineable/pickaxe',
  'minecraft:mineable/axe',
  'minecraft:mineable/shovel',
  'minecraft:mineable/hoe',
  'minecraft:needs_stone_tool',
  'minecraft:needs_iron_tool',
  'minecraft:needs_diamond_tool',
  'minecraft:crops',
  'minecraft:flowers',
  'minecraft:saplings'
]
const MOD_BLOCK_TYPES = ['block', 'block3d', 'crop']
const SHOWN = 80

type Entry = { id: string; name: string; thName: string }

const pretty = (id: string) => (id.split(':').pop() ?? id).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const valid = (e: string) => NSID_RE.test(e.replace(/^#/, ''))

function Icon({ id }: { id: string }) {
  const info = useItemInfo(id.startsWith('#') ? '' : id)
  if (id.startsWith('#')) return <span className="cg-letter">#</span>
  if (!info?.item.icon) return <span className="cg-letter">{(info?.item.en ?? pretty(id)).slice(0, 2)}</span>
  return <img className="pixel frame0" src={vanillaIconUrl(info.mc, info.item.id, info.ns)} alt="" draggable={false} />
}

/**
 * Blocks of a Break Rule: tick any number of game blocks (searchable), this mod's blocks or common tags,
 * type ids of other mods / #tags (several at once, separated by spaces or commas) or drop game items here.
 */
export function BlockListField({ node, p }: { node: FlowNode; p: PropDef }) {
  const mc = useActiveMc()
  const data = useVanilla(mc)
  const fd = useVanilla(mc, 'farmersdelight')
  const modId = useStore((s) => s.meta?.modId ?? '')
  const modBlocks = useStoreWithEqualityFn(
    useStore,
    (s) =>
      s.nodes
        .filter((n) => MOD_BLOCK_TYPES.includes(n.type ?? '') && !n.data.disabled && typeof n.data.id === 'string')
        .map((n) => `${String(n.data.id)}|${String(n.data.name || n.data.id)}`),
    shallow
  )
  const list = breakRuleEntries(node.data)
  const [q, setQ] = useState('')
  const [over, setOver] = useState(false)

  const save = (next: string[]) => {
    useStore.getState().checkpoint()
    useStore.getState().updateData(node.id, { [p.key]: next })
  }
  const add = (ids: string[]) => {
    const next = [...list]
    for (const raw of ids) {
      const id = raw.trim().toLowerCase()
      if (id && valid(id) && !next.includes(id)) next.push(id)
    }
    if (next.length !== list.length) save(next)
  }
  const toggle = (id: string) => (list.includes(id) ? save(list.filter((x) => x !== id)) : add([id]))

  // everything that can be picked: this mod's blocks, game blocks (block items), Farmer's Delight, tags
  const all = useMemo((): Entry[] => {
    const out: Entry[] = modBlocks.map((m) => {
      const [id, name] = m.split('|')
      return { id: `${modId}:${id}`, name, thName: '' }
    })
    for (const [src, ns] of [
      [data, 'minecraft'],
      [fd, 'farmersdelight']
    ] as const)
      for (const it of src?.items ?? []) if (it.kind === 'block') out.push({ id: `${ns}:${it.id}`, name: it.en, thName: it.th })
    for (const tg of BLOCK_TAGS) out.push({ id: `#${tg}`, name: `#${tg.replace('minecraft:', '')}`, thName: '' })
    return out
  }, [modBlocks, modId, data, fd])

  const needle = q.trim().toLowerCase()
  const hits = useMemo(
    () => (needle ? all.filter((e) => e.id.includes(needle) || e.name.toLowerCase().includes(needle) || e.thName.includes(needle)) : all),
    [all, needle]
  )
  const typed = needle
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter((x) => valid(x) && !all.some((e) => e.id === x))
  const shown = hits.slice(0, SHOWN)
  const tr = (en: string, thai: string) => L({ en, th: thai })

  return (
    <div
      className={`field block-list${over ? ' over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('application/nkw-vanilla')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('application/nkw-vanilla')
        setOver(false)
        if (!id) return
        e.preventDefault()
        add([id])
      }}
    >
      <label>
        {L(p.label)} <span className="faint">({list.length})</span>
      </label>
      {list.length > 0 && (
        <div className="block-chips">
          {list.map((id) => (
            <span key={id} className={`block-chip${valid(id) ? '' : ' invalid'}`} title={id}>
              <span className="cg-icon">
                <Icon id={id} />
              </span>
              <span className="ellipsis">{all.find((e) => e.id === id)?.name ?? (id.startsWith('#') ? id : pretty(id))}</span>
              <button className="block-chip-x" onClick={() => toggle(id)} title={tr('Remove', 'เอาออก')}>
                ×
              </button>
            </span>
          ))}
          <button className="btn small" onClick={() => save([])}>
            {tr('Clear', 'ล้างทั้งหมด')}
          </button>
        </div>
      )}
      <div className="row">
        <input
          className="input mono grow"
          placeholder={tr('Search, or type ids: othermod:ruby_ore #minecraft:logs', 'ค้นหา หรือพิมพ์ ID: othermod:ruby_ore #minecraft:logs')}
          value={q}
          maxLength={2000}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (typed.length) add(typed)
            else if (hits.length === 1) add([hits[0].id])
            else return
            setQ('')
          }}
        />
        {typed.length > 0 && (
          <button className="btn" onClick={() => (add(typed), setQ(''))}>
            + {typed.length > 1 ? typed.length : typed[0]}
          </button>
        )}
      </div>
      <div className="block-pick">
        {shown.map((e) => (
          <label key={e.id} className={`multi-opt${list.includes(e.id) ? ' on' : ''}`} title={e.id}>
            <input type="checkbox" checked={list.includes(e.id)} onChange={() => toggle(e.id)} />
            <span className="cg-icon">
              <Icon id={e.id} />
            </span>
            <span className="ellipsis">{e.name}</span>
          </label>
        ))}
        {!shown.length && <span className="hint">{tr('Nothing found: press Enter to add the typed id', 'ไม่พบ: กด Enter เพื่อเพิ่ม ID ที่พิมพ์')}</span>}
      </div>
      <div className="row">
        {needle && hits.length > 1 && (
          <button className="btn small" onClick={() => add(hits.map((h) => h.id))}>
            {tr(`Tick all ${hits.length} found`, `ติ๊กทั้งหมด ${hits.length} อันที่พบ`)}
          </button>
        )}
        {hits.length > SHOWN && (
          <span className="hint">
            {tr(`Showing ${SHOWN} of ${hits.length}: type to narrow down`, `แสดง ${SHOWN} จาก ${hits.length}: พิมพ์เพื่อค้นหาให้แคบลง`)}
          </span>
        )}
      </div>
      {!data && <span className="hint">{tr('Load the full block list in the "Game items" tab', 'โหลดรายการบล็อกทั้งหมดได้ที่แท็บ "ไอเทมเกม"')}</span>}
      {p.hint && <span className="hint">{L(p.hint)}</span>}
    </div>
  )
}
