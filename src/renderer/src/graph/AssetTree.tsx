import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as RMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toId } from '@core/project'
import { api, assetUrl, type AssetEntry, type AssetKind, type AudioOptions } from '../api'
import { useStore } from '../store'
import { hasFiles, importDropped, NODE_FOR_KIND } from '../drop'
import { useAddCentered } from './Library'
import { IChevron, IFolder, IPlus, ITrash, IUpload } from '../components/Icons'

const ROOTS: { path: string; kind: AssetKind; icon: string; en: string; th: string }[] = [
  { path: 'textures', kind: 'texture', icon: '🖼', en: 'Textures', th: 'รูป / เท็กซ์เจอร์' },
  { path: 'models', kind: 'model', icon: '🧊', en: '3D models', th: 'โมเดล 3D' },
  { path: 'geo', kind: 'geo', icon: '🦾', en: 'GeckoLib models', th: 'โมเดล GeckoLib' },
  { path: 'animations', kind: 'animation', icon: '🎞', en: 'Animations', th: 'อนิเมชัน' },
  { path: 'sounds', kind: 'sound', icon: '🔊', en: 'Sounds', th: 'เสียง' }
]
const KIND_ICON: Record<AssetKind, string> = { texture: '🖼', model: '🧊', geo: '🦾', sound: '🔊', animation: '🎞' }

interface TreeNode {
  path: string
  name: string
  folder: boolean
  entry?: AssetEntry
  children: TreeNode[]
}

function buildTree(entries: AssetEntry[]): TreeNode[] {
  const roots: TreeNode[] = ROOTS.map((r) => ({ path: r.path, name: r.path, folder: true, children: [] }))
  const byPath = new Map(roots.map((r) => [r.path, r]))
  const ensure = (path: string): TreeNode => {
    const hit = byPath.get(path)
    if (hit) return hit
    const parent = ensure(path.slice(0, path.lastIndexOf('/')))
    const node: TreeNode = { path, name: path.slice(path.lastIndexOf('/') + 1), folder: true, children: [] }
    parent.children.push(node)
    byPath.set(path, node)
    return node
  }
  // geo models from older projects live in models/ with a _geo suffix — show them where they are
  for (const e of entries) {
    if (e.kind === 'folder') ensure(e.asset)
    else {
      const parent = ensure(e.asset.slice(0, e.asset.lastIndexOf('/')))
      parent.children.push({ path: e.asset, name: e.asset.slice(e.asset.lastIndexOf('/') + 1), folder: false, entry: e, children: [] })
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1))
    n.children.forEach(sort)
  }
  roots.forEach(sort)
  return roots
}

const fmtTime = (s?: number) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')
const extOf = (p: string) => p.slice(p.lastIndexOf('.'))
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const EXPAND_KEY = 'nkw.assetTree.open'

