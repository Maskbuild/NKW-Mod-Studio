import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { LOADER_LABEL, type Target } from '@core/project'
import type { Diagnostic } from '@core/ir'
import { api } from '../api'
import { useStore } from '../store'
import { Canvas } from '../graph/Canvas'
import { Library } from '../graph/Library'
import { AssetTree } from '../graph/AssetTree'
import { Inspector } from '../graph/Inspector'
import { Dock, type DockTab } from '../graph/Dock'
import { VanillaPanel } from '../graph/VanillaPanel'
import { DEFAULT_LAYOUT, Resizer, useLayout } from '../components/Resizer'
import { IDownload, IFolder, IHome, ILayout, IPlay, IRedo, ISettings, IStop, IUndo, Logo } from '../components/Icons'
import { SettingsDialog, type SettingsSection } from './SettingsDialog'
import { useIde, watchGeneratedFiles } from '../ide/ideStore'
import { ActivityBar, EditorTabs, StatusBar } from '../ide/Chrome'
import { CodeExplorer } from '../ide/CodeExplorer'
import { CodeView } from '../ide/CodeView'
import { CommandPalette } from '../ide/CommandPalette'
import { ModelEditor } from '../ide/ModelEditor'
import { ControlsJsonPage } from '../ide/SettingsPage'

/** Validation in a worker, debounced, always against the active target. */
function useValidation() {
  useEffect(() => {
    const worker = new Worker(new URL('../validate.worker.ts', import.meta.url), { type: 'module' })
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    worker.onmessage = (e: MessageEvent<{ seq: number; diagnostics: Diagnostic[] }>) => {
      if (e.data.seq === seq) useStore.getState().setDiagnostics(e.data.diagnostics)
    }
    const run = () => {
      const s = useStore.getState()
      const project = s.project()
      if (!project) return
      worker.postMessage({ seq: ++seq, project, target: s.targets[s.activeTarget] })
    }
    run()
    const unsub = useStore.subscribe((s, prev) => {
      if (s.nodes !== prev.nodes || s.edges !== prev.edges || s.meta !== prev.meta || s.targets !== prev.targets || s.activeTarget !== prev.activeTarget) {
        clearTimeout(timer)
        timer = setTimeout(run, 180)
      }
    })
    return () => {
      unsub()
      clearTimeout(timer)
      worker.terminate()
    }
  }, [])
}

/** Autosave 1.2 s after the last real change. */
function useAutosave() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.dirty &&
        (s.nodes !== prev.nodes ||
          s.edges !== prev.edges ||
          s.meta !== prev.meta ||
          s.targets !== prev.targets ||
          s.overrides !== prev.overrides ||
          !prev.dirty)
      ) {
        clearTimeout(timer)
        timer = setTimeout(() => void useStore.getState().save(), 1200)
      }
    })
    const beforeUnload = () => {
      if (useStore.getState().dirty) void useStore.getState().save()
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      unsub()
      clearTimeout(timer)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [])
}

function useBuildEvents(openConsole: () => void) {
  const { t } = useTranslation()
  useEffect(() => {
    const offs = [
      api.on<string[]>('build:log', (lines) => useStore.getState().appendLogs(lines)),
      api.on<{ msg: string; done?: number; total?: number }>('build:progress', (p) => useStore.getState().setBuild({ progress: p })),
      api.on<{ code: number; cancelled?: boolean; jar?: string | null }>('build:done', (r) => {
        const s = useStore.getState()
        s.setBuild({ running: false, progress: null, lastCode: r.code, task: null })
        if (r.cancelled) return
        if (r.code === 0) s.toast(`✓ ${t('ws.buildOk')}`)
        else {
          s.toast(t('ws.buildFail', { code: r.code }), true)
          openConsole()
        }
      })
    ]
    return () => offs.forEach((o) => o())
  }, [t, openConsole])
}

