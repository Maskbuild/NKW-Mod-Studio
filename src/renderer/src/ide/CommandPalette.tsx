import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LOADER_LABEL } from '@core/project'
import { api } from '../api'
import { useStore } from '../store'
import { useIde } from './ideStore'
import { fileIcon } from './CodeExplorer'
import { createModel } from './models'

interface Item {
  id: string
  label: string
  hint?: string
  icon?: string
  run: () => void
}

/** Sends a toolbar command (test, export, settings …) to whoever handles it. */
export const command = (name: string) => window.dispatchEvent(new CustomEvent('nkw:cmd', { detail: name }))

/** Ctrl+Shift+P: every command; Ctrl+P: open a generated file or a project asset. Type to filter, Enter runs. */
export function CommandPalette() {
  const { t } = useTranslation()
  const mode = useIde((s) => s.palette)
  const files = useIde((s) => s.files)
  const targets = useStore((s) => s.targets)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const close = () => useIde.setState({ palette: null })

  useEffect(() => {
    if (!mode) return
    setQ('')
    setIdx(0)
    // the file list comes from the code view
    if (mode === 'files' && !files.length) void useIde.getState().refreshFiles()
    setTimeout(() => input.current?.focus(), 0)
  }, [mode])

  const items = useMemo<Item[]>(() => {
    if (mode === 'files') {
      return files.map((f) => ({
        id: f.path,
        label: f.path.split('/').pop()!,
        hint: f.path,
        icon: fileIcon(f.path),
        run: () => useIde.getState().openCode(f.path)
      }))
    }
    const ide = useIde.getState()
    const list: Item[] = [
      { id: 'test', label: t('ws.test'), hint: 'Ctrl+Enter', icon: '▶', run: () => command('test') },
      { id: 'export', label: t('ws.export'), icon: '⬇', run: () => command('export') },
      { id: 'stop', label: t('ws.stop'), icon: '■', run: () => void api.stopBuild() },
      { id: 'save', label: t('ide.cmd.save'), hint: 'Ctrl+S', icon: '💾', run: () => void useStore.getState().save() },
      { id: 'undo', label: t('ws.undo'), hint: 'Ctrl+Z', run: () => useStore.getState().undo() },
      { id: 'redo', label: t('ws.redo'), hint: 'Ctrl+Y', run: () => useStore.getState().redo() },
      { id: 'quickOpen', label: t('ide.cmd.quickOpen'), hint: 'Ctrl+P', icon: '📄', run: () => setTimeout(() => useIde.setState({ palette: 'files' }), 0) },
      { id: 'newModel', label: t('model.new'), icon: '🧊', run: () => void createModel() },
      { id: 'addNode', label: t('ws.quickAdd'), hint: 'Space', icon: '＋', run: () => command('addNode') },
      { id: 'graph', label: t('ide.cmd.graph'), icon: '🕸', run: () => ide.setActive('graph') },
      { id: 'side', label: t('ide.cmd.toggleSide'), hint: 'Ctrl+B', run: () => ide.setPrefs({ side: ide.side ? null : 'library' }) },
      { id: 'panel', label: t('ide.cmd.togglePanel'), hint: 'Ctrl+J', run: () => command('togglePanel') },
      { id: 'right', label: t('ide.cmd.toggleRight'), hint: 'Ctrl+Alt+B', run: () => ide.setPrefs({ right: !ide.right }) },
      { id: 'code', label: t('ide.cmd.code'), icon: '</>', run: () => ide.setPrefs({ side: 'code' }) },
      { id: 'problems', label: t('ws.problems'), run: () => window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'problems' })) },
      { id: 'console', label: t('ws.console'), run: () => window.dispatchEvent(new CustomEvent('nkw:dock', { detail: 'console' })) },
      { id: 'fit', label: t('ws.fit'), hint: 'F', run: () => command('fit') },
      { id: 'openBuild', label: t('ws.openBuild'), icon: '📁', run: () => command('openBuild') },
      { id: 'clean', label: t('ws.clean'), icon: '🧹', run: () => command('clean') },
      { id: 'settings', label: t('home.settings'), icon: '⚙', run: () => command('settings') },
      { id: 'controls', label: t('controls.openJson'), icon: '🎮', run: () => useIde.getState().openControls() },
      { id: 'layout', label: ide.ide ? t('ide.classic') : t('ide.layoutIde'), icon: '⊞', run: () => ide.setPrefs({ ide: !ide.ide }) },
      { id: 'home', label: t('ws.home'), icon: '⌂', run: () => void useStore.getState().closeProject() }
    ]
    targets.forEach((tg, i) =>
      list.push({
        id: `target-${i}`,
        label: `${t('ide.cmd.target')}: ${LOADER_LABEL[tg.loader]} ${tg.mc}`,
        run: () => !useStore.getState().build.running && useStore.setState({ activeTarget: i, dirty: true })
      })
    )
    return list
  }, [mode, files, targets, t])

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return items.slice(0, 200)
    return items.filter((it) => `${it.label} ${it.hint ?? ''}`.toLowerCase().includes(s)).slice(0, 200)
  }, [items, q])

  if (!mode) return null
  const pick = (it: Item | undefined) => {
    if (!it) return
    close()
    it.run()
  }
  return (
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal>
        <input
          ref={input}
          className="input"
          value={q}
          placeholder={mode === 'files' ? t('ide.searchFiles') : t('ide.searchCommands')}
          onChange={(e) => {
            setQ(e.target.value)
            setIdx(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(shown.length - 1, i + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)))
            else if (e.key === 'Enter') pick(shown[idx])
          }}
        />
        <div className="palette-list">
          {shown.map((it, i) => (
            <button key={it.id} className={`palette-item${i === idx ? ' on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(it)}>
              <span className="pi-icon">{it.icon ?? ''}</span>
              <span className="ellipsis grow">{it.label}</span>
              {it.hint && <span className="faint ellipsis pi-hint">{it.hint}</span>}
            </button>
          ))}
          {!shown.length && <div className="hint">{t('ide.nothing')}</div>}
        </div>
      </div>
    </div>
  )
}
