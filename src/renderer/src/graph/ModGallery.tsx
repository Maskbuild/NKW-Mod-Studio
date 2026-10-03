import { useEffect, useRef, useState } from 'react'
import type { LinkedMod } from '@core/project'
import i18n, { L } from '../i18n'
import { api, type ItemSource, type ModSort, type ModrinthHit } from '../api'
import { useStore } from '../store'
import { ISearch } from '../components/Icons'
import { reloadSource } from './VanillaPanel'

type Role = NonNullable<LinkedMod['role']>

/** What a linked mod is for: a dependency of the mod, in test runs only, or the item list only. */
export const MOD_ROLES: { value: Role; en: string; th: string }[] = [
  { value: 'required', en: 'Required', th: 'ต้องลง (required)' },
  { value: 'optional', en: 'Optional', th: 'ตัวเสริม (optional)' },
  { value: 'test', en: 'Just install (test runs)', th: 'ลงเฉย ๆ (ตอนทดสอบ)' },
  { value: 'none', en: 'Item list only', th: 'ดูรายการไอเทมอย่างเดียว' }
]
/** The three ways the install button offers. */
const INSTALL_ROLES = MOD_ROLES.filter((r) => r.value !== 'none')

const SORTS: { value: ModSort; en: string; th: string }[] = [
  { value: 'relevance', en: 'Relevance', th: 'ตรงที่สุด' },
  { value: 'downloads', en: 'Downloads', th: 'ดาวน์โหลด' },
  { value: 'follows', en: 'Follows', th: 'ผู้ติดตาม' },
  { value: 'newest', en: 'Newest', th: 'ใหม่ล่าสุด' },
  { value: 'updated', en: 'Updated', th: 'อัปเดตล่าสุด' }
]
const VIEWS = [5, 10, 20, 50, 100]

