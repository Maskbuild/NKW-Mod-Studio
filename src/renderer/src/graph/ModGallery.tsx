import { useEffect, useRef, useState } from 'react'
import type { LinkedMod } from '@core/project'
import { L } from '../i18n'
import { api, type ItemSource, type ModSort, type ModrinthHit } from '../api'
import { useStore } from '../store'
import { ISearch } from '../components/Icons'
import { reloadSource } from './VanillaPanel'

/** What a linked mod is for: the item list only, test runs, or a dependency of the mod (test runs too). */
export const MOD_ROLES: { value: NonNullable<LinkedMod['role']>; en: string; th: string }[] = [
  { value: 'none', en: 'Item list only', th: 'ดูรายการไอเทมอย่างเดียว' },
  { value: 'test', en: 'In test runs', th: 'ใส่ตอนทดสอบ' },
  { value: 'optional', en: 'Optional dependency', th: 'ตัวเลือก (optional)' },
  { value: 'required', en: 'Required dependency', th: 'ต้องมี (required)' }
]

const SORTS: { value: ModSort; en: string; th: string }[] = [
  { value: 'relevance', en: 'Relevance', th: 'ตรงที่สุด' },
  { value: 'downloads', en: 'Most downloads', th: 'ดาวน์โหลดมากสุด' },
  { value: 'follows', en: 'Most followed', th: 'ผู้ติดตามมากสุด' },
  { value: 'newest', en: 'Newest', th: 'ใหม่ล่าสุด' },
  { value: 'updated', en: 'Recently updated', th: 'อัปเดตล่าสุด' }
]

/** Error text of an IPC call without Electron's prefix. */
const errText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n))

/** Adds mods to the project, or changes what a linked mod is for. */
export function linkMods(add: LinkedMod[]) {
  const now = useStore.getState().mods
  const next = [...now, ...add.filter((m) => !now.some((x) => x.id === m.id))]
  if (next.length !== now.length) useStore.getState().setMods(next)
}

export function setModRole(id: string, role: NonNullable<LinkedMod['role']>) {
  const s = useStore.getState()
  s.setMods(s.mods.map((m) => (m.id === id ? { ...m, role } : m)))
}