export function AssetTree() {
  const { t, i18n } = useTranslation()
  const th = i18n.language === 'th'
  const assets = useStore((s) => s.assets)
  const tree = useMemo(() => buildTree(assets), [assets])
  const [open, setOpen] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPAND_KEY) ?? '["textures","models","sounds"]') as string[])
    } catch {
      return new Set(['textures', 'models', 'sounds'])
    }
  })
  const [selected, setSelected] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  const [convert, setConvert] = useState(false)
  const addCentered = useAddCentered()

  useEffect(() => {
    try {
      localStorage.setItem(EXPAND_KEY, JSON.stringify([...open]))
    } catch {
      /* storage unavailable */
    }
  }, [open])

  const toggle = (p: string) => setOpen((o) => (o.has(p) ? new Set([...o].filter((x) => x !== p)) : new Set([...o, p])))
  const fail = (e: unknown) => useStore.getState().toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
  const afterChange = async () => {
    await useStore.getState().refreshAssets()
    await useStore.getState().save()
  }

  const selFolder = (): string => {
    if (!selected) return 'textures'
    const isFile = assets.some((a) => a.asset === selected && a.kind !== 'folder')
    return isFile ? dirOf(selected) : selected
  }

  const newFolder = async (inside = selFolder()) => {
    const taken = new Set(assets.map((a) => a.asset))
    let name = 'new_folder'
    for (let i = 2; taken.has(`${inside}/${name}`); i++) name = `new_folder_${i}`
    try {
      await api.makeFolder(`${inside}/${name}`)
      setOpen((o) => new Set([...o, inside]))
      await useStore.getState().refreshAssets()
      setRenaming(`${inside}/${name}`)
    } catch (e) {
      fail(e)
    }
  }

  const rename = async (node: TreeNode, raw: string) => {
    setRenaming(null)
    const clean = toId(raw.replace(/\.[a-z0-9]+$/i, ''))
    if (!clean || clean === 'unnamed') return
    const to = node.folder ? `${dirOf(node.path)}/${clean}` : `${dirOf(node.path)}/${clean}${extOf(node.path)}`
    if (to === node.path) return
    try {
      const changes = await api.moveAsset(node.path, to)
      useStore.getState().remapAssets(changes)
      setSelected(to)
      await afterChange()
    } catch (e) {
      fail(e)
    }
  }

  const remove = async (node: TreeNode) => {
    const msg = node.folder
      ? th
        ? `ย้ายโฟลเดอร์ "${node.name}" และไฟล์ข้างในไปถังขยะ?`
        : `Move folder "${node.name}" and everything in it to the Recycle Bin?`
      : th
        ? `ย้าย "${node.name}" ไปถังขยะ?`
        : `Move "${node.name}" to the Recycle Bin?`
    if (!window.confirm(msg)) return
    try {
      const gone = await api.deleteAsset(node.path)
      useStore.getState().dropAssets(gone)
      if (selected === node.path) setSelected(null)
      await afterChange()
    } catch (e) {
      fail(e)
    }
  }

  const move = async (from: string, intoFolder: string) => {
    if (from.split('/')[0] !== intoFolder.split('/')[0])
      return fail(new Error(th ? 'ย้ายได้เฉพาะภายในหมวดเดียวกัน' : 'Files can only move within their own section'))
    const name = from.slice(from.lastIndexOf('/') + 1)
    if (dirOf(from) === intoFolder || intoFolder.startsWith(`${from}/`) || intoFolder === from) return
    try {
      const changes = await api.moveAsset(from, `${intoFolder}/${name}`)
      useStore.getState().remapAssets(changes)
      setOpen((o) => new Set([...o, intoFolder]))
      await afterChange()
    } catch (e) {
      fail(e)
    }
  }

  const onDropFolder = async (e: DragEvent, folder: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDropOn(null)
    const internal = e.dataTransfer.getData('application/nkw-tree')
    if (internal) return void move(internal, folder)
    if (hasFiles(e)) {
      const imported = await importDropped(Array.from(e.dataTransfer.files), undefined, folder)
      if (imported.length) setOpen((o) => new Set([...o, folder]))
    }
  }

  const addNode = (e?: AssetEntry) => {
    if (!e || e.kind === 'folder') return
    addCentered(NODE_FOR_KIND[e.kind], { asset: e.asset, ...(e.seconds ? { seconds: e.seconds } : {}) })
  }

  const row = (node: TreeNode, depth: number) => {
    const isOpen = open.has(node.path)
    const root = depth === 0 ? ROOTS.find((r) => r.path === node.path) : undefined
    const e = node.entry
    const label = root ? (th ? root.th : root.en) : node.folder ? node.name : node.name.replace(/\.[a-z0-9]+$/, '')
    return (
      <div key={node.path}>
        <div
          className={`tree-row${selected === node.path ? ' sel' : ''}${dropOn === node.path ? ' drop' : ''}${root ? ' root' : ''}`}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable={!root && renaming !== node.path}
          tabIndex={0}
          onClick={() => {
            setSelected(node.path)
            if (node.folder) toggle(node.path)
          }}
          onDoubleClick={() => !node.folder && addNode(e)}
          onKeyDown={(ev) => {
            if (ev.key === 'F2' && !root) setRenaming(node.path)
            else if (ev.key === 'Delete' && !root) void remove(node)
            else if (ev.key === 'Enter' && !node.folder) addNode(e)
          }}
          onContextMenu={(ev: RMouseEvent) => {
            ev.preventDefault()
            setSelected(node.path)
            setMenu({ x: ev.clientX, y: ev.clientY, node })
          }}
          onDragStart={(ev) => {
            ev.dataTransfer.setData('application/nkw-tree', node.path)
            if (e && e.kind !== 'folder') ev.dataTransfer.setData('application/nkw-asset', `${e.kind}|${e.asset}`)
            ev.dataTransfer.effectAllowed = 'copyMove'
          }}
          onDragOver={(ev) => {
            if (!node.folder) return
            if (!hasFiles(ev) && !Array.from(ev.dataTransfer.types).includes('application/nkw-tree')) return
            ev.preventDefault()
            ev.stopPropagation()
            setDropOn(node.path)
          }}
          onDragLeave={() => setDropOn((d) => (d === node.path ? null : d))}
          onDrop={(ev) => node.folder && void onDropFolder(ev, node.path)}
          title={node.path}
        >
          {node.folder ? <IChevron size={12} className={`chev${isOpen ? ' open' : ''}`} /> : <span className="chev-space" />}
          {node.folder ? (
            <span className="tree-icon">{root ? root.icon : <IFolder size={14} />}</span>
          ) : e?.kind === 'texture' ? (
            <img className="pixel frame0 tree-thumb" src={assetUrl(e.asset)} alt="" draggable={false} />
          ) : (
            <span className="tree-icon">{e ? KIND_ICON[e.kind as AssetKind] : ''}</span>
          )}
          {renaming === node.path ? (
            <input
              className="input tree-rename"
              autoFocus
              defaultValue={label}
              onFocus={(ev) => ev.currentTarget.select()}
              onClick={(ev) => ev.stopPropagation()}
              onKeyDown={(ev) => {
                ev.stopPropagation()
                if (ev.key === 'Enter') void rename(node, ev.currentTarget.value)
                if (ev.key === 'Escape') setRenaming(null)
              }}
              onBlur={(ev) => void rename(node, ev.currentTarget.value)}
            />
          ) : (
            <span className="tree-name ellipsis">
              {label}
              {!node.folder && <span className="tree-ext">{node.name.slice(label.length)}</span>}
            </span>
          )}
          {e?.kind === 'sound' && <span className="faint">{fmtTime(e.seconds)}</span>}
          {root && <span className="faint">{countFiles(node)}</span>}
        </div>
        {node.folder && isOpen && node.children.map((c) => row(c, depth + 1))}
      </div>
    )
  }

  return (
    <div
      className="asset-tree"
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault()
      }}
      onDrop={(e) => {
        // dropped on empty space: import into the detected section's root
        if (!hasFiles(e)) return
        e.preventDefault()
        void importDropped(Array.from(e.dataTransfer.files))
      }}
    >
      <div className="row tree-tools">
        <button
          className="btn"
          title={t('ws.import')}
          onClick={async () => {
            try {
              const r = await api.importAny(selFolder())
              for (const e of r.errors) useStore.getState().toast(e, true)
              for (const a of r.imported) if (a.warning) useStore.getState().toast(`${a.name}: ${a.warning}`)
              await useStore.getState().refreshAssets()
            } catch (e) {
              fail(e)
            }
          }}
        >
          <IUpload size={13} /> {t('ws.import')}
        </button>
        <button className="btn" onClick={() => void newFolder()} title={t('ws.newFolder')}>
          <IPlus size={13} /> <IFolder size={13} />
        </button>
        <button className="btn" onClick={() => setConvert(true)} title={t('ws.convertAudio')}>
          🎵 {t('ws.convertShort')}
        </button>
      </div>
      <div className="drop-hint">{t('ws.treeHint')}</div>
      <div className="tree">{tree.map((n) => row(n, 0))}</div>

      {menu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 49 }}
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => (e.preventDefault(), setMenu(null))}
          />
          <div className="qa ctx" style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 170) }} role="menu">
            {!menu.node.folder && (
              <div className="qa-item" onMouseDown={() => (addNode(menu.node.entry), setMenu(null))}>
                <IPlus size={14} /> {t('ws.addToCanvas')}
              </div>
            )}
            {menu.node.folder && (
              <div className="qa-item" onMouseDown={() => (void newFolder(menu.node.path), setMenu(null))}>
                <IFolder size={14} /> {t('ws.newFolder')}
              </div>
            )}
            {!ROOTS.some((r) => r.path === menu.node.path) && (
              <>
                <div className="qa-item" onMouseDown={() => (setRenaming(menu.node.path), setMenu(null))}>
                  ✎ {t('ws.rename')} <small>F2</small>
                </div>
                <div className="qa-item danger" onMouseDown={() => (void remove(menu.node), setMenu(null))}>
                  <ITrash size={14} /> {t('ws.delete')} <small>Del</small>
                </div>
              </>
            )}
          </div>
        </>
      )}
      {convert && <ConvertDialog folder={selFolder().startsWith('sounds') ? selFolder() : 'sounds'} onClose={() => setConvert(false)} />}
    </div>
  )
}