const LOADER_NAME: Record<string, string> = { fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt' }
const ENV: Record<ModrinthHit['env'], { en: string; th: string; icon: string }> = {
  client: { en: 'Client', th: 'ฝั่งผู้เล่น', icon: '🖥' },
  server: { en: 'Server', th: 'ฝั่งเซิร์ฟเวอร์', icon: '🗄' },
  both: { en: 'Client and server', th: 'ผู้เล่นและเซิร์ฟเวอร์', icon: '🌐' },
  any: { en: 'Client or server', th: 'ผู้เล่นหรือเซิร์ฟเวอร์', icon: '🌐' }
}

/** Error text of an IPC call without Electron's prefix. */
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

/** "4 days ago" in the app's language. */
function ago(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const s = (t - Date.now()) / 1000
  const f = new Intl.RelativeTimeFormat(i18n.language === 'th' ? 'th' : 'en', { numeric: 'auto' })
  for (const [unit, secs] of [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ] as const)
    if (Math.abs(s) >= secs) return f.format(Math.round(s / secs), unit)
  return f.format(0, 'minute')
}

/** Adds mods to the project (mods already linked keep their settings). */
export function linkMods(add: LinkedMod[]) {
  const now = useStore.getState().mods
  const next = [...now, ...add.filter((m) => !now.some((x) => x.id === m.id))]
  if (next.length !== now.length) useStore.getState().setMods(next)
}

export function setModRole(id: string, role: Role) {
  const s = useStore.getState()
  s.setMods(s.mods.map((m) => (m.id === id ? { ...m, role } : m)))
}

/** Install button with the three ways (required, optional, just install); for a linked mod: change or remove. */
function InstallButton({ hit, onAdded }: { hit: ModrinthHit; onAdded: (source: ItemSource) => void }) {
  const linked = useStore((s) => s.mods.find((m) => m.id === hit.slug))
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const choose = (role: Role) => {
    setOpen(false)
    if (linked) setModRole(linked.id, role)
    else {
      linkMods([{ id: hit.slug, title: hit.title, source: 'modrinth', role }])
      onAdded(`mod:${hit.slug}`)
    }
  }
  const current = linked ? MOD_ROLES.find((r) => r.value === (linked.role ?? 'none')) : undefined
  return (
    <div className="mod-install" ref={box}>
      <button className={`btn${linked ? '' : ' primary'}`} onClick={() => setOpen((o) => !o)}>
        {linked ? `✓ ${L(current!)}` : `⬇ ${L({ en: 'Install', th: 'ติดตั้ง' })}`} ▾
      </button>
      {open && (
        <div className="mod-install-menu" role="menu">
          {(linked ? MOD_ROLES : INSTALL_ROLES).map((r) => (
            <button key={r.value} className={linked?.role === r.value ? 'on' : ''} onClick={() => choose(r.value)} role="menuitem">
              {L(r)}
            </button>
          ))}
          {linked && (
            <button
              className="danger"
              onClick={() => {
                setOpen(false)
                const s = useStore.getState()
                s.setMods(s.mods.filter((m) => m.id !== linked.id))
              }}
            >
              {L({ en: 'Remove from the project', th: 'เอาออกจากโปรเจกต์' })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function Tags({ hit, loader }: { hit: ModrinthHit; loader: string }) {
  const env = ENV[hit.env]
  return (
    <div className="mod-row-tags">
      <span className="mod-tag">
        {env.icon} {L(env)}
      </span>
      {hit.categories.map((c) => (
        <span key={c} className="mod-tag">
          {c.replace(/-/g, ' ').replace(/^\w/, (x) => x.toUpperCase())}
        </span>
      ))}
      {hit.loaders.map((l) => (
        <span key={l} className={`mod-tag loader-${l}${l === loader ? ' on' : ''}`}>
          {LOADER_NAME[l] ?? l}
        </span>
      ))}
    </div>
  )
}

function Row({ hit, loader, grid, onAdded }: { hit: ModrinthHit; loader: string; grid: boolean; onAdded: (source: ItemSource) => void }) {
  const linked = useStore((s) => s.mods.some((m) => m.id === hit.slug))
  return (
    <div className={`${grid ? 'mod-card' : 'mod-row'}${linked ? ' linked' : ''}`}>
      {grid && <div className="mod-card-img">{hit.image ? <img src={hit.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}</div>}
      <div className="mod-row-icon">
        {hit.icon ? <img src={hit.icon} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{hit.title.slice(0, 1)}</span>}
      </div>
      <div className="mod-row-main">
        <div className="mod-row-title">
          <button
            className="link"
            onClick={() => void api.openExternal(`https://modrinth.com/mod/${hit.slug}`)}
            title={L({ en: 'Open on Modrinth', th: 'เปิดใน Modrinth' })}
          >
            {hit.title}
          </button>
          {hit.author && (
            <span className="faint">
              {' '}
              {L({ en: 'by', th: 'โดย' })} {hit.author}
            </span>
          )}
        </div>
        <p className="mod-row-desc" title={hit.description}>
          {hit.description}
        </p>
        <Tags hit={hit} loader={loader} />
      </div>
      <div className="mod-row-side">
        <div className="mod-row-stats">
          <span title={L({ en: 'Downloads', th: 'ดาวน์โหลด' })}>⬇ {short(hit.downloads)}</span>
          <span title={L({ en: 'Followers', th: 'ผู้ติดตาม' })}>♡ {short(hit.follows)}</span>
        </div>
        {hit.updated && (
          <span className="faint" title={new Date(hit.updated).toLocaleString()}>
            ⟳ {ago(hit.updated)}
          </span>
        )}
        <InstallButton hit={hit} onAdded={onAdded} />
      </div>
    </div>
  )
}

/** 1 2 … 3836 › — pages around the current one. */
function Pager({ page, pages, go }: { page: number; pages: number; go: (p: number) => void }) {
  if (pages <= 1) return null
  const shown = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter((p) => p >= 0 && p < pages).sort((a, b) => a - b)
  const out: (number | 'gap')[] = []
  shown.forEach((p, i) => {
    if (i && p - shown[i - 1] > 1) out.push('gap')
    out.push(p)
  })
  return (
    <div className="mod-pager">
      <button className="btn ghost" disabled={page === 0} onClick={() => go(page - 1)}>
        ‹
      </button>
      {out.map((p, i) =>
        p === 'gap' ? (
          <span key={`g${i}`} className="faint">
            …
          </span>
        ) : (
          <button key={p} className={`btn ghost${p === page ? ' on' : ''}`} onClick={() => go(p)}>
            {p + 1}
          </button>
        )
      )}
      <button className="btn ghost" disabled={page >= pages - 1} onClick={() => go(page + 1)}>
        ›
      </button>
    </div>
  )
}

/** Full-window list of Modrinth mods for the project's Minecraft version and loader, plus .jar files on disk. */
export function ModGallery({ mc, onAdded, onClose }: { mc: string; onAdded: (source: ItemSource) => void; onClose: () => void }) {
  const loader = useStore((s) => s.targets[s.activeTarget]?.loader ?? 'fabric')
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ModSort>('relevance')
  const [view, setView] = useState(20)
  const [grid, setGrid] = useState(false)
  const [page, setPage] = useState(0)
  const [hits, setHits] = useState<ModrinthHit[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ask = useRef(0)
  const list = useRef<HTMLDivElement>(null)

  // search while typing (after a short pause), and on every page / sort / view change
  useEffect(() => {
    const n = ++ask.current
    const t = setTimeout(
      async () => {
        setBusy(true)
        setError(null)
        try {
          const r = await api.searchMods(q.trim(), mc, loader, sort, page * view, view)
          if (n !== ask.current) return
          setHits(r.hits)
          setTotal(r.total)
          list.current?.scrollTo(0, 0)
        } catch (e) {
          if (n === ask.current) setError(errText(e))
        } finally {
          if (n === ask.current) setBusy(false)
        }
      },
      q ? 400 : 0
    )
    return () => clearTimeout(t)
  }, [q, sort, view, page, mc, loader])
  useEffect(() => setPage(0), [q, sort, view, mc, loader])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const pick = async (folder: boolean) => {
    setBusy(true)
    try {
      const r = await api.importModJars(mc, folder)
      // picked files go into test runs; a whole mods folder is linked for its item list
      linkMods(
        r.mods.map((m) => ({
          id: m.id,
          title: m.title,
          source: 'file' as const,
          role: folder ? ('none' as const) : ('test' as const),
          ...(m.modId ? { modId: m.modId } : {})
        }))
      )
      for (const m of r.mods) reloadSource(`mod:${m.id}`, mc)
      if (r.errors.length) toast(r.errors.slice(0, 3).join('\n') + (r.errors.length > 3 ? `\n+${r.errors.length - 3}` : ''), true)
      if (r.mods.length) {
        toast(L({ en: `Added ${r.mods.length} mod(s)`, th: `เพิ่มแล้ว ${r.mods.length} ม็อด` }))
        onAdded(`mod:${r.mods[0].id}`)
      }
    } catch (e) {
      toast(errText(e), true)
    } finally {
      setBusy(false)
    }
  }

  const pages = Math.ceil(Math.min(total, 10000) / view)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog mod-gallery" role="dialog" aria-modal>
        <div className="mod-gallery-head">
          <h2>{L({ en: 'Add mods', th: 'เพิ่มม็อด' })}</h2>
          <span className="mod-tag on">
            Minecraft {mc} · {LOADER_NAME[loader] ?? loader}
          </span>
          <div className="grow" />
          <button className="btn" disabled={busy} onClick={() => void pick(false)}>
            {L({ en: 'Pick .jar files…', th: 'เลือกไฟล์ .jar…' })}
          </button>
          <button className="btn" disabled={busy} onClick={() => void pick(true)}>
            {L({ en: 'Pick a mods folder…', th: 'เลือกโฟลเดอร์ mods…' })}
          </button>
          <button className="btn ghost" onClick={onClose} title={L({ en: 'Close', th: 'ปิด' })}>
            ✕
          </button>
        </div>
        <div className="lib-search mod-search">
          <ISearch size={16} />
          <input className="input" autoFocus placeholder={L({ en: 'Search mods…', th: 'ค้นหาม็อด…' })} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="mod-gallery-bar">
          <label className="mod-select">
            <span>{L({ en: 'Sort by:', th: 'เรียงตาม:' })}</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as ModSort)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {L(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="mod-select">
            <span>{L({ en: 'View:', th: 'แสดง:' })}</span>
            <select value={view} onChange={(e) => setView(Number(e.target.value))}>
              {VIEWS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn ghost mod-layout"
            onClick={() => setGrid((g) => !g)}
            title={grid ? L({ en: 'List', th: 'แบบรายการ' }) : L({ en: 'Gallery', th: 'แบบแกลเลอรี' })}
          >
            {grid ? '☰' : '▦'}
          </button>
          <div className="grow" />
          <Pager page={page} pages={pages} go={setPage} />
        </div>
        <div ref={list} className={grid ? 'mod-gallery-grid' : 'mod-gallery-list'}>
          {hits.map((h) => (
            <Row key={h.slug} hit={h} loader={loader === 'quilt' ? 'quilt' : loader} grid={grid} onAdded={onAdded} />
          ))}
          {error && <p className="muted">{error}</p>}
          {!busy && !error && !hits.length && <p className="muted">{L({ en: 'No mods found for this version.', th: 'ไม่พบม็อดสำหรับเวอร์ชันนี้' })}</p>}
        </div>
        <div className="mod-gallery-foot">
          <span className="faint">{busy ? L({ en: 'Loading…', th: 'กำลังโหลด…' }) : `${total.toLocaleString()} ${L({ en: 'mods', th: 'ม็อด' })}`}</span>
          <span className="faint grow" style={{ textAlign: 'right' }}>
            {L({
              en: 'Required / Optional: the mod depends on it. Just install: only in "Test in game". Each test uses the build for its own Minecraft version and loader.',
              th: 'ต้องลง / ตัวเสริม: ม็อดของเราขึ้นกับม็อดนี้ · ลงเฉย ๆ: ใส่แค่ตอน "ทดสอบในเกม" · ทุกการทดสอบใช้เวอร์ชันที่ตรงกับ Minecraft และ loader ของตัวเอง'
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