function Card({ hit, loader, onAdded }: { hit: ModrinthHit; loader: string; onAdded: (source: ItemSource) => void }) {
  const linked = useStore((s) => s.mods.find((m) => m.id === hit.slug))
  const [role, setRole] = useState<NonNullable<LinkedMod['role']>>('test')
  const mrLoader = loader === 'quilt' ? 'fabric' : loader
  const fits = !hit.loaders.length || hit.loaders.includes(mrLoader) || hit.loaders.includes(loader)
  const picture = hit.image ?? hit.icon
  return (
    <div className={`mod-card${linked ? ' linked' : ''}`}>
      <div className="mod-card-img">
        {picture ? <img src={picture} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="mod-card-ph">{hit.title.slice(0, 1)}</span>}
        {hit.icon && hit.image && <img className="mod-card-icon" src={hit.icon} alt="" loading="lazy" referrerPolicy="no-referrer" />}
      </div>
      <div className="mod-card-body">
        <div className="mod-card-title" title={hit.title}>
          {hit.title}
        </div>
        <small className="faint">
          {hit.author && `${L({ en: 'by', th: 'โดย' })} ${hit.author} · `}⬇ {short(hit.downloads)}
        </small>
        <p className="mod-card-desc" title={hit.description}>
          {hit.description}
        </p>
        <div className="mod-card-tags">
          {hit.loaders.map((l) => (
            <span key={l} className={`mod-tag${l === mrLoader || l === loader ? ' on' : ''}`}>
              {l}
            </span>
          ))}
          {hit.categories.map((c) => (
            <span key={c} className="mod-tag faint">
              {c}
            </span>
          ))}
        </div>
        {!fits && (
          <small className="mod-card-warn">
            {L({ en: `No ${loader} build: the item list works, test runs leave it out.`, th: `ไม่มีเวอร์ชัน ${loader}: ดูรายการไอเทมได้ แต่ตอนทดสอบจะไม่ใส่` })}
          </small>
        )}
      </div>
      <div className="mod-card-foot">
        <select
          className="input"
          value={linked ? (linked.role ?? 'none') : role}
          onChange={(e) => {
            const v = e.target.value as NonNullable<LinkedMod['role']>
            if (linked) setModRole(linked.id, v)
            else setRole(v)
          }}
          title={L({ en: 'What the mod is for', th: 'ใช้ม็อดนี้ทำอะไร' })}
        >
          {MOD_ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {L(r)}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          disabled={!!linked}
          onClick={() => {
            linkMods([{ id: hit.slug, title: hit.title, source: 'modrinth', role }])
            onAdded(`mod:${hit.slug}`)
          }}
        >
          {linked ? L({ en: 'Added', th: 'เพิ่มแล้ว' }) : L({ en: 'Add', th: 'เพิ่ม' })}
        </button>
        <button
          className="btn ghost"
          title={L({ en: 'Open on Modrinth', th: 'เปิดใน Modrinth' })}
          onClick={() => void api.openExternal(`https://modrinth.com/mod/${hit.slug}`)}
        >
          ↗
        </button>
      </div>
    </div>
  )
}

/** Full-window gallery of Modrinth mods for a Minecraft version, plus picking .jar files on disk. */
export function ModGallery({ mc, onAdded, onClose }: { mc: string; onAdded: (source: ItemSource) => void; onClose: () => void }) {
  const loader = useStore((s) => s.targets[s.activeTarget]?.loader ?? 'fabric')
  const toast = useStore((s) => s.toast)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<ModSort>('relevance')
  const [hits, setHits] = useState<ModrinthHit[]>([])
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ask = useRef(0)

  const load = async (offset: number) => {
    const n = ++ask.current
    setBusy(true)
    setError(null)
    try {
      const r = await api.searchMods(q.trim(), mc, sort, offset)
      if (n !== ask.current) return
      setHits((h) => (offset ? [...h, ...r.hits] : r.hits))
      setTotal(r.total)
    } catch (e) {
      if (n === ask.current) setError(errText(e))
    } finally {
      if (n === ask.current) setBusy(false)
    }
  }
  // search while typing (a short pause first), and when the sort changes
  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 400 : 0)
    return () => clearTimeout(t)
  }, [q, sort, mc])
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])

  const pick = async (folder: boolean) => {
    setBusy(true)
    try {
      const r = await api.importModJars(mc, folder)
      // a whole mods folder is linked for its item list; picked files go into test runs
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

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog mod-gallery" role="dialog" aria-modal>
        <div className="mod-gallery-head">
          <h2>{L({ en: 'Add mods', th: 'เพิ่มม็อด' })}</h2>
          <span className="faint">
            Modrinth · Minecraft {mc} · {loader}
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
        <div className="row mod-gallery-bar">
          <div className="lib-search grow" style={{ marginBottom: 0 }}>
            <ISearch size={14} />
            <input
              className="input"
              autoFocus
              placeholder={L({ en: 'Search mods on Modrinth', th: 'ค้นหาม็อดใน Modrinth' })}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="input" style={{ width: 170 }} value={sort} onChange={(e) => setSort(e.target.value as ModSort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {L(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="mod-gallery-grid">
          {hits.map((h) => (
            <Card key={h.slug} hit={h} loader={loader} onAdded={onAdded} />
          ))}
        </div>
        {error && <p className="muted">{error}</p>}
        {!busy && !error && !hits.length && <p className="muted">{L({ en: 'No mods found for this version.', th: 'ไม่พบม็อดสำหรับเวอร์ชันนี้' })}</p>}
        <div className="mod-gallery-foot">
          {busy ? (
            <span className="faint">{L({ en: 'Loading…', th: 'กำลังโหลด…' })}</span>
          ) : (
            hits.length < total && (
              <button className="btn" onClick={() => void load(hits.length)}>
                {L({ en: `Show more (${hits.length} of ${total.toLocaleString()})`, th: `ดูเพิ่ม (${hits.length} จาก ${total.toLocaleString()})` })}
              </button>
            )
          )}
          <span className="faint grow" style={{ textAlign: 'right' }}>
            {L({
              en: 'Item list only: names, icons, tags and crops for the editor. Test runs / dependencies add the mod to "Test in game".',
              th: 'ดูรายการไอเทม: ชื่อ ไอคอน แท็ก พืช ไว้ใช้ในแอป · ใส่ตอนทดสอบ / dependency: ใส่ม็อดตอนกด "ทดสอบในเกม"'
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
