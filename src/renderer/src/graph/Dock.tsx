import { useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useReactFlow } from '@xyflow/react'
import { NODE_DEF_MAP } from '@core/nodes/defs'
import { L } from '../i18n'
import { useStore } from '../store'
import { api } from '../api'
import { IAlert, ICheck, IChevron, ITerminal } from '../components/Icons'

export type DockTab = 'problems' | 'console'

export function Dock({
  tab,
  setTab,
  open,
  setOpen,
  height
}: {
  tab: DockTab
  setTab: (t: DockTab) => void
  open: boolean
  setOpen: (o: boolean) => void
  height: number
}) {
  const { t } = useTranslation()
  const diagnostics = useStore((s) => s.diagnostics)
  const logs = useStore((s) => s.build.logs)
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.length - errors
  const rf = useReactFlow()
  const pre = useRef<HTMLPreElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useLayoutEffect(() => {
    if (tab === 'console' && stick.current && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [logs, tab, open])
  useEffect(() => {
    stick.current = true
  }, [tab])

  const focus = (nodeId?: string) => {
    if (!nodeId) return
    const s = useStore.getState()
    const n = s.nodes.find((x) => x.id === nodeId)
    if (!n) return
    useStore.setState({ nodes: s.nodes.map((x) => ({ ...x, selected: x.id === nodeId })) })
    void rf.setCenter(n.position.x + 118, n.position.y + 80, { zoom: Math.max(rf.getZoom(), 0.9), duration: 350 })
  }

  const tabBtn = (id: DockTab, label: React.ReactNode) => (
    <button
      className={tab === id && open ? 'on' : ''}
      onClick={() => {
        if (tab === id) setOpen(!open)
        else {
          setTab(id)
          setOpen(true)
        }
      }}
    >
      {label}
    </button>
  )

  return (
    <div className={`dock${open ? '' : ' closed'}`} style={open ? { height } : undefined}>
      <div className="dock-tabs">
        {tabBtn(
          'problems',
          <>
            <IAlert size={14} /> {t('ws.problems')}
            {errors > 0 && <span className="badge err">{errors}</span>}
            {warnings > 0 && <span className="badge warn">{warnings}</span>}
          </>
        )}
        {tabBtn(
          'console',
          <>
            <ITerminal size={14} /> {t('ws.console')}
          </>
        )}
        <div className="grow" />
        {tab === 'console' && open && (
          <button className="btn ghost" onClick={() => useStore.getState().setBuild({ logs: [] })}>
            {t('ws.clear')}
          </button>
        )}
        {tab === 'console' && open && (
          <button
            className="btn ghost"
            title={t('ws.cleanHint')}
            onClick={async () => {
              const s = useStore.getState()
              const target = s.targets[s.activeTarget]
              if (!target || s.build.running) return
              try {
                await api.cleanBuild(target)
                s.toast(t('ws.cleaned'))
              } catch (e) {
                s.toast((e as Error).message, true)
              }
            }}
          >
            🧹 {t('ws.clean')}
          </button>
        )}
        <button className="btn ghost icon" onClick={() => setOpen(!open)} aria-label="toggle">
          <IChevron size={14} style={{ transform: `rotate(${open ? 90 : -90}deg)` }} />
        </button>
      </div>
      {open && (
        <div
          className="dock-body"
          ref={body}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30
          }}
        >
          {tab === 'problems' ? (
            diagnostics.length === 0 ? (
              <div className="ok-banner">
                <ICheck /> {t('ws.noProblems')}
              </div>
            ) : (
              diagnostics.map((d, i) => {
                const n = d.nodeId ? useStore.getState().nodes.find((x) => x.id === d.nodeId) : undefined
                const def = n ? NODE_DEF_MAP[n.type ?? ''] : undefined
                return (
                  <div key={i} className="problem" onClick={() => focus(d.nodeId)}>
                    <span className={`sev ${d.severity}`}>
                      <IAlert size={14} />
                    </span>
                    <span className="grow">{L(d.message)}</span>
                    {def && (
                      <span className="muted">
                        {def.icon} {L(def.title)}
                        {typeof n?.data.id === 'string' ? ` · ${n.data.id}` : ''}
                      </span>
                    )}
                  </div>
                )
              })
            )
          ) : (
            <pre className="console" ref={pre}>
              {logs.join('\n')}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
