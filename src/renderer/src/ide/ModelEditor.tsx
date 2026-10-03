import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import type { JavaModel } from '@core/gen/model'
import { textureKeys } from '@core/gen/model'
import { rotAxis, type Face, type V3 } from '@core/gen/faces'
import { ANGLES, FACES, boxUnwrap, faceQuad, faceUv, floodFill, moveBy, newCube, normalize, toSaved, uvToPixel, type EditElement } from '@core/modelEdit'
import { api, assetUrl } from '../api'
import { useStore } from '../store'
import { gestureFor, keyName, type ModelControls, type ToolKey } from '@core/modelControls'
import { command } from './CommandPalette'
import { useIde } from './ideStore'

type Model = JavaModel & { elements: EditElement[] }
type Mode = 'select' | 'move' | 'resize' | 'rotate' | 'paint'

/** What the middle of the editor shows. */
type View = '3d' | 'uv' | 'both'

const PREFS = 'nkw.modelEditor'
function loadView(): View {
  try {
    const v = (JSON.parse(localStorage.getItem(PREFS) ?? '{}') as { view?: View }).view
    return v === 'uv' || v === 'both' ? v : '3d'
  } catch {
    return '3d'
  }
}
function saveView(view: View) {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ view }))
  } catch {
    /* not remembered */
  }
}

/** Editor tool of each key binding. */
const TOOL_OF: Record<Exclude<ToolKey, 'frame' | 'frameAll'>, Mode> = { select: 'select', move: 'move', scale: 'resize', rotate: 'rotate', paint: 'paint' }
const KEY_OF_MODE: Record<Mode, ToolKey> = { select: 'select', move: 'move', resize: 'scale', rotate: 'rotate', paint: 'paint' }

type Tool = 'pencil' | 'eraser' | 'fill' | 'picker'

/** One texture being edited: an offscreen canvas shared by the 3D view and the 2D painter. */
interface Tex {
  canvas: HTMLCanvasElement
  three: THREE.CanvasTexture
  dirty: boolean
  /** bumped on every change so React redraws the 2D view */
  rev: number
}

const FACE_ORDER: Face[] = FACES
const SLOTS = ['0', '1', '2', '3']
const hex = (rgba: number[]) =>
  '#' +
  rgba
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
const rgbaOf = (h: string): number[] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255]

/** Geometry of one cube (rotation baked in), one group per face in FACE_ORDER, 0–1 UVs (v up). */
function cubeGeometry(el: EditElement): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const g = new THREE.BufferGeometry()
  FACE_ORDER.forEach((f, i) => {
    let { corners } = faceQuad(el, f)
    const q = faceQuad(el, f).uv
    if (el.rotation) corners = corners.map((p) => rotAxis(p, el.rotation!.axis, el.rotation!.angle, el.rotation!.origin as V3))
    corners.forEach((p, k) => {
      pos.push(p[0] - 8, p[1] - 8, p[2] - 8)
      uv.push(q[k][0], 1 - q[k][1])
    })
    const b = i * 4
    index.push(b, b + 3, b + 1, b + 1, b + 3, b + 2)
    if (el.faces[f]) g.addGroup(i * 6, 6, i)
  })
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** Orbit camera around a target: turned, panned and zoomed by the editor's own mouse handling. */
interface Camera {
  target: THREE.Vector3
  radius: number
  orbit(dx: number, dy: number): void
  pan(dx: number, dy: number): void
  zoom(delta: number): void
  update(): void
}
function makeCamera(camera: THREE.PerspectiveCamera, render: () => void, ctl: () => ModelControls): Camera {
  const s = new THREE.Spherical().setFromVector3(camera.position)
  const cam: Camera = {
    target: new THREE.Vector3(),
    radius: s.radius,
    orbit(dx, dy) {
      const c = ctl()
      s.theta -= dx * 0.008 * c.orbitSpeed * (c.invertX ? -1 : 1)
      s.phi = Math.min(Math.PI - 0.05, Math.max(0.05, s.phi - dy * 0.008 * c.orbitSpeed * (c.invertY ? -1 : 1)))
      cam.update()
    },
    pan(dx, dy) {
      const c = ctl()
      const k = cam.radius * 0.0016 * c.panSpeed
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1)
      cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k)
      cam.update()
    },
    zoom(delta) {
      const c = ctl()
      cam.radius = Math.min(250, Math.max(2, cam.radius * Math.exp(delta * 0.0012 * c.zoomSpeed * (c.invertZoom ? -1 : 1))))
      cam.update()
    },
    update() {
      s.radius = cam.radius
      camera.position.setFromSpherical(s).add(cam.target)
      camera.lookAt(cam.target)
      camera.updateMatrixWorld()
      render()
    }
  }
  return cam
}

/** Where a texture slot points in the project (models saved here store "textures/name"). */
const assetOfRef = (ref: string | undefined, all: string[]): string | null => {
  if (!ref) return null
  const direct = `${ref.replace(/^[a-z0-9_]+:/, '')}.png`
  if (all.includes(direct)) return direct
  const base = ref.split('/').pop()
  return all.find((a) => a.split('/').pop() === `${base}.png`) ?? null
}

/**
 * A simple Blockbench: cubes you move / resize with the arrows (or exact numbers), per-face texture and UV,
 * and pixel painting on the texture (2D or straight on the model). Saves a Java block/item model.
 */