function countFiles(n: TreeNode): number {
  return n.children.reduce((s, c) => s + (c.folder ? countFiles(c) : 1), 0)
}

/** Audio/video → OGG converter options (mono for positional sound, volume). */
function ConvertDialog({ folder, onClose }: { folder: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [opts, setOpts] = useState<AudioOptions>({ mono: true, volume: 1 })
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const run = async (files?: File[]) => {
    setBusy(true)
    try {
      const r = files ? await api.importFiles(files, 'sound', folder, opts) : await api.convertAudio(folder, opts)
      for (const e of r.errors) useStore.getState().toast(e, true)
      if (r.imported.length) {
        useStore.getState().toast(`✓ ${t('ws.converted', { count: r.imported.length })}`)
        await useStore.getState().refreshAssets()
        onClose()
      }
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="dialog"
        ref={box}
        style={{ width: 460 }}
        onDragOver={(e) => hasFiles(e) && e.preventDefault()}
        onDrop={(e) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          void run(Array.from(e.dataTransfer.files))
        }}
      >
        <h2>🎵 {t('ws.convertAudio')}</h2>
        <p className="muted" style={{ marginTop: -8 }}>
          {t('ws.convertInfo')}
        </p>
        <div className="set-row">
          <span>
            {t('ws.mono')}
            <div className="faint">{t('ws.monoHint')}</div>
          </span>
          <button className={`switch${opts.mono ? ' on' : ''}`} role="switch" aria-checked={opts.mono} onClick={() => setOpts({ ...opts, mono: !opts.mono })} />
        </div>
        <div className="set-row">
          <span>
            {t('ws.volume')} <b className="mono">{Math.round(opts.volume * 100)}%</b>
          </span>
          <input type="range" min={0.1} max={2} step={0.05} value={opts.volume} onChange={(e) => setOpts({ ...opts, volume: Number(e.target.value) })} />
        </div>
        <div className="faint" style={{ marginTop: 8 }}>
          {t('ws.saveTo')} <span className="mono">{folder}</span>
        </div>
        <div className="actions">
          <button className="btn" disabled={busy} onClick={onClose}>
            {t('wizard.cancel')}
          </button>
          <button className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? '…' : t('ws.pickAndConvert')}
          </button>
        </div>
      </div>
    </div>
  )
}
