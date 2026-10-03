import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LOADER_LABEL } from '@core/project'
import { useStore } from '../store'
import { IAlert, IBox, ICode, IFiles, INodes, ISettings, IX } from '../components/Icons'
import { useIde, type SideView } from './ideStore'
import { fileIcon } from './CodeExplorer'

/** VS Code's activity bar: one icon per side bar view; clicking the open one hides the side bar. */
export function ActivityBar({ onSettings }: { onSettings: () => void }) {
  const { t } = useTranslation()
  const side = useIde((s) => s.side)
  const items: { id: SideView; icon: ReactNode; label: string }[] = [
    { id: 'library', icon: <INodes size={22} />, label: t('ws.library') },
    { id: 'vanilla', icon: <IBox size={22} />, label: t('ws.vanilla') },
    { id: 'assets', icon: <IFiles size={22} />, label: t('ws.assets') },
    { id: 'code', icon: <ICode size={22} />, label: t('ide.code') }
  ]
  return (
    <nav className="activity">
      {items.map((it) => (
        <button key={it.id} className={side === it.id ? 'on' : ''} title={it.label} aria-label={it.label} onClick={() => useIde.getState().toggleSide(it.id)}>
          {it.icon}
        </button>
      ))}
      <div className="grow" />
      <button title={`${t('home.settings')}`} aria-label={t('home.settings')} onClick={onSettings}>
        <ISettings size={22} />
      </button>
    </nav>
  )
}

/** Open editors: the graph (always) plus code / model tabs. Middle-click closes. */
export function EditorTabs() {
  const { t } = useTranslation()
  const tabs = useIde((s) => s.tabs)
  const active = useIde((s) => s.active)
  const unsaved = useIde((s) => s.unsaved)
  return (
    <div className="editor-tabs" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={active === tab.id}
          className={`etab${active === tab.id ? ' on' : ''}`}
          title={tab.path ?? t('ide.graph')}
          onClick={() => useIde.getState().setActive(tab.id)}
          onAuxClick={(e) => e.button === 1 && useIde.getState().close(tab.id)}
        >
          <span className="ficon">{tab.kind === 'graph' ? '🕸' : tab.kind === 'model' ? '🧊' : tab.kind === 'controls' ? '🎮' : fileIcon(tab.path ?? '')}</span>
          <span className="ellipsis">{tab.kind === 'graph' ? t('ide.graph') : tab.title}</span>
          {tab.kind !== 'graph' && (
            <button
              className={`etab-x${unsaved[tab.id] ? ' unsaved' : ''}`}
              aria-label={t('ide.closeTab')}
              onClick={(e) => {
                e.stopPropagation()
                useIde.getState().close(tab.id)
              }}
            >
              <IX size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Bottom status bar: target, problems, build state, cursor, layout. */
export function StatusBar() {
  const { t, i18n } = useTranslation()
  const target = useStore((s) => s.targets[s.activeTarget])
  const diags = useStore((s) => s.diagnostics)
  const build = useStore((s) => s.build)
  const dirty = useStore((s) => s.dirty)
  const cursor = useIde((s) => s.cursor)
  const activeTab = useIde((s) => s.tabs.find((x) => x.id === s.active))
  const errors = diags.filter((d) => d.severity === 'error').length
  const warnings = diags.length - errors
  return (
    <footer className={`statusbar${build.running ? ' busy' : ''}`}>
      <button onClick={() => window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'problems' }))} title={t('ws.problems')}>
        <IAlert size={13} /> {errors} · ⚠ {warnings}
      </button>
      {target && (
        <button onClick={() => useIde.setState({ palette: 'commands' })} title={t('ws.target')}>
          {LOADER_LABEL[target.loader]} {target.mc}
        </button>
      )}
      {build.running && <span className="ellipsis">⟳ {build.progress?.msg ?? (build.task === 'runClient' ? t('ws.running') : t('ws.building'))}</span>}
      <div className="grow" />
      {cursor && activeTab?.kind === 'code' && <span>{t('ide.cursor', { line: cursor.line, col: cursor.col })}</span>}
      {activeTab?.kind === 'code' && (
        <span>{activeTab.path?.endsWith('.java') ? 'Java' : /\.(json|mcmeta)$/.test(activeTab.path ?? '') ? 'JSON' : 'Text'}</span>
      )}
      <span>{dirty ? t('ws.unsaved') : t('ws.saved')}</span>
      <span>{i18n.language === 'th' ? 'ไทย' : 'EN'}</span>
      <button onClick={() => useIde.getState().setPrefs({ ide: false })} title={t('ide.classic')}>
        {t('ide.layoutIde')}
      </button>
    </footer>
  )
}
