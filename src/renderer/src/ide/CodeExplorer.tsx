import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LOADER_LABEL } from '@core/project'
import { useStore } from '../store'
import { useIde, type GeneratedFile } from './ideStore'

interface Dir {
  name: string
  path: string
  dirs: Dir[]
  files: GeneratedFile[]
}

/** Folder tree; a folder with a single sub-folder and no files is shown as one row ("src/main/java"). */
function tree(files: GeneratedFile[]): Dir {
  const root: Dir = { name: '', path: '', dirs: [], files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let d = root
    for (const p of parts.slice(0, -1)) {
      let next = d.dirs.find((x) => x.name === p)
      if (!next) {
        next = { name: p, path: d.path ? `${d.path}/${p}` : p, dirs: [], files: [] }
        d.dirs.push(next)
      }
      d = next
    }
    d.files.push(f)
  }
  const squash = (d: Dir): Dir => {
    d.dirs = d.dirs.map(squash)
    if (d.name && d.dirs.length === 1 && d.files.length === 0) {
      const c = d.dirs[0]
      return { ...c, name: `${d.name}/${c.name}` }
    }
    return d
  }
  return squash(root)
}

export const fileIcon = (path: string) =>
  path.endsWith('.java')
    ? '☕'
    : /\.(json|mcmeta)$/.test(path)
      ? '{}'
      : /\.(png)$/.test(path)
        ? '🖼'
        : /\.(ogg)$/.test(path)
          ? '🔊'
          : /gradle/.test(path)
            ? '🐘'
            : '📄'

function DirRow({ d, depth, open, toggle }: { d: Dir; depth: number; open: Set<string>; toggle: (p: string) => void }) {
  const active = useIde((s) => s.active)
  const isOpen = open.has(d.path)
  return (
    <>
      {d.name && (
        <button className="tree-row" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(d.path)}>
          <span className={`chev${isOpen ? ' open' : ''}`}>›</span>
          <span className="ellipsis">{d.name}</span>
        </button>
      )}
      {(isOpen || !d.name) && (
        <>
          {d.dirs
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((c) => (
              <DirRow key={c.path} d={c} depth={d.name ? depth + 1 : depth} open={open} toggle={toggle} />
            ))}
          {d.files.map((f) => (
            <button
              key={f.path}
              className={`tree-row file${active === `code:${f.path}` ? ' sel' : ''}`}
              style={{ paddingLeft: 8 + (d.name ? depth + 1 : depth) * 12 + 12 }}
              title={f.path}
              onClick={() => useIde.getState().openCode(f.path)}
            >
              <span className="tree-icon">{fileIcon(f.path)}</span>
              <span className="ellipsis">{f.path.split('/').pop()}</span>
              {f.generated !== undefined && (
                <span className="edited-mark" title="✎">
                  ✎
                </span>
              )}
            </button>
          ))}
        </>
      )}
    </>
  )
}

/** The generated Gradle project of the active target (what "Test in game" builds), read-only. */
export function CodeExplorer() {
  const { t } = useTranslation()
  const files = useIde((s) => s.files)
  const loading = useIde((s) => s.filesLoading)
  const error = useIde((s) => s.filesError)
  const target = useStore((s) => s.targets[s.activeTarget])
  const root = useMemo(() => tree(files), [files])
  const [open, setOpen] = useState<Set<string>>(new Set())
  // at first, open the folders down to the Java sources
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !files.length) return
    opened.current = true
    const dirs = new Set<string>()
    for (const f of files)
      if (f.path.endsWith('.java')) {
        const parts = f.path.split('/')
        for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
      }
    setOpen(dirs)
  }, [files])
  const toggle = (p: string) =>
    setOpen((o) => {
      const n = new Set(o)
      if (n.has(p)) n.delete(p)
      else n.add(p)
      return n
    })
  return (
    <div className="code-explorer">
      <div className="ce-head">
        <span className="grow">
          {t('ide.generated')} {target ? `· ${LOADER_LABEL[target.loader]} ${target.mc}` : ''}
        </span>
        <button className="btn ghost small" disabled={loading} onClick={() => void useIde.getState().refreshFiles()} title={t('ide.refresh')}>
          ⟳
        </button>
      </div>
      <p className="hint">{t('ide.readOnly')}</p>
      {error && <p className="hint warn">{error}</p>}
      {!files.length && loading && <p className="hint">…</p>}
      <div className="tree">
        <DirRow d={root} depth={0} open={open} toggle={toggle} />
      </div>
    </div>
  )
}
