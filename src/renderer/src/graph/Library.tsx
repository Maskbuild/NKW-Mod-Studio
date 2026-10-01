import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from '@xyflow/react'
import { CATEGORY_LABEL, NODE_DEFS, type Category } from '@core/nodes/defs'
import { L } from '../i18n'
import { useStore } from '../store'
import { ISearch } from '../components/Icons'

const ORDER: Category[] = ['item', 'block', 'armor', 'effect', 'sound', 'recipe', 'fd', 'script', 'asset', 'util']

export function useAddCentered() {
  const rf = useReactFlow()
  return (type: string, data?: Record<string, unknown>) => {
    const el = document.querySelector('.canvas')!.getBoundingClientRect()
    const p = rf.screenToFlowPosition({ x: el.left + el.width / 2 - 118, y: el.top + el.height / 2 - 60 })
    useStore.getState().addNode(type, { x: Math.round(p.x / 16) * 16, y: Math.round(p.y / 16) * 16 }, data)
  }
}

export function Library() {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const addCentered = useAddCentered()
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const defs = NODE_DEFS.filter((d) => !d.hidden).filter(
      (d) => !needle || [d.title.en, d.title.th, d.description.en, d.description.th].some((s) => s.toLowerCase().includes(needle))
    )
    return ORDER.map((c) => ({ c, defs: defs.filter((d) => d.category === c) })).filter((g) => g.defs.length)
  }, [q])

  return (
    <>
      <div className="lib-search">
        <ISearch size={14} />
        <input className="input" placeholder={t('ws.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {groups.map(({ c, defs }) => (
        <div key={c}>
          <div className="lib-cat">{L(CATEGORY_LABEL[c])}</div>
          {defs.map((d) => (
            <div
              key={d.type}
              className="lib-item"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/nkw-node', d.type)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDoubleClick={() => addCentered(d.type)}
              title={L(d.description)}
            >
              <span className="li-icon">{d.icon}</span>
              <div className="grow">
                {L(d.title)}
                <small className="ellipsis">{L(d.description)}</small>
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  )
}
