import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api, assetUrl } from '../api'
import { useStore, type FlowNode } from '../store'
import { buildGeo, defaultSkin, mannequin, pixelTexture } from './playerModel3d'

const SIZES = [64, 128, 256, 512, 1024, 2048]
const T = (en: string, th: string, lang: string) => (lang === 'th' ? th : en)

/** Pixel size of a project PNG (null while loading or when it cannot be read). */
function useImageSize(asset: string): { w: number; h: number } | null | undefined {
  const [size, setSize] = useState<{ w: number; h: number } | null | undefined>(undefined)
  useEffect(() => {
    setSize(undefined)
    if (!asset) return setSize(null)
    let live = true
    const img = new Image()
    img.onload = () => live && setSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => live && setSize(null)
    img.src = assetUrl(asset)
    return () => {
      live = false
    }
  }, [asset])
  return size
}

const sizeOk = (s: { w: number; h: number } | null | undefined) => !!s && s.w === s.h && SIZES.includes(s.w)

/** A skin on the sample model: drag to turn it. Any size from 64 to 2048 works (UVs follow the 64-pixel layout). */
function SkinModel({ file, slim, spin }: { file: string; slim: boolean; spin: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{ scene: THREE.Scene; render: () => void; controls: OrbitControls } | null>(null)

  useEffect(() => {
    const el = host.current
    if (!el) return
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(el.clientWidth, el.clientHeight)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(32, el.clientWidth / Math.max(1, el.clientHeight), 0.5, 500)
    camera.position.set(-33, 28, -76)
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(-20, 40, -30)
    scene.add(sun)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 18, 0)
    controls.autoRotateSpeed = 2
    controls.update()
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    ctx.current = { scene, render, controls }
    let frame = 0
    const loop = () => {
      if (controls.autoRotate) controls.update()
      frame = requestAnimationFrame(loop)
    }
    frame = requestAnimationFrame(loop)
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      render()
    })
    ro.observe(el)
    render()
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ctx.current = null
    }
  }, [])

  useEffect(() => {
    if (ctx.current) ctx.current.controls.autoRotate = spin
  }, [spin])

  useEffect(() => {
    const c = ctx.current
    if (!c) return
    let skinTex: THREE.Texture = pixelTexture(new THREE.CanvasTexture(defaultSkin(slim)))
    const mat = new THREE.MeshLambertMaterial({ map: skinTex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    let live = true
    if (file)
      new THREE.TextureLoader().load(
        assetUrl(file),
        (t) => {
          if (!live) return t.dispose()
          skinTex.dispose()
          skinTex = pixelTexture(t)
          mat.map = skinTex
          mat.needsUpdate = true
          c.render()
        },
        undefined,
        () => undefined
      )
    // the model keeps the 64-pixel layout, so a 2048-pixel skin only has finer detail
    const body = buildGeo(mannequin(slim), 64, 64, mat, new Set(['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg']), () => null)
    c.scene.add(body)
    c.render()
    return () => {
      live = false
      c.scene.remove(body)
      body.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      mat.dispose()
      skinTex.dispose()
      c.render()
    }
  }, [file, slim])

  return <div ref={host} className="preview3d wardrobe-model" />
}

function SkinCard({ node, selected, onSelect, lang, sets }: { node: FlowNode; selected: boolean; onSelect: () => void; lang: string; sets: string[] }) {
  const textures = useStore((s) => s.assets).filter((a) => a.kind === 'texture')
  const d = node.data
  const str = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : '')
  const file = str('file')
  const open = str('openFile')
  const size = useImageSize(file)
  const openSize = useImageSize(open)
  const set = (patch: Record<string, unknown>) => useStore.getState().updateData(node.id, patch)
  const sizeLabel = (s: typeof size) => (s === undefined ? '…' : s ? `${s.w}×${s.h}` : '—')
  return (
    <div className={`skin-card${selected ? ' on' : ''}`} onClick={onSelect} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onSelect()}>
      <div className="row" style={{ gap: 8 }}>
        <div className="skin-face" style={file ? { backgroundImage: `url(${assetUrl(file)})` } : undefined} aria-hidden />
        <div className="grow">
          <input
            className="input"
            value={str('name')}
            placeholder="English"
            maxLength={60}
            onChange={(e) => set({ name: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
          <input
            className="input"
            style={{ marginTop: 4 }}
            value={str('nameTh')}
            placeholder="ไทย"
            maxLength={60}
            onChange={(e) => set({ nameTh: e.target.value })}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <span className={`badge${file && !sizeOk(size) && size !== undefined ? ' bad' : ''}`} title={T('Skin size', 'ขนาดสกิน', lang)}>
          {sizeLabel(size)}
        </span>
      </div>
      {selected && (
        <div className="skin-detail" onClick={(e) => e.stopPropagation()}>
          <div className="timer-row">
            <span className="timer-label">{T('Skin file', 'ไฟล์สกิน', lang)}</span>
            <select className="input" value={file} onChange={(e) => set({ file: e.target.value })}>
              <option value="">{T('— choose —', '— เลือก —', lang)}</option>
              {textures.map((a) => (
                <option key={a.asset} value={a.asset}>
                  {a.asset}
                </option>
              ))}
            </select>
          </div>
          {file && size !== undefined && !sizeOk(size) && (
            <div className="err-text">
              {T(
                'The skin must be a square PNG: 64, 128, 256, 512, 1024 or 2048 pixels.',
                'สกินต้องเป็น PNG จัตุรัส: 64, 128, 256, 512, 1024 หรือ 2048 พิกเซล',
                lang
              )}
            </div>
          )}
          <div className="timer-row">
            <span className="timer-label">{T('Mouth open', 'ปากเปิด', lang)}</span>
            <select className="input" value={open} onChange={(e) => set({ openFile: e.target.value })}>
              <option value="">{T('— none —', '— ไม่มี —', lang)}</option>
              {textures.map((a) => (
                <option key={a.asset} value={a.asset}>
                  {a.asset}
                </option>
              ))}
            </select>
            {open && <span className="faint">{sizeLabel(openSize)}</span>}
          </div>
          {open && file && openSize && size && (openSize.w !== size.w || openSize.h !== size.h) && (
            <div className="err-text">{T('The mouth-open skin should be the same size as the skin.', 'สกินปากเปิดควรมีขนาดเท่าสกินหลัก', lang)}</div>
          )}
          <div className="timer-row">
            <span className="timer-label">{T('Arms', 'แขน', lang)}</span>
            <div className="seg">
              <button className={str('model') !== 'slim' ? 'on' : ''} onClick={() => set({ model: 'wide' })}>
                {T('Wide', 'กว้าง', lang)}
              </button>
              <button className={str('model') === 'slim' ? 'on' : ''} onClick={() => set({ model: 'slim' })}>
                {T('Slim', 'เรียว', lang)}
              </button>
            </div>
          </div>
          <div className="timer-row">
            <span className="timer-label">{T('Figura set', 'ชุด Figura', lang)}</span>
            <input className="input" list={`sets-${node.id}`} value={str('set')} maxLength={40} onChange={(e) => set({ set: e.target.value })} />
            <datalist id={`sets-${node.id}`}>
              {sets.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>
      )}
    </div>
  )
}

/** The wardrobe: every Skin node as a card (names, picture, size check, Figura set) beside a model to look at the skin on. */
export function WardrobeEditor({ node }: { node: FlowNode }) {
  const { i18n } = useTranslation()
  const lang = i18n.language
  const nodes = useStore((s) => s.nodes)
  const skins = useMemo(() => nodes.filter((n) => n.type === 'skin'), [nodes])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mouth, setMouth] = useState(false)
  const [spin, setSpin] = useState(true)
  const [busy, setBusy] = useState(false)
  const selected = skins.find((s) => s.id === selectedId) ?? skins[0]
  const sets = useMemo(() => [...new Set(skins.map((s) => String(s.data.set ?? '').trim()).filter(Boolean))].sort(), [skins])
  const file = selected ? String(selected.data.file ?? '') : ''
  const open = selected ? String(selected.data.openFile ?? '') : ''
  const shown = mouth && open ? open : file
  const toast = useStore.getState().toast

  const add = () => {
    const n = skins.length + 1
    const id = useStore.getState().addNode('skin', { x: 120 + n * 30, y: 120 + n * 30 }, { name: `Skin ${n}`, id: `skin_${n}` })
    setSelectedId(id)
  }
  const exportFigura = async () => {
    setBusy(true)
    try {
      const r = await api.skinsExportFigura(
        skins.map((s) => ({
          id: String(s.data.id ?? ''),
          name: String(s.data.name ?? ''),
          file: String(s.data.file ?? ''),
          openFile: String(s.data.openFile ?? ''),
          slim: s.data.model === 'slim',
          set: String(s.data.set ?? '')
        }))
      )
      if (r) toast(T(`Figura avatars written to ${r.dir} (${r.avatars} avatar(s))`, `เขียนอวาตาร์ Figura ไว้ที่ ${r.dir} (${r.avatars} ชุด)`, lang))
    } catch (e) {
      toast(String((e as Error).message ?? e), true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wardrobe">
      <SkinModel file={shown} slim={selected?.data.model === 'slim'} spin={spin} />
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '6px 0' }}>
        <label className="check">
          <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> {T('Turn', 'หมุน', lang)}
        </label>
        <label className="check" title={open ? '' : T('This skin has no mouth-open picture', 'สกินนี้ไม่มีรูปปากเปิด', lang)}>
          <input type="checkbox" checked={mouth} disabled={!open} onChange={(e) => setMouth(e.target.checked)} /> {T('Mouth open', 'ปากเปิด', lang)}
        </label>
        <span className="grow" />
        <button className="btn small" onClick={add}>
          + {T('Skin', 'สกิน', lang)}
        </button>
      </div>
      {skins.length === 0 && <div className="empty">{T('No skins yet. Add one, then pick its PNG.', 'ยังไม่มีสกิน เพิ่มหนึ่งชุดแล้วเลือกไฟล์ PNG', lang)}</div>}
      <div className="skin-list">
        {skins.map((s) => (
          <SkinCard key={s.id} node={s} selected={s.id === selected?.id} onSelect={() => setSelectedId(s.id)} lang={lang} sets={sets} />
        ))}
      </div>
      <div className="timer-sub">{T('Figura', 'Figura', lang)}</div>
      <div className="faint">
        {sets.length
          ? T(`Sets: ${sets.join(', ')}. Skins with no set go into "all".`, `ชุด: ${sets.join(', ')} สกินที่ไม่มีชุดจะอยู่ใน "all"`, lang)
          : T('Skins with no set go into one avatar called "all".', 'สกินที่ไม่มีชุดจะอยู่ในอวาตาร์ชื่อ "all"', lang)}
      </div>
      <button className="btn small" style={{ marginTop: 6 }} disabled={busy || !skins.length} onClick={exportFigura}>
        {T('Export Figura avatars…', 'ส่งออกอวาตาร์ Figura…', lang)}
      </button>
      <div className="faint" style={{ marginTop: 4 }}>
        {T(
          'In game the mod stays out of the way of players who have a Figura avatar (if you left that on).',
          'ในเกมม็อดจะไม่ทับผู้เล่นที่มีอวาตาร์ Figura (ถ้าเปิดตัวเลือกนั้นไว้)',
          lang
        )}
      </div>
      <span hidden>{node.id}</span>
    </div>
  )
}