export function ModelEditor({ path, wired }: { path: string; wired?: (string | null)[] }) {
  const { t } = useTranslation()
  const assets = useStore((s) => s.assets)
  const textureAssets = useMemo(() => assets.filter((a) => a.kind === 'texture').map((a) => a.asset), [assets])

  const [model, setModel] = useState<Model | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null])
  const [sel, setSel] = useState<number | null>(0)
  const [face, setFace] = useState<Face>('north')
  const [mode, setMode] = useState<Mode>('move')
  const [view, setViewState] = useState(loadView)
  const setView = (v: View) => {
    setViewState(v)
    saveView(v)
  }
  const controls = useStore((s) => s.settings!.modelControls)
  const controlsRef = useRef(controls)
  controlsRef.current = controls
  const [tool, setTool] = useState<Tool>('pencil')
  const [color, setColor] = useState('#e11d48')
  const [recent, setRecent] = useState<string[]>(['#e11d48', '#111827', '#ffffff', '#f59e0b', '#22c55e', '#3b82f6'])
  const [snap, setSnap] = useState(1)
  const [dirty, setDirty] = useState(false)
  const [, setTexRev] = useState(0)
  const past = useRef<Model[]>([])
  const modelRef = useRef<Model | null>(null)
  modelRef.current = model
  const future = useRef<Model[]>([])
  const texs = useRef(new Map<string, Tex>())
  const [activeSlot, setActiveSlot] = useState(0)
  // tell the tab bar about unsaved changes
  useEffect(() => {
    useIde.setState((s) => ({ unsaved: { ...s.unsaved, [`model:${path}`]: dirty } }))
  }, [dirty, path])

  // ── load ──
  useEffect(() => {
    let off = false
    void api.readModel(path).then(
      (raw) => {
        if (off) return
        const m = raw as Model
        m.elements = (m.elements ?? []).map((e, i) => ({ name: e.name ?? `cube_${i + 1}`, ...e }))
        const keys = textureKeys(m)
        const all = useStore
          .getState()
          .assets.filter((a) => a.kind === 'texture')
          .map((a) => a.asset)
        setSlots(SLOTS.map((_, i) => wired?.[i] ?? assetOfRef(m.textures?.[keys[i] ?? String(i)], all)))
        setModel(m)
        setSel(m.elements.length ? 0 : null)
      },
      (e: Error) => setError(e.message)
    )
    return () => {
      off = true
    }
  }, [path])

  /** Texture slots in the model: their keys (#0 …) in order. */
  const keys = useMemo(() => (model ? textureKeys(model) : []), [model])
  const slotKey = (i: number) => keys[i] ?? String(i)

  // ── textures as canvases ──
  const texFor = useCallback((asset: string | null): Tex | null => {
    if (!asset) return null
    let tx = texs.current.get(asset)
    if (!tx) {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const three = new THREE.CanvasTexture(canvas)
      three.magFilter = THREE.NearestFilter
      three.minFilter = THREE.NearestFilter
      three.colorSpace = THREE.SRGBColorSpace
      tx = { canvas, three, dirty: false, rev: 0 }
      texs.current.set(asset, tx)
      const img = new Image()
      // CORS-clean, so WebGL can use it and it can be saved again
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d')!.drawImage(img, 0, 0)
        three.dispose()
        three.needsUpdate = true
        tx!.rev++
        setTexRev((r) => r + 1)
      }
      img.src = `${assetUrl(asset)}?v=${Date.now()}`
    }
    return tx
  }, [])

  // ── history ──
  const commit = useCallback((next: Model) => {
    setModel((cur) => {
      if (cur) {
        past.current.push(cur)
        if (past.current.length > 100) past.current.shift()
      }
      future.current = []
      return next
    })
    setDirty(true)
  }, [])
  const undo = () => {
    const prev = past.current.pop()
    if (!prev || !model) return
    future.current.push(model)
    setModel(prev)
    setDirty(true)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next || !model) return
    past.current.push(model)
    setModel(next)
    setDirty(true)
  }
  const updateEl = (i: number, patch: Partial<EditElement>, normal = true) => {
    if (!model) return
    const elements = model.elements.map((e, k) => (k === i ? (normal ? normalize({ ...e, ...patch }) : { ...e, ...patch }) : e))
    commit({ ...model, elements })
  }

  // ── save ──
  const save = async () => {
    if (!model) return
    try {
      const textures: Record<string, string> = {}
      SLOTS.forEach((_, i) => {
        const a = slots[i]
        if (a || keys[i]) textures[slotKey(i)] = a ? a.replace(/\.png$/, '') : (model.textures?.[slotKey(i)] ?? 'missing')
      })
      if (textures['0']) textures.particle = textures['0']
      await api.writeModel(path, toSaved({ ...model, textures }) as Record<string, unknown>)
      for (const [asset, tx] of texs.current)
        if (tx.dirty) {
          await api.writeTexture(asset, tx.canvas.toDataURL('image/png').split(',')[1])
          tx.dirty = false
        }
      setDirty(false)
      await useStore.getState().refreshAssets()
      useStore.getState().toast(t('model.saved'))
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  const undoRef = useRef({ undo, redo })
  undoRef.current = { undo, redo }

  // keys while this editor is the open tab
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (useIde.getState().active !== `model:${path}`) return
      const el = e.target as HTMLElement
      if (el?.closest?.('input, textarea, select')) return
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 's') (e.preventDefault(), void saveRef.current())
      else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) (e.preventDefault(), undoRef.current.undo())
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) (e.preventDefault(), undoRef.current.redo())
      else if (!ctrl && !e.altKey) {
        const k = keyName(e.key)
        const binds = controlsRef.current.keys
        if (k === binds.frame) frameRef.current(false)
        else if (k === binds.frameAll) frameRef.current(true)
        else {
          const tool = (Object.keys(TOOL_OF) as (keyof typeof TOOL_OF)[]).find((t) => binds[t] === k)
          if (tool) setMode(TOOL_OF[tool])
        }
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [path])

  // ── paint ──
  const paintAt = useCallback(
    (asset: string | null, x: number, y: number, first: boolean) => {
      const tx = texFor(asset)
      if (!tx) return
      const ctx = tx.canvas.getContext('2d')!
      if (tool === 'picker') {
        const d = ctx.getImageData(x, y, 1, 1).data
        if (d[3] > 0) setColor(hex(Array.from(d)))
        return
      }
      if (tool === 'fill') {
        if (!first) return
        const img = ctx.getImageData(0, 0, tx.canvas.width, tx.canvas.height)
        floodFill(img.data, img.width, img.height, x, y, rgbaOf(color))
        ctx.putImageData(img, 0, 0)
      } else if (tool === 'eraser') ctx.clearRect(x, y, 1, 1)
      else {
        ctx.fillStyle = color
        ctx.fillRect(x, y, 1, 1)
      }
      if (first && tool !== 'eraser') setRecent((r) => [color, ...r.filter((c) => c !== color)].slice(0, 12))
      tx.three.needsUpdate = true
      tx.dirty = true
      tx.rev++
      setTexRev((r) => r + 1)
      setDirty(true)
    },
    [tool, color, texFor]
  )

  // ── 3D view ──
  /** F: point the camera at the selected cube; A: at the whole model (Maya's frame selected / all). */
  const frame = (all: boolean) => {
    const th = three.current
    const m = modelRef.current
    if (!th || !m || !m.elements.length) return
    const els = all || selRef.current === null ? m.elements : [m.elements[selRef.current]]
    const lo = [0, 1, 2].map((a) => Math.min(...els.map((e) => e.from[a])))
    const hi = [0, 1, 2].map((a) => Math.max(...els.map((e) => e.to[a])))
    const center = new THREE.Vector3((lo[0] + hi[0]) / 2 - 8, (lo[1] + hi[1]) / 2 - 8, (lo[2] + hi[2]) / 2 - 8)
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 2)
    th.cam.target.copy(center)
    th.cam.radius = size * 2.2 + 4
    th.cam.update()
  }
  const frameRef = useRef(frame)
  frameRef.current = frame
  const selRef = useRef(sel)
  selRef.current = sel
  const host = useRef<HTMLDivElement>(null)
  const three = useRef<{
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    renderer: THREE.WebGLRenderer
    cam: Camera
    gizmo: TransformControls
    handle: THREE.Object3D
    group: THREE.Group
    render: () => void
  } | null>(null)
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000)
    camera.position.set(24, 20, 30)
    scene.add(new THREE.AmbientLight(0xffffff, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(18, 40, 25)
    scene.add(sun)
    // the block space: floor grid (1 px) and the 16×16×16 outline
    const grid = new THREE.GridHelper(16, 16, 0x888888, 0x555555)
    grid.position.y = -8
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.45
    scene.add(grid)
    const block = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 16, 16)),
      new THREE.LineBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.35 })
    )
    scene.add(block)
    const axes = new THREE.AxesHelper(6)
    axes.position.set(-8, -8, -8)
    scene.add(axes)
    const group = new THREE.Group()
    scene.add(group)
    const render0 = () => renderer.render(scene, camera)
    const cam = makeCamera(camera, render0, () => controlsRef.current)
    const handle = new THREE.Object3D()
    scene.add(handle)
    const gizmo = new TransformControls(camera, renderer.domElement)
    gizmo.setSize(0.8)
    scene.add(gizmo.getHelper())
    const render = () => renderer.render(scene, camera)
    gizmo.addEventListener('change', render)
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      render()
    })
    ro.observe(el)
    three.current = { scene, camera, renderer, cam, gizmo, handle, group, render }
    cam.update()
    return () => {
      ro.disconnect()
      gizmo.detach()
      gizmo.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      three.current = null
    }
  }, [])

  // rebuild the cubes whenever the model or textures change
  const texRevs = SLOTS.map((_, i) => texFor(slots[i])?.rev ?? -1).join(',')
  useEffect(() => {
    const th = three.current
    if (!th || !model) return
    for (const c of [...th.group.children]) {
      th.group.remove(c)
      const m = c as THREE.Mesh
      m.geometry?.dispose()
    }
    const blank = new THREE.MeshLambertMaterial({ color: 0x9ca3af })
    const mats = SLOTS.map((_, i) => {
      const tx = texFor(slots[i])
      return tx ? new THREE.MeshLambertMaterial({ map: tx.three, transparent: true, alphaTest: 0.05, side: THREE.DoubleSide }) : blank
    })
    model.elements.forEach((e, i) => {
      const faceMats = FACE_ORDER.map((f) => {
        const ref = e.faces[f]?.texture?.replace(/^#/, '') ?? '0'
        const slot = Math.max(0, keys.indexOf(ref) >= 0 ? keys.indexOf(ref) : Number(ref) || 0)
        return mats[slot] ?? blank
      })
      const mesh = new THREE.Mesh(cubeGeometry(e), faceMats)
      mesh.userData.index = i
      th.group.add(mesh)
      if (i === sel) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xf59e0b }))
        edges.userData.outline = true
        th.group.add(edges)
      }
    })
    // the gizmo sits on the selected cube's centre
    const s = sel !== null ? model.elements[sel] : null
    const gizmoMode = mode === 'move' ? 'translate' : mode === 'resize' ? 'scale' : mode === 'rotate' ? 'rotate' : null
    if (s && gizmoMode && !th.gizmo.dragging) {
      th.handle.position.set((s.from[0] + s.to[0]) / 2 - 8, (s.from[1] + s.to[1]) / 2 - 8, (s.from[2] + s.to[2]) / 2 - 8)
      th.handle.scale.set(1, 1, 1)
      th.handle.rotation.set(0, 0, 0)
      if (s.rotation) th.handle.rotation[s.rotation.axis] = THREE.MathUtils.degToRad(s.rotation.angle)
      th.gizmo.setMode(gizmoMode)
      th.gizmo.setRotationSnap(THREE.MathUtils.degToRad(22.5))
      th.gizmo.attach(th.handle)
    } else if (!s || !gizmoMode) th.gizmo.detach()
    th.render()
  }, [model, sel, slots, mode, keys, texRevs, texFor])

  // gizmo drags change the cube (snapped); one history step per drag
  useEffect(() => {
    const th = three.current
    if (!th || sel === null) return
    // the state at the start of each drag
    let start: Model | null = null
    let base: EditElement | null = null
    let c0: number[] = []
    let size0: number[] = []
    let moved: Model | null = null
    const onDown = () => {
      start = modelRef.current
      base = start?.elements[sel] ?? null
      if (!base) return
      c0 = base.from.map((v, i) => (v + base!.to[i]) / 2)
      size0 = base.from.map((v, i) => base!.to[i] - v)
    }
    const onChange = () => {
      if (!start || !base) return
      const h = th.handle
      let el: EditElement
      if (th.gizmo.mode === 'rotate') {
        // Java models turn around one axis only: the one turned the most, snapped to 22.5°
        const r = { x: h.rotation.x, y: h.rotation.y, z: h.rotation.z }
        const axis = (['x', 'y', 'z'] as const).reduce((a, b) => (Math.abs(r[b]) > Math.abs(r[a]) ? b : a), 'y')
        const angle = Math.max(-45, Math.min(45, Math.round(THREE.MathUtils.radToDeg(r[axis]) / 22.5) * 22.5))
        el = normalize({ ...base, rotation: { axis, angle, origin: base.rotation?.origin ?? c0 } })
      } else if (th.gizmo.mode === 'scale') {
        const s = [h.scale.x, h.scale.y, h.scale.z]
        const size = size0.map((v, i) => Math.max(snap, Math.round((v * s[i]) / snap) * snap))
        el = normalize({ ...base, from: c0.map((c, i) => c - size[i] / 2), to: c0.map((c, i) => c + size[i] / 2) })
      } else {
        const d = [h.position.x + 8 - c0[0], h.position.y + 8 - c0[1], h.position.z + 8 - c0[2]].map((v) => Math.round(v / snap) * snap)
        el = moveBy(base, d)
      }
      moved = { ...start, elements: start.elements.map((e, k) => (k === sel ? el : e)) }
      setModel(moved)
    }
    const onUp = () => {
      if (!moved || !start) return
      past.current.push(start)
      future.current = []
      setDirty(true)
      moved = null
    }
    th.gizmo.addEventListener('mouseDown', onDown)
    th.gizmo.addEventListener('objectChange', onChange)
    th.gizmo.addEventListener('mouseUp', onUp)
    return () => {
      th.gizmo.removeEventListener('mouseDown', onDown)
      th.gizmo.removeEventListener('objectChange', onChange)
      th.gizmo.removeEventListener('mouseUp', onUp)
    }
  }, [sel, snap])

  // mouse: navigation from the control settings; the left button alone selects, drags the gizmo or paints
  useEffect(() => {
    const th = three.current
    if (!th) return
    const dom = th.renderer.domElement
    const wrap = host.current!
    const ray = new THREE.Raycaster()
    const hit = (e: PointerEvent) => {
      const r = dom.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), th.camera)
      return ray.intersectObjects(
        th.group.children.filter((ch) => !ch.userData.outline),
        false
      )[0]
    }
    const paintHit = (e: PointerEvent, first: boolean) => {
      const h = hit(e)
      if (!h || !model || h.faceIndex === undefined || h.faceIndex === null || !h.uv) return
      const idx = h.object.userData.index as number
      const fc = FACE_ORDER[Math.floor(h.faceIndex / 2)]
      const ref = model.elements[idx].faces[fc]?.texture?.replace(/^#/, '') ?? '0'
      const slot = Math.max(0, keys.indexOf(ref) >= 0 ? keys.indexOf(ref) : Number(ref) || 0)
      const tx = texFor(slots[slot])
      if (!tx) return
      const [x, y] = uvToPixel(h.uv.x, 1 - h.uv.y, tx.canvas.width, tx.canvas.height)
      if (first) {
        setSel(idx)
        setFace(fc)
        setActiveSlot(slot)
      }
      paintAt(slots[slot], x, y, first)
    }
    const plain = (e: PointerEvent) => !e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey
    let painting = false
    let click: [number, number] | null = null
    // a navigation drag; a plain left drag only becomes one after moving a little (a click selects)
    let nav: { kind: 'orbit' | 'pan' | 'zoom'; x: number; y: number; sx: number; sy: number; started: boolean } | null = null
    // capture: runs before the gizmo sees the press
    const down = (e: PointerEvent) => {
      const ctl = controlsRef.current
      if (mode === 'paint' && e.button === 0 && plain(e)) {
        painting = true
        paintHit(e, true)
        e.stopPropagation()
        return
      }
      let g = gestureFor(ctl, e.button, e)
      // painting takes the plain left button: a plain-left orbit moves to the right button
      if (mode === 'paint' && ctl.orbit.button === 'left' && ctl.orbit.mod === 'none') g = e.button === 2 && plain(e) ? 'orbit' : g === 'orbit' ? null : g
      const leftPlain = e.button === 0 && plain(e)
      if (leftPlain && th.gizmo.axis) return
      if (g) {
        nav = { kind: g, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, started: !leftPlain }
        if (nav.started) e.stopPropagation()
      }
      if (leftPlain) click = [e.clientX, e.clientY]
    }
    const move = (e: PointerEvent) => {
      if (painting) {
        if (tool !== 'fill') paintHit(e, false)
        return
      }
      if (!nav) return
      if (!nav.started) {
        if (Math.hypot(e.clientX - nav.sx, e.clientY - nav.sy) < 4) return
        nav.started = true
        click = null
      }
      const dx = e.clientX - nav.x
      const dy = e.clientY - nav.y
      nav.x = e.clientX
      nav.y = e.clientY
      if (nav.kind === 'orbit') th.cam.orbit(dx, dy)
      else if (nav.kind === 'pan') th.cam.pan(dx, dy)
      else th.cam.zoom(dy * 3)
    }
    const up = (e: PointerEvent) => {
      painting = false
      if (click && !th.gizmo.dragging && Math.hypot(e.clientX - click[0], e.clientY - click[1]) < 4) {
        const h = hit(e)
        if (h) {
          setSel(h.object.userData.index as number)
          if (h.faceIndex !== undefined && h.faceIndex !== null) setFace(FACE_ORDER[Math.floor(h.faceIndex / 2)])
        }
      }
      click = null
      nav = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      th.cam.zoom(e.deltaY)
    }
    const noMenu = (e: MouseEvent) => e.preventDefault()
    wrap.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    wrap.addEventListener('wheel', wheel, { passive: false })
    wrap.addEventListener('contextmenu', noMenu)
    return () => {
      wrap.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      wrap.removeEventListener('wheel', wheel)
      wrap.removeEventListener('contextmenu', noMenu)
    }
  }, [mode, model, slots, keys, paintAt, texFor, tool])

  // ── UV editing (UV view) ──
  const uvStart = useRef<Model | null>(null)
  const setFaceUv = (i: number, f: Face, uv: number[] | null, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      uvStart.current = modelRef.current
      return
    }
    if (phase === 'end') {
      if (uvStart.current && uvStart.current !== modelRef.current) {
        past.current.push(uvStart.current)
        future.current = []
      }
      uvStart.current = null
      return
    }
    const m = modelRef.current
    if (!m || !uv) return
    setModel({ ...m, elements: m.elements.map((e, k) => (k === i ? { ...e, faces: { ...e.faces, [f]: { ...e.faces[f], uv } } } : e)) })
    setDirty(true)
  }
  /** Lays out the faces using the active texture slot as unfolded boxes. */
  const unwrap = (all: boolean) => {
    if (!model) return
    const ref = '#' + slotKey(activeSlot)
    const idx = all ? model.elements.map((_, i) => i) : sel !== null ? [sel] : []
    if (!idx.length) return
    commit({ ...model, elements: boxUnwrap(model.elements, idx, ref) })
  }
  const resetUv = () => {
    if (!model || sel === null) return
    const e = model.elements[sel]
    const faces = Object.fromEntries(Object.entries(e.faces).map(([k, v]) => [k, v ? (({ uv: _uv, ...rest }) => rest)(v) : v]))
    updateEl(sel, { faces }, false)
  }

  if (error)
    return (
      <div className="model-editor">
        <p className="hint warn">{error}</p>
      </div>
    )
  const el = model && sel !== null ? model.elements[sel] : null
  const fc = el?.faces[face]
  const slotOfFace = (f: Face) => {
    const ref = el?.faces[f]?.texture?.replace(/^#/, '') ?? '0'
    return Math.max(0, keys.indexOf(ref) >= 0 ? keys.indexOf(ref) : Number(ref) || 0)
  }
  const num = (v: number, set: (n: number) => void, step = snap) => (
    <input className="input num" type="number" step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
  )

  return (
    <div className="model-editor">
      {/* toolbar */}
      <div className="me-toolbar">
        <div className="seg">
          {(['select', 'move', 'resize', 'rotate', 'paint'] as Mode[]).map((m) => {
            const key = controls.keys[KEY_OF_MODE[m]].toUpperCase()
            return (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} title={`${t(`model.mode.${m}Hint`)} (${key})`}>
                {t(`model.mode.${m}`)} <span className="faint">{key}</span>
              </button>
            )
          })}
        </div>
        <div className="seg">
          {(['3d', 'uv', 'both'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {t(`model.view.${v}`)}
            </button>
          ))}
        </div>
        <button className="btn ghost small" title={t('model.navHint')} onClick={() => command('settings:model')}>
          🎮 {t('model.nav')}: {controls.preset === 'custom' ? t('model.custom') : controls.preset[0].toUpperCase() + controls.preset.slice(1)}
        </button>
        <button className="btn ghost small mono" title={t('controls.openJson')} onClick={() => useIde.getState().openControls()}>
          {'{ }'}
        </button>
        {mode === 'paint' ? (
          <>
            <div className="seg">
              {(['pencil', 'eraser', 'fill', 'picker'] as Tool[]).map((x) => (
                <button key={x} className={tool === x ? 'on' : ''} onClick={() => setTool(x)} title={t(`model.tool.${x}`)}>
                  {{ pencil: '✏️', eraser: '🧽', fill: '🪣', picker: '💧' }[x]}
                </button>
              ))}
            </div>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title={t('model.color')} />
            <div className="swatches">
              {recent.map((c) => (
                <button key={c} style={{ background: c }} className={c === color ? 'on' : ''} onClick={() => setColor(c)} aria-label={c} />
              ))}
            </div>
          </>
        ) : (
          <label className="row faint">
            {t('model.snap')}
            <select className="input" value={snap} onChange={(e) => setSnap(Number(e.target.value))}>
              <option value={1}>1 px</option>
              <option value={0.5}>0.5 px</option>
              <option value={0.25}>0.25 px</option>
              <option value={2}>2 px</option>
            </select>
          </label>
        )}
        <div className="grow" />
        <button className="btn ghost small" disabled={!past.current.length} onClick={undo} title="Ctrl+Z">
          ↶
        </button>
        <button className="btn ghost small" disabled={!future.current.length} onClick={redo} title="Ctrl+Y">
          ↷
        </button>
        <button className={`btn small${dirty ? ' primary' : ''}`} onClick={() => void save()} title="Ctrl+S">
          💾 {t('model.save')}
        </button>
      </div>

      <div className="me-body">
        {/* outliner */}
        <div className="me-outliner">
          <div className="me-head">{t('model.cubes')}</div>
          {model?.elements.map((e, i) => (
            <div key={i} className={`me-cube${i === sel ? ' on' : ''}`} onClick={() => setSel(i)}>
              <span>▣</span>
              <input
                className="me-name"
                value={e.name ?? ''}
                onChange={(ev) => updateEl(i, { name: ev.target.value.slice(0, 40) }, false)}
                onClick={(ev) => ev.stopPropagation()}
              />
            </div>
          ))}
          <div className="me-actions">
            <button
              className="btn small"
              onClick={() =>
                model &&
                (commit({ ...model, elements: [...model.elements, newCube(`cube_${model.elements.length + 1}`)] }), setSel(model?.elements.length ?? 0))
              }
            >
              + {t('model.addCube')}
            </button>
            <button
              className="btn ghost small"
              disabled={!el}
              onClick={() =>
                model &&
                el &&
                (commit({ ...model, elements: [...model.elements, { ...structuredClone(el), name: `${el.name ?? 'cube'}_copy` }] }),
                setSel(model.elements.length))
              }
            >
              ⧉ {t('model.duplicate')}
            </button>
            <button
              className="btn ghost small"
              disabled={!el}
              onClick={() => {
                if (!model || sel === null) return
                commit({ ...model, elements: model.elements.filter((_, k) => k !== sel) })
                setSel(model.elements.length > 1 ? Math.max(0, sel - 1) : null)
              }}
            >
              🗑 {t('model.delete')}
            </button>
          </div>
          <p className="hint">{t(`model.mode.${mode}Hint`)}</p>
        </div>

        {/* 3D */}
        <div className="me-view" ref={host} style={{ display: view === 'uv' ? 'none' : undefined }} />
        {view !== '3d' && (
          <div className="me-uv">
            <div className="me-uv-bar">
              <span className="faint">
                {t('model.uvOf')} #{activeSlot} {slots[activeSlot]?.split('/').pop() ?? '—'}
              </span>
              <div className="grow" />
              <button className="btn ghost small" disabled={sel === null} onClick={() => unwrap(false)} title={t('model.unwrapHint')}>
                {t('model.unwrapSel')}
              </button>
              <button className="btn ghost small" onClick={() => unwrap(true)} title={t('model.unwrapHint')}>
                {t('model.unwrapAll')}
              </button>
              <button className="btn ghost small" disabled={sel === null} onClick={resetUv}>
                {t('model.resetUv')}
              </button>
            </div>
            <UVEditor
              fit
              tex={texFor(slots[activeSlot])}
              model={model}
              slotRef={'#' + slotKey(activeSlot)}
              sel={sel}
              face={face}
              paint={mode === 'paint'}
              onSelect={(i, f) => {
                setSel(i)
                setFace(f)
              }}
              onUv={setFaceUv}
              onPaint={(x, y, first) => paintAt(slots[activeSlot], x, y, first)}
            />
          </div>
        )}

        {/* properties + texture */}
        <div className="me-props">
          {el && sel !== null && (
            <>
              <div className="me-head">{t('model.position')}</div>
              {(['from', 'to'] as const).map((k) => (
                <div key={k} className="me-xyz">
                  <span className="faint">{t(`model.${k}`)}</span>
                  {[0, 1, 2].map((a) => (
                    <span key={a}>{num(el[k][a], (n) => updateEl(sel, { [k]: el[k].map((v, i) => (i === a ? n : v)) } as Partial<EditElement>))}</span>
                  ))}
                </div>
              ))}
              <div className="me-xyz">
                <span className="faint">{t('model.rotation')}</span>
                <select
                  className="input"
                  value={el.rotation?.axis ?? 'y'}
                  onChange={(e) =>
                    updateEl(sel, {
                      rotation: {
                        axis: e.target.value as 'x' | 'y' | 'z',
                        angle: el.rotation?.angle ?? 22.5,
                        origin: el.rotation?.origin ?? el.from.map((v, i) => (v + el.to[i]) / 2)
                      }
                    })
                  }
                >
                  <option value="x">X</option>
                  <option value="y">Y</option>
                  <option value="z">Z</option>
                </select>
                <select
                  className="input"
                  value={el.rotation?.angle ?? 0}
                  onChange={(e) =>
                    updateEl(sel, {
                      rotation: {
                        axis: el.rotation?.axis ?? 'y',
                        angle: Number(e.target.value),
                        origin: el.rotation?.origin ?? el.from.map((v, i) => (v + el.to[i]) / 2)
                      }
                    })
                  }
                >
                  {ANGLES.map((a) => (
                    <option key={a} value={a}>
                      {a}°
                    </option>
                  ))}
                </select>
              </div>

              <div className="me-head">{t('model.faces')}</div>
              <div className="me-faces">
                {FACES.map((f) => (
                  <button key={f} className={`${f === face ? 'on' : ''}${el.faces[f] ? '' : ' off'}`} onClick={() => setFace(f)}>
                    {t(`model.face.${f}`)}
                  </button>
                ))}
              </div>
              <label className="row">
                <input
                  type="checkbox"
                  checked={!!fc}
                  onChange={(e) => {
                    const faces = { ...el.faces }
                    if (e.target.checked) faces[face] = { texture: '#' + slotKey(activeSlot) }
                    else delete faces[face]
                    updateEl(sel, { faces }, false)
                  }}
                />
                {t('model.faceOn')}
              </label>
              {fc && (
                <>
                  <div className="me-xyz">
                    <span className="faint">{t('model.texture')}</span>
                    <select
                      className="input"
                      value={slotOfFace(face)}
                      onChange={(e) => updateEl(sel, { faces: { ...el.faces, [face]: { ...fc, texture: '#' + slotKey(Number(e.target.value)) } } }, false)}
                    >
                      {SLOTS.map((s, i) => (
                        <option key={s} value={i}>
                          #{i} {slots[i] ? slots[i]!.split('/').pop() : '—'}
                        </option>
                      ))}
                    </select>
                    <select
                      className="input"
                      value={fc.rotation ?? 0}
                      title={t('model.uvRotation')}
                      onChange={(e) => updateEl(sel, { faces: { ...el.faces, [face]: { ...fc, rotation: Number(e.target.value) || undefined } } }, false)}
                    >
                      {[0, 90, 180, 270].map((r) => (
                        <option key={r} value={r}>
                          ⟳ {r}°
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={!fc.uv}
                      onChange={(e) => {
                        const next = { ...fc }
                        if (e.target.checked) delete next.uv
                        else next.uv = faceUv(el, face)
                        updateEl(sel, { faces: { ...el.faces, [face]: next } }, false)
                      }}
                    />
                    {t('model.autoUv')}
                  </label>
                  {fc.uv && (
                    <div className="me-xyz">
                      <span className="faint">UV</span>
                      {[0, 1, 2, 3].map((k) => (
                        <span key={k}>
                          {num(
                            fc.uv![k],
                            (n) =>
                              updateEl(
                                sel,
                                { faces: { ...el.faces, [face]: { ...fc, uv: fc.uv!.map((v, i) => (i === k ? Math.min(16, Math.max(0, n)) : v)) } } },
                                false
                              ),
                            0.5
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                  <button
                    className="btn ghost small"
                    onClick={() => updateEl(sel, { faces: Object.fromEntries(FACES.map((f) => [f, { ...(el.faces[f] ?? {}), texture: fc.texture }])) }, false)}
                  >
                    {t('model.allFaces')}
                  </button>
                </>
              )}
            </>
          )}

          <div className="me-head">{t('model.textures')}</div>
          {SLOTS.map((s, i) => (
            <div key={s} className={`me-slot${i === activeSlot ? ' on' : ''}`} onClick={() => setActiveSlot(i)}>
              <span className="mono">#{i}</span>
              <select
                className="input"
                value={slots[i] ?? ''}
                onChange={(e) => {
                  setSlots(slots.map((x, k) => (k === i ? e.target.value || null : x)))
                  setDirty(true)
                }}
              >
                <option value="">—</option>
                {textureAssets.map((a) => (
                  <option key={a} value={a}>
                    {a.replace(/^textures\//, '')}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <NewTexture
            onCreate={async (asset) => {
              await useStore.getState().refreshAssets()
              setSlots(slots.map((x, k) => (k === activeSlot ? asset : x)))
              setDirty(true)
            }}
          />
          <UVEditor
            tex={texFor(slots[activeSlot])}
            model={model}
            slotRef={'#' + slotKey(activeSlot)}
            sel={sel}
            face={face}
            paint={mode === 'paint'}
            onSelect={(i, f) => {
              setSel(i)
              setFace(f)
            }}
            onUv={setFaceUv}
            onPaint={(x, y, first) => paintAt(slots[activeSlot], x, y, first)}
          />
          {wired && <p className="hint">{t('model.wiredHint')}</p>}
        </div>
      </div>
    </div>
  )
}

const FACE_COLOR: Record<Face, string> = { north: '#3b82f6', south: '#22c55e', east: '#ef4444', west: '#f59e0b', up: '#a855f7', down: '#14b8a6' }
const FACE_LETTER: Record<Face, string> = { north: 'N', south: 'S', east: 'E', west: 'W', up: 'U', down: 'D' }

/**
 * The texture with every face that uses it outlined (its UV area). Paint mode paints pixels; otherwise a
 * click selects a face, dragging moves its UV and the corner handle resizes it (snapped to texture pixels).
 */
function UVEditor(props: {
  tex: Tex | null
  model: Model | null
  slotRef: string
  sel: number | null
  face: Face
  paint: boolean
  fit?: boolean
  onSelect: (i: number, f: Face) => void
  onUv: (i: number, f: Face, uv: number[] | null, phase: 'start' | 'move' | 'end') => void
  onPaint: (x: number, y: number, first: boolean) => void
}) {
  const { tex, model, slotRef, sel, face, paint, fit, onSelect, onUv, onPaint } = props
  const { t } = useTranslation()
  const view = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(224)
  useEffect(() => {
    if (!fit || !box.current) return
    const el = box.current
    const ro = new ResizeObserver(() => setSize(Math.max(160, Math.floor(Math.min(el.clientWidth, el.clientHeight) - 8))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  // faces drawn on this texture: [cube, face, rect in 0–16]
  const rects = useMemo(() => {
    const out: { i: number; f: Face; r: number[] }[] = []
    model?.elements.forEach((e, i) =>
      FACES.forEach((f) => {
        if (e.faces[f]?.texture !== slotRef) return
        const [u1, v1, u2, v2] = faceUv(e, f)
        out.push({ i, f, r: [Math.min(u1, u2), Math.min(v1, v2), Math.max(u1, u2), Math.max(v1, v2)] })
      })
    )
    return out
  }, [model, slotRef])

  useEffect(() => {
    const c = view.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, size, size)
    const cell = size / 16
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) ((ctx.fillStyle = (x + y) % 2 ? '#d4d4d8' : '#f4f4f5'), ctx.fillRect(x * cell, y * cell, cell, cell))
    if (tex) {
      ctx.drawImage(tex.canvas, 0, 0, size, size)
      const w = tex.canvas.width
      if (w <= 64) {
        ctx.strokeStyle = 'rgba(0,0,0,0.10)'
        for (let i = 1; i < w; i++) {
          const p = Math.round((i * size) / w) + 0.5
          ctx.beginPath()
          ctx.moveTo(p, 0)
          ctx.lineTo(p, size)
          ctx.moveTo(0, p)
          ctx.lineTo(size, p)
          ctx.stroke()
        }
      }
    }
    const k = size / 16
    // other cubes faint, the selected cube clear, the selected face on top with a resize handle
    const order = [...rects].sort(
      (a, b) => Number(a.i === sel) - Number(b.i === sel) || Number(a.i === sel && a.f === face) - Number(b.i === sel && b.f === face)
    )
    for (const { i, f, r } of order) {
      const on = i === sel
      const cur = on && f === face
      ctx.globalAlpha = on ? 1 : 0.35
      ctx.strokeStyle = cur ? '#f59e0b' : FACE_COLOR[f]
      ctx.lineWidth = cur ? 2.5 : 1.5
      ctx.strokeRect(r[0] * k + 0.5, r[1] * k + 0.5, (r[2] - r[0]) * k, (r[3] - r[1]) * k)
      if (on && (r[2] - r[0]) * k > 12 && (r[3] - r[1]) * k > 12) {
        ctx.fillStyle = ctx.strokeStyle
        ctx.font = `bold ${Math.max(9, Math.min(13, k * 0.8))}px sans-serif`
        ctx.fillText(FACE_LETTER[f], r[0] * k + 3, r[1] * k + 12)
      }
      if (cur && !paint) {
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect(r[2] * k - 5, r[3] * k - 5, 8, 8)
      }
    }
    ctx.globalAlpha = 1
    ctx.lineWidth = 1
  })

  const down = useRef<null | { kind: 'paint' } | { kind: 'move' | 'resize'; i: number; f: Face; r0: number[]; p0: [number, number] }>(null)
  const uvAt = (e: React.PointerEvent): [number, number] => {
    const r = view.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 16, ((e.clientY - r.top) / r.height) * 16]
  }
  const step = tex ? 16 / tex.canvas.width : 1
  const snapUv = (v: number) => Math.round(v / step) * step
  return (
    <div className={`me-painter${fit ? ' fit' : ''}`} ref={box}>
      <canvas
        ref={view}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        className={paint ? 'painting' : ''}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
          const [u, v] = uvAt(e)
          if (paint) {
            if (!tex) return
            down.current = { kind: 'paint' }
            onPaint(...uvToPixel(u / 16, v / 16, tex.canvas.width, tex.canvas.height), true)
            return
          }
          // the selected face's corner handle resizes; otherwise pick the face under the pointer
          const cur = rects.find((x) => x.i === sel && x.f === face)
          const k = 16 / view.current!.getBoundingClientRect().width
          if (cur && Math.abs(u - cur.r[2]) < 8 * k && Math.abs(v - cur.r[3]) < 8 * k) {
            down.current = { kind: 'resize', i: cur.i, f: cur.f, r0: cur.r, p0: [u, v] }
            onUv(cur.i, cur.f, null, 'start')
            return
          }
          const hits = rects.filter((x) => u >= x.r[0] && u <= x.r[2] && v >= x.r[1] && v <= x.r[3])
          const pick =
            hits.find((x) => x.i === sel && x.f === face) ??
            hits.sort((a, b) => Number(b.i === sel) - Number(a.i === sel) || (a.r[2] - a.r[0]) * (a.r[3] - a.r[1]) - (b.r[2] - b.r[0]) * (b.r[3] - b.r[1]))[0]
          if (!pick) return
          onSelect(pick.i, pick.f)
          down.current = { kind: 'move', i: pick.i, f: pick.f, r0: pick.r, p0: [u, v] }
          onUv(pick.i, pick.f, null, 'start')
        }}
        onPointerMove={(e) => {
          const d = down.current
          if (!d) return
          const [u, v] = uvAt(e)
          if (d.kind === 'paint') {
            if (tex) onPaint(...uvToPixel(u / 16, v / 16, tex.canvas.width, tex.canvas.height), false)
            return
          }
          const du = snapUv(u - d.p0[0])
          const dv = snapUv(v - d.p0[1])
          const [a, b, c2, d2] = d.r0
          let uv: number[]
          if (d.kind === 'move') {
            const w = c2 - a
            const h = d2 - b
            const na = Math.min(16 - w, Math.max(0, a + du))
            const nb = Math.min(16 - h, Math.max(0, b + dv))
            uv = [na, nb, na + w, nb + h]
          } else uv = [a, b, Math.min(16, Math.max(a + step, c2 + du)), Math.min(16, Math.max(b + step, d2 + dv))]
          // keep a mirrored face mirrored
          const old = model ? faceUv(model.elements[d.i], d.f) : uv
          if (old[0] > old[2]) uv = [uv[2], uv[1], uv[0], uv[3]]
          if (old[1] > old[3]) uv = [uv[0], uv[3], uv[2], uv[1]]
          onUv(d.i, d.f, uv, 'move')
        }}
        onPointerUp={() => {
          const d = down.current
          down.current = null
          if (d && d.kind !== 'paint') onUv(d.i, d.f, null, 'end')
        }}
      />
      {!tex && <p className="hint">{t('model.noTexture')}</p>}
      {tex && !fit && <p className="hint">{t(paint ? 'model.texSize' : 'model.uvHint', { w: tex.canvas.width, h: tex.canvas.height })}</p>}
    </div>
  )
}

/** Makes an empty PNG texture in the project and hands it to the editor. */
function NewTexture({ onCreate }: { onCreate: (asset: string) => void | Promise<void> }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('my_texture')
  const [size, setSize] = useState(16)
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        + {t('model.newTexture')}
      </button>
    )
  const create = async () => {
    const id =
      name
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'texture'
    const asset = `textures/${id}.png`
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    try {
      await api.writeTexture(asset, c.toDataURL('image/png').split(',')[1])
      setOpen(false)
      await onCreate(asset)
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    }
  }
  return (
    <div className="me-newtex">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="input" value={size} onChange={(e) => setSize(Number(e.target.value))}>
        {[16, 32, 64].map((s) => (
          <option key={s} value={s}>
            {s}×{s}
          </option>
        ))}
      </select>
      <button className="btn small primary" onClick={() => void create()}>
        {t('model.create')}
      </button>
    </div>
  )
}
