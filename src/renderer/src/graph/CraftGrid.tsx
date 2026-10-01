import { useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { NODE_DEF_MAP } from '@core/nodes/defs'
import { L } from '../i18n'
import { assetUrl, vanillaIconUrl } from '../api'
import { useItemInfo } from './VanillaPanel'
import { useStore, wireSource, type FlowNode } from '../store'

const DRAG = 'application/nkw-ing'
const EMPTY = ['', '', '', '', '', '', '', '', '']
const TEX_PINS = ['icon', 'texture', 'all', 'side', 'top', 'layer']

type Wired = { kind: 'ref'; id: string } | { kind: 'tag'; id: string } | { kind: 'node'; name: string; tex: string } | null
type State = ReturnType<typeof useStore.getState>
type GraphEdge = State['edges'][number]

/** What comes in through edge `e` (reroutes followed), in a form the UI can draw. */
function resolve(s: State, e: GraphEdge | undefined): Wired {
  const n = wireSource(s.nodes, s.edges, e)
  if (!n) return null
  const d = n.data
  if (n.type === 'itemRef') return { kind: 'ref', id: String(d.item ?? '') }
  if (n.type === 'tagRef') return { kind: 'tag', id: String(d.tag ?? '') }
  return { kind: 'node', name: String(d.name || d.id || L(NODE_DEF_MAP[n.type ?? '']?.title ?? '')), tex: textureOf(s.nodes, s.edges, n) }
}

/** What is plugged into `handle` of node `nodeId` — or comes through edge `edgeId` — in a form the UI can draw. */
function useWired(nodeId: string, handle: string, edgeId?: string): Wired {
  return useStoreWithEqualityFn(
    useStore,
    (s): Wired => resolve(s, edgeId ? s.edges.find((x) => x.id === edgeId) : s.edges.find((x) => x.target === nodeId && x.targetHandle === handle)),
    shallow
  )
}

/** English display name of what comes through an edge (game items by their in-game name), for sorting. */
export function wiredName(s: State, edgeId: string): string {
  const edge = s.edges.find((x) => x.id === edgeId)
  const w = resolve(s, edge)
  if (!w) return ''
  if (w.kind === 'tag') return `#${w.id}`
  if (w.kind === 'node') return w.name
  const [ns, path] = w.id.includes(':') ? w.id.split(':') : ['minecraft', w.id]
  const mc = s.targets[s.activeTarget]?.mc ?? ''
  return s.vanilla[`${ns}@${mc}`]?.items.find((i) => i.id === path)?.en ?? pretty(w.id)
}

function textureOf(nodes: FlowNode[], edges: GraphEdge[], n: FlowNode): string {
  for (const h of TEX_PINS) {
    const e = edges.find((x) => x.target === n.id && x.targetHandle === h)
    const t = e && nodes.find((x) => x.id === e.source)
    if (t?.type === 'texture' && typeof t.data.asset === 'string') return t.data.asset
  }
  return ''
}

function RefIcon({ id }: { id: string }) {
  const info = useItemInfo(id)
  if (!info?.item.icon) return <span className="cg-letter">{(info?.item.en ?? id.split(':').pop() ?? '?').slice(0, 2)}</span>
  return <img className="pixel frame0" src={vanillaIconUrl(info.mc, info.item.id, info.ns)} alt="" draggable={false} />
}

/** "minecraft:oak_planks" → "Oak Planks" while the game item list is not loaded. */
const pretty = (id: string) => (id.split(':').pop() ?? id).replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())

function RefName({ id }: { id: string }) {
  const info = useItemInfo(id)
  return <>{info?.item.en ?? pretty(id)}</>
}

/** Icon (+ optional name) of whatever is wired into a pin (or comes through one edge). */
export function Thing({ nodeId, pin, edgeId, named }: { nodeId: string; pin: string; edgeId?: string; named?: boolean }) {
  const w = useWired(nodeId, pin, edgeId)
  if (!w) return null
  const icon =
    w.kind === 'ref' ? (
      <RefIcon id={w.id} />
    ) : w.kind === 'tag' ? (
      <span className="cg-letter">#</span>
    ) : w.tex ? (
      <img className="pixel frame0" src={assetUrl(w.tex)} alt="" draggable={false} />
    ) : (
      <span className="cg-letter">{w.name.slice(0, 2)}</span>
    )
  const title = w.kind === 'ref' ? <RefName id={w.id} /> : w.kind === 'tag' ? `#${w.id}` : w.name
  return (
    <>
      <span className="cg-icon">{icon}</span>
      {named && <span className="ellipsis">{title}</span>}
    </>
  )
}