/** Main sends progress in English; show it in the UI language. */
function progressText(msg: string, th: boolean): string {
  if (!th) return msg
  return msg
    .replace(/^Running runClient/, 'กำลังเปิดเกม…')
    .replace(/^Running build/, 'กำลังสร้างไฟล์ม็อด…')
    .replace(/^Running /, 'กำลังรัน ')
    .replace(/^Resolving versions/, 'กำลังตรวจสอบเวอร์ชัน…')
    .replace(/^Downloading /, 'กำลังดาวน์โหลด ')
    .replace(/^Extracting /, 'กำลังแตกไฟล์ ')
}

function Toolbar({ onSettings }: { onSettings: (section?: SettingsSection) => void }) {
  const { t, i18n } = useTranslation()
  const meta = useStore((s) => s.meta)!
  const dirty = useStore((s) => s.dirty)
  const saving = useStore((s) => s.saving)
  const targets = useStore((s) => s.targets)
  const active = useStore((s) => s.activeTarget)
  const build = useStore((s) => s.build)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const errors = useStore((s) => s.diagnostics.filter((d) => d.severity === 'error').length)
  const target: Target | undefined = targets[active]

  const run = async (task: 'runClient' | 'build') => {
    const s = useStore.getState()
    if (errors) {
      s.toast(t('ws.errorsFirst'), true)
      window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'problems' }))
      return
    }
    const project = s.project()
    if (!project || !target) return
    s.setBuild({ running: true, task, logs: [], progress: { msg: task === 'runClient' ? t('ws.running') : t('ws.building') } })
    window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'console' }))
    try {
      const started = await api.startBuild(project, target, task)
      useStore.setState({ dirty: false })
      if (!started) s.setBuild({ running: false, progress: null })
    } catch (e) {
      s.setBuild({ running: false, progress: null })
      s.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
    }
  }

  const pct = build.progress?.total ? Math.round(((build.progress.done ?? 0) / build.progress.total) * 100) : null
  const ide = useIde((s) => s.ide)

  // commands from the command palette
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    const h = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail
      const s = useStore.getState()
      if (cmd === 'test' && !s.build.running) void runRef.current('runClient')
      else if (cmd === 'export' && !s.build.running) void runRef.current('build')
      else if (cmd === 'openBuild' && target) void api.openBuildFolder(target)
      else if (cmd === 'settings') onSettings()
      else if (cmd === 'settings:model') onSettings('model')
      else if (cmd === 'clean' && target && !s.build.running)
        void api.cleanBuild(target).then(
          () => s.toast(t('ws.cleaned')),
          (err: Error) => s.toast(err.message, true)
        )
    }
    window.addEventListener('nkw:cmd', h)
    return () => window.removeEventListener('nkw:cmd', h)
  }, [target, onSettings, t])

  return (
    <div className="titlebar">
      <button className="btn ghost icon" title={t('ws.home')} onClick={() => void useStore.getState().closeProject()}>
        <IHome />
      </button>
      <Logo size={20} />
      <span className="proj-name ellipsis" title={meta.name}>
        {meta.name}
      </span>
      <span title={saving ? t('ws.saving') : dirty ? t('ws.unsaved') : t('ws.saved')} className="row">
        {dirty ? <span className="dirty-dot" /> : <span className="faint">{t('ws.saved')}</span>}
      </span>
      <span className="tb-sep" />
      <button className="btn ghost icon" disabled={!canUndo} title={`${t('ws.undo')} (Ctrl+Z)`} onClick={() => useStore.getState().undo()}>
        <IUndo />
      </button>
      <button className="btn ghost icon" disabled={!canRedo} title={`${t('ws.redo')} (Ctrl+Y)`} onClick={() => useStore.getState().redo()}>
        <IRedo />
      </button>
      <div className="drag" />
      {build.progress && (
        <div className="progress" title={build.progress.msg}>
          <span className="ellipsis">{progressText(build.progress.msg, i18n.language === 'th')}</span>
          <span className={`bar${pct === null ? ' indet' : ''}`}>
            <i style={{ width: `${pct ?? 0}%` }} />
          </span>
        </div>
      )}
      <select
        className="input"
        style={{ width: 170 }}
        value={active}
        disabled={build.running}
        onChange={(e) => useStore.setState({ activeTarget: Number(e.target.value), dirty: true })}
        title={t('ws.target')}
      >
        {targets.map((tg, i) => (
          <option key={`${tg.loader}-${tg.mc}`} value={i}>
            {LOADER_LABEL[tg.loader]} {tg.mc}
          </option>
        ))}
      </select>
      {build.running ? (
        <button className="btn danger" onClick={() => void api.stopBuild()}>
          <IStop size={14} /> {t('ws.stop')}
        </button>
      ) : (
        <>
          <button className="btn primary" onClick={() => void run('runClient')} title="Ctrl+Enter">
            <IPlay size={14} /> {t('ws.test')}
          </button>
          <button className="btn" onClick={() => void run('build')}>
            <IDownload size={14} /> {t('ws.export')}
          </button>
        </>
      )}
      <button
        className={`btn ghost icon${ide ? ' on' : ''}`}
        title={ide ? t('ide.classic') : t('ide.layoutIde')}
        onClick={() => useIde.getState().setPrefs({ ide: !ide })}
      >
        <ILayout />
      </button>
      <button className="btn ghost icon" title={t('ws.openBuild')} onClick={() => target && void api.openBuildFolder(target)}>
        <IFolder />
      </button>
      <button className="btn ghost icon" title={t('home.settings')} onClick={() => onSettings()}>
        <ISettings />
      </button>
    </div>
  )
}

