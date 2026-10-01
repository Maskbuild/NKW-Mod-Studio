import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shallow } from 'zustand/shallow'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Thing, wiredName } from './CraftGrid'
import { useStore, type FlowNode } from '../store'

const MAX_PINS = 64
const DRAG = 'application/nkw-tab-item'
const isItemPin = (h: string | null | undefined) => !!h && (/^item\d+$/.test(h) || h === 'items')
const pinIndex = (h: string | null | undefined) => (h && /^item\d+$/.test(h) ? Number(h.slice(4)) : Infinity)

/**
 * Creative tab: the items in tab order. Drag rows to move them, or sort A→Z / Z→A by name.
 * The order is the order of the node's Item pins, so reordering rewires them (item1, item2, …).
 */
export function TabOrder({ node }: { node: FlowNode }) {
  const { t } = useTranslation()
  const ids = useStoreWithEqualityFn(
    useStore,
    (s) =>
      s.edges
        .filter((e) => e.target === node.id && isItemPin(e.targetHandle))
        .map((e, i) => ({ id: e.id, k: pinIndex(e.targetHandle), i }))
        .sort((a, b) => a.k - b.k || a.i - b.i)
        .map((e) => e.id),
    shallow
  )
  const [drag, setDrag] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  /** Rewires the item pins so that edge ids[k] goes into item{k+1}. */
  const apply = (order: string[]) => {
    const s = useStore.getState()
    s.checkpoint()
    const pos = new Map(order.map((id, k) => [id, k]))
    s.setGraph(
      s.nodes,
      s.edges.map((e) => {
        const k = pos.get(e.id)
        if (k === undefined) return e
        return { ...e, targetHandle: k < MAX_PINS ? `item${k + 1}` : 'items' }
      })
    )
  }
  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...ids]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    apply(next)
  }
  const sort = (dir: 1 | -1) => {
    const s = useStore.getState()
    const names = new Map(ids.map((id) => [id, wiredName(s, id)]))
    apply([...ids].sort((a, b) => dir * names.get(a)!.localeCompare(names.get(b)!, 'en', { sensitivity: 'base', numeric: true })))
  }

  return (
    <div className="field tab-order">
      <label>{t('tabOrder.title')}</label>
      {ids.length === 0 ? (
        <span className="hint">{t('tabOrder.empty')}</span>
      ) : (
        <>
          <div className="row tab-order-tools">
            <button className="btn" onClick={() => sort(1)} title={t('tabOrder.azHint')}>
              A → Z
            </button>
            <button className="btn" onClick={() => sort(-1)} title={t('tabOrder.zaHint')}>
              Z → A
            </button>
            <span className="hint grow">{t('tabOrder.hint')}</span>
          </div>
          <ol className="tab-order-list">
            {ids.map((id, i) => (
              <li
                key={id}
                className={`tab-order-row${drag === i ? ' dragging' : ''}${over === i && drag !== null && drag !== i ? (drag < i ? ' over-below' : ' over-above') : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG, String(i))
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag(i)
                }}
                onDragEnd={() => (setDrag(null), setOver(null))}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DRAG)) return
                  e.preventDefault()
                  setOver(i)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = Number(e.dataTransfer.getData(DRAG))
                  setDrag(null)
                  setOver(null)
                  if (Number.isInteger(from)) move(from, i)
                }}
              >
                <span className="tab-order-grip" aria-hidden>
                  ⋮⋮
                </span>
                <span className="tab-order-num">{i + 1}</span>
                <Thing nodeId={node.id} pin="" edgeId={id} named />
                <span className="grow" />
                <button className="btn icon-btn" disabled={i === 0} onClick={() => move(i, i - 1)} title={t('tabOrder.up')}>
                  ↑
                </button>
                <button className="btn icon-btn" disabled={i === ids.length - 1} onClick={() => move(i, i + 1)} title={t('tabOrder.down')}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
