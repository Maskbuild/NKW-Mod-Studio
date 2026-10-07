import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NODE_DEFS, canConnect, type NodeDef, type PinType } from '@core/nodes/defs'
import { registry } from '@core/ext/registry'
import { L } from '../i18n'
import { useRegistryVersion } from '../ext/useRegistry'

export interface Pending {
  /** the dragged pin's type and direction */
  type: PinType
  dir: 'out' | 'in'
  nodeId: string
  handle: string
}

/** First pin on `def` that can connect to the pending wire. */
export function matchPin(def: NodeDef, p: Pending): string | null {
  if (p.dir === 'out') return def.inputs.find((i) => !i.legacy && canConnect(p.type, i.type))?.id ?? null
  return def.outputs.find((o) => canConnect(o.type, p.type))?.id ?? null
}

export function QuickAdd({
  x,
  y,
  pending,
  onPick,
  onClose,
  onPaste
}: {
  x: number
  y: number
  pending: Pending | null
  onPick: (type: string) => void
  onClose: () => void
  /** right-click on the canvas with nodes copied: a "Paste here" item */
  onPaste?: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const registryVersion = useRegistryVersion()
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return NODE_DEFS.filter((d) => d.type !== 'comment' || !pending)
      .filter((d) => !pending || matchPin(d, pending))
      .filter((d) => !needle || [d.title.en, d.title.th, d.type, d.description.en, d.description.th].some((s) => s.toLowerCase().includes(needle)))
  }, [q, pending, registryVersion])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('.qa-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  const left = Math.min(x, window.innerWidth - 310)
  const top = Math.min(y, window.innerHeight - 390)
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())} />
      <div className="qa" style={{ left, top }} role="dialog" aria-label={t('ws.quickAdd')}>
        <input
          className="input"
          autoFocus
          placeholder={t('ws.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(items.length - 1, i + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
            else if (e.key === 'Enter' && items[idx]) onPick(items[idx].type)
          }}
        />
        {onPaste && (
          <div className="qa-item qa-paste" role="menuitem" onMouseDown={(e) => (e.preventDefault(), onPaste())}>
            <span aria-hidden>📋</span>
            {t('ws.paste')}
            <small>Ctrl+V</small>
          </div>
        )}
        <div className="qa-list" ref={listRef}>
          {items.map((d, i) => (
            <div
              key={d.type}
              className={`qa-item${i === idx ? ' on' : ''}`}
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => (e.preventDefault(), onPick(d.type))}
            >
              <span aria-hidden>{d.icon}</span>
              {L(d.title)}
              <small>{L(registry.categories[d.category]?.label)}</small>
            </div>
          ))}
          {!items.length && <div className="empty">—</div>}
        </div>
      </div>
    </>
  )
}
