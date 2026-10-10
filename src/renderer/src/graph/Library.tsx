import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from '@xyflow/react'
import { NODE_DEFS } from '@core/nodes/defs'
import { registry } from '@core/ext/registry'
import { L } from '../i18n'
import { useStore } from '../store'
import { ISearch } from '../components/Icons'
import { useRegistryVersion } from '../ext/useRegistry'

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
  const registryVersion = useRegistryVersion()
  const { coreGroups, addonGroups } = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const defs = NODE_DEFS.filter((d) => !d.hidden).filter(
      (d) => !needle || [d.title.en, d.title.th, d.description.en, d.description.th].some((s) => s.toLowerCase().includes(needle))
    )
    const all = registry
      .categoryOrder()
      .map((c) => ({ c, defs: defs.filter((d) => d.category === c) }))
      .filter((g) => g.defs.length)
    return {
      coreGroups: all.filter((g) => !registry.isAddonCategory(g.c) && g.c !== 'addon'),
      addonGroups: all.filter((g) => registry.isAddonCategory(g.c) || g.c === 'addon')
    }
  }, [q, registryVersion])

  const renderGroup = (c: string, defs: typeof NODE_DEFS, isAddon = false) => (
    <div key={c} className={isAddon ? 'lib-addon-group' : undefined}>
      <div className={isAddon ? 'lib-cat lib-cat-addon' : 'lib-cat'}>
        {isAddon && <span className="lib-cat-dot" style={{ background: registry.categoryColor(c) }} />}
        <span>{L(registry.categories[c]?.label)}</span>
      </div>
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
  )

  return (
    <>
      <div className="lib-search">
        <ISearch size={14} />
        <input className="input" placeholder={t('ws.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {coreGroups.map(({ c, defs }) => renderGroup(c, defs, false))}
      {addonGroups.length > 0 && (
        <div className="lib-addon-zone">
          <div className="lib-zone-divider">
            <span className="lib-zone-icon">🧩</span>
            <span className="lib-zone-title">{t('ext.zoneTitle', 'ส่วนเสริม (Add-Ons)')}</span>
          </div>
          {addonGroups.map(({ c, defs }) => renderGroup(c, defs, true))}
        </div>
      )}
    </>
  )
}