function Shortcuts({ quickAdd }: { quickAdd: React.MutableRefObject<((x: number, y: number) => void) | null> }) {
  const rf = useReactFlow()
  const mouse = useRef({ x: 400, y: 300 })
  useEffect(() => {
    const move = (e: MouseEvent) => (mouse.current = { x: e.clientX, y: e.clientY })
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = typeof el?.closest === 'function' && el.closest('input, textarea, select, [contenteditable="true"]')
      const s = useStore.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void s.save()
        return
      }
      if (ctrl && e.key === 'Enter') {
        e.preventDefault()
        ;(document.querySelector('.titlebar .btn.primary') as HTMLButtonElement | null)?.click()
        return
      }
      if (typing || useIde.getState().active !== 'graph' || useIde.getState().palette) return
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) (e.preventDefault(), s.undo())
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) (e.preventDefault(), s.redo())
      else if (ctrl && e.key.toLowerCase() === 'c') s.copy()
      else if (ctrl && e.key.toLowerCase() === 'v') {
        // the paste event below normally handles it (with the system clipboard); this is the fallback
        pasteSeen = false
        const at = rf.screenToFlowPosition(mouse.current)
        setTimeout(() => {
          if (!pasteSeen) useStore.getState().paste(at)
        }, 80)
      } else if (ctrl && e.key.toLowerCase() === 'd') (e.preventDefault(), s.duplicate())
      else if (ctrl && e.key.toLowerCase() === 'e') (e.preventDefault(), s.toggleDisabled())
      else if (ctrl && e.key.toLowerCase() === 'a') (e.preventDefault(), useStore.setState({ nodes: s.nodes.map((n) => ({ ...n, selected: true })) }))
      else if (e.key === ' ' && !ctrl) (e.preventDefault(), quickAdd.current?.(mouse.current.x, mouse.current.y))
      else if (e.key.toLowerCase() === 'f' && !ctrl)
        void rf.fitView({ padding: 0.2, duration: 300, nodes: s.nodes.some((n) => n.selected) ? s.nodes.filter((n) => n.selected) : undefined })
    }
    // copy / cut / paste go through the clipboard events: they also come from the app's Edit menu
    // keys, and put the nodes on the system clipboard (paste into another project or window)
    let pasteSeen = false
    const inGraph = () => {
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && typeof el.closest === 'function' && !!el.closest('input, textarea, select, [contenteditable="true"], .cm-editor')
      return !typing && useIde.getState().active === 'graph' && !useIde.getState().palette
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!inGraph()) return
      const text = e.type === 'cut' ? useStore.getState().cut() : useStore.getState().copy()
      if (!text) return
      e.clipboardData?.setData('text/plain', text)
      e.preventDefault()
    }
    const onPaste = (e: ClipboardEvent) => {
      if (!inGraph()) return
      pasteSeen = true
      e.preventDefault()
      const at = rf.screenToFlowPosition(mouse.current)
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (!useStore.getState().paste(at, text)) useStore.getState().paste(at)
    }
    const cmd = (e: Event) => {
      const name = (e as CustomEvent<string>).detail
      if (name === 'fit') {
        useIde.getState().setActive('graph')
        void rf.fitView({ padding: 0.2, duration: 300 })
      } else if (name === 'addNode') {
        useIde.getState().setActive('graph')
        setTimeout(() => quickAdd.current?.(window.innerWidth / 2, window.innerHeight / 2), 0)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('keydown', key)
    window.addEventListener('nkw:cmd', cmd)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('keydown', key)
      window.removeEventListener('nkw:cmd', cmd)
    }
  }, [rf, quickAdd])
  return null
}