/** Crafting table editor: ingredients wired into the node become chips that are dragged onto the 3×3 grid. */
export function CraftGrid({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const raw = Array.isArray(node.data.grid) ? (node.data.grid as unknown[]) : EMPTY
  const grid = EMPTY.map((_, i) => (typeof raw[i] === 'string' ? (raw[i] as string) : ''))
  const wiredPins = useStoreWithEqualityFn(
    useStore,
    (s) => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `i${i}`).filter((p) => s.edges.some((e) => e.target === node.id && e.targetHandle === p)),
    shallow
  )
  const legacy = useStoreWithEqualityFn(
    useStore,
    (s) => EMPTY.map((_, i) => s.edges.some((e) => e.target === node.id && e.targetHandle === `s${i + 1}`)),
    shallow
  )
  const [picked, setPicked] = useState<string | null>(null)
  const [over, setOver] = useState(-1)
  const count = Number(node.data.count ?? 1)

  const save = (next: string[]) => {
    useStore.getState().checkpoint()
    useStore.getState().updateData(node.id, { grid: next })
  }
  const place = (cell: number, pin: string, from?: number) => {
    const next = [...grid]
    if (from !== undefined && from >= 0) next[from] = ''
    next[cell] = pin
    save(next)
  }
  const onDrop = (cell: number) => (e: DragEvent) => {
    e.preventDefault()
    setOver(-1)
    const [pin, from] = e.dataTransfer.getData(DRAG).split('|')
    if (/^i[1-9]$/.test(pin)) place(cell, pin, from ? Number(from) : undefined)
  }
  const drag = (pin: string, from?: number) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG, from === undefined ? pin : `${pin}|${from}`)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="field craft">
      <label>{t('craft.title')}</label>
      <div className="cg-chips">
        {wiredPins.length === 0 && <span className="hint">{t('craft.noIngredients')}</span>}
        {wiredPins.map((p) => (
          <button
            key={p}
            className={`cg-chip${picked === p ? ' on' : ''}`}
            draggable
            onDragStart={drag(p)}
            onClick={() => setPicked(picked === p ? null : p)}
            title={t('craft.chipHint')}
          >
            <Thing nodeId={node.id} pin={p} named />
          </button>
        ))}
      </div>
      <div className="cg-table">
        <div className="cg-grid">
          {grid.map((pin, i) => {
            const filled = legacy[i] || (!!pin && wiredPins.includes(pin))
            return (
              <div
                key={i}
                className={`cg-cell${over === i ? ' over' : ''}${filled ? ' filled' : ''}`}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG)) return
                  e.preventDefault()
                  setOver(i)
                }}
                onDragLeave={() => setOver(-1)}
                onDrop={onDrop(i)}
                onClick={() => {
                  if (picked) place(i, picked)
                  else if (pin) place(i, '')
                }}
                draggable={!!pin && !legacy[i]}
                onDragStart={pin ? drag(pin, i) : undefined}
                onDragEnd={(e) => {
                  // dragged out of the grid → remove it from this cell
                  if (e.dataTransfer.dropEffect === 'none' && pin) place(i, '')
                }}
                title={filled ? t('craft.cellHint') : ''}
              >
                {legacy[i] ? <Thing nodeId={node.id} pin={`s${i + 1}`} /> : pin && wiredPins.includes(pin) ? <Thing nodeId={node.id} pin={pin} /> : null}
              </div>
            )
          })}
        </div>
        <span className="cg-arrow" aria-hidden>
          ➜
        </span>
        <div className="cg-cell cg-result" title={t('craft.result')}>
          <Thing nodeId={node.id} pin="result" />
          {count > 1 && <span className="cg-count">{count}</span>}
        </div>
      </div>
      <div className="row">
        <span className="hint grow">{t('craft.hint')}</span>
        <button className="btn" onClick={() => save([...EMPTY])} disabled={grid.every((g) => !g)}>
          {t('craft.clear')}
        </button>
      </div>
    </div>
  )
}