function WorkspaceInner() {
  const { t } = useTranslation()
  const [layout, setLayout] = useLayout()
  const ide = useIde((s) => s.ide)
  const sideView = useIde((s) => s.side)
  const showRight = useIde((s) => s.right)
  const tabs = useIde((s) => s.tabs)
  const activeTab = useIde((s) => s.tabs.find((x) => x.id === s.active))
  // the classic layout always shows a side bar
  const leftTab = sideView ?? 'library'
  const showLeft = !ide || sideView !== null
  const setLeftTab = (v: typeof leftTab) => useIde.getState().setPrefs({ side: v })
  const [dockTab, setDockTab] = useState<DockTab>('problems')
  const [dockOpen, setDockOpen] = useState(true)
  const [settings, setSettings] = useState<SettingsSection | false>(false)
  const openSettings = useCallback((section: SettingsSection = 'app') => setSettings(section), [])
  const quickAdd = useRef<((x: number, y: number) => void) | null>(null)

  useValidation()
  useAutosave()
  useBuildEvents(() => {
    setDockTab('console')
    setDockOpen(true)
  })
  useEffect(() => {
    const h = (e: Event) => {
      setDockTab((e as CustomEvent<DockTab>).detail)
      setDockOpen(true)
    }
    window.addEventListener('nkw:dock', h)
    return () => window.removeEventListener('nkw:dock', h)
  }, [])
  useEffect(() => watchGeneratedFiles(), [])
  // IDE keys (work everywhere, also while typing)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const k = e.key.toLowerCase()
      const i = useIde.getState()
      if (e.shiftKey && k === 'p') (e.preventDefault(), useIde.setState({ palette: 'commands' }))
      else if (!e.shiftKey && !e.altKey && k === 'p') (e.preventDefault(), useIde.setState({ palette: 'files' }))
      else if (e.altKey && k === 'b') (e.preventDefault(), i.setPrefs({ right: !i.right }))
      else if (!e.altKey && k === 'b') (e.preventDefault(), i.setPrefs({ side: i.side ? null : 'library' }))
      else if (k === 'j') (e.preventDefault(), setDockOpen((o) => !o))
      else if (k === 'w' && i.active !== 'graph') (e.preventDefault(), i.close(i.active))
      else if (e.key === 'Tab') {
        e.preventDefault()
        const n = i.tabs.findIndex((x) => x.id === i.active)
        i.setActive(i.tabs[(n + (e.shiftKey ? -1 : 1) + i.tabs.length) % i.tabs.length].id)
      }
    }
    const cmd = (e: Event) => (e as CustomEvent<string>).detail === 'togglePanel' && setDockOpen((o) => !o)
    window.addEventListener('keydown', key)
    window.addEventListener('nkw:cmd', cmd)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('nkw:cmd', cmd)
    }
  }, [])

  return (
    <div className={`ws${ide ? ' ide' : ''}`}>
      <Toolbar onSettings={openSettings} />
      <div className="ws-main">
        {ide && <ActivityBar onSettings={() => openSettings()} />}
        {showLeft && (
          <>
            <aside className="side" style={{ width: layout.left }}>
              {ide ? (
                <div className="side-title">
                  {leftTab === 'library' ? t('ws.library') : leftTab === 'vanilla' ? t('ws.vanilla') : leftTab === 'assets' ? t('ws.assets') : t('ide.code')}
                </div>
              ) : (
                <div className="side-tabs">
                  <button className={leftTab === 'library' ? 'on' : ''} onClick={() => setLeftTab('library')}>
                    {t('ws.library')}
                  </button>
                  <button className={leftTab === 'vanilla' ? 'on' : ''} onClick={() => setLeftTab('vanilla')}>
                    {t('ws.vanilla')}
                  </button>
                  <button className={leftTab === 'assets' ? 'on' : ''} onClick={() => setLeftTab('assets')}>
                    {t('ws.assets')}
                  </button>
                  <button className={leftTab === 'code' ? 'on' : ''} onClick={() => setLeftTab('code')}>
                    {t('ide.code')}
                  </button>
                </div>
              )}
              <div className="side-body">
                {leftTab === 'library' ? <Library /> : leftTab === 'vanilla' ? <VanillaPanel /> : leftTab === 'assets' ? <AssetTree /> : <CodeExplorer />}
              </div>
            </aside>
            <Resizer dir="x" value={layout.left} onChange={(v) => setLayout('left', v)} onReset={() => setLayout('left', DEFAULT_LAYOUT.left)} />
          </>
        )}
        <main className="center">
          {(ide || tabs.length > 1) && <EditorTabs />}
          <div className="editor-body">
            <div className="editor-pane" style={{ display: activeTab?.kind === 'graph' ? undefined : 'none' }}>
              <Canvas quickAddRef={quickAdd} />
            </div>
            {activeTab?.kind === 'code' && <CodeView path={activeTab.path!} />}
            {activeTab?.kind === 'controls' && <ControlsJsonPage />}
            {tabs
              .filter((x) => x.kind === 'model')
              .map((x) => (
                <div key={x.id} className="editor-pane" style={{ display: activeTab?.id === x.id ? undefined : 'none' }}>
                  <ModelEditor path={x.path!} wired={x.wired} />
                </div>
              ))}
          </div>
          {dockOpen && (
            <Resizer dir="y" sign={-1} value={layout.dock} onChange={(v) => setLayout('dock', v)} onReset={() => setLayout('dock', DEFAULT_LAYOUT.dock)} />
          )}
          <Dock tab={dockTab} setTab={setDockTab} open={dockOpen} setOpen={setDockOpen} height={layout.dock} />
        </main>
        {(!ide || showRight) && (
          <>
            <Resizer dir="x" sign={-1} value={layout.right} onChange={(v) => setLayout('right', v)} onReset={() => setLayout('right', DEFAULT_LAYOUT.right)} />
            <aside className="side right" style={{ width: layout.right }}>
              {ide ? (
                <div className="side-title">{t('ws.inspector')}</div>
              ) : (
                <div className="side-tabs">
                  <button className="on">{t('ws.inspector')}</button>
                </div>
              )}
              <div className="side-body">
                <Inspector />
              </div>
            </aside>
          </>
        )}
      </div>
      {ide && <StatusBar />}
      <Shortcuts quickAdd={quickAdd} />
      <CommandPalette />
      {settings && <SettingsDialog section={settings} onClose={() => setSettings(false)} />}
    </div>
  )
}

export default function Workspace() {
  return (
    <ReactFlowProvider>
      <WorkspaceInner />
    </ReactFlowProvider>
  )
}
