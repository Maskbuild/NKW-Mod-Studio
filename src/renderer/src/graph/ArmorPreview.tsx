import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { textureKeys, type JavaModel } from '@core/gen/model'
import { FIT_PREFIX, SLOT_BONES, geoBones, javaModelToGeo, prepareArmorGeo, type ArmorFit, type GeoBone, type GeoCube, type GeoFile, type V3 } from '@core/gen/geo'
import type { ArmorSlot } from '@core/ir'
import { api, assetUrl } from '../api'

/**
 * 3D preview of one armor piece on a player mannequin (Steve or Alex arms), built exactly like
 * GeckoLib builds it: geo space mirrored on x, bone rotations applied Z·Y·X with x/y negated.
 */

type Face = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
type Rect = { u: number; v: number; us: number; vs: number }

// Face corners as seen from outside: top-left, top-right, bottom-right, bottom-left (render space).
const CORNERS: Record<Face, (a: V3, b: V3) => V3[]> = {
  north: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]],
  south: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]],
  west: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], b[2]], [a[0], a[1], a[2]]],
  east: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]],
  up: (a, b) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]],
  down: (a, b) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]]
}

/** Box UV → per-face rectangles, the way GeckoLib lays them out. */
function boxRects(uv: [number, number], size: V3): Record<Face, Rect> {
  const [u, v] = uv
  const w = Math.floor(size[0])
  const h = Math.floor(size[1])
  const d = Math.floor(size[2])
  return {
    east: { u, v: v + d, us: d, vs: h },
    north: { u: u + d, v: v + d, us: w, vs: h },
    west: { u: u + d + w, v: v + d, us: d, vs: h },
    south: { u: u + d + w + d, v: v + d, us: w, vs: h },
    up: { u: u + d, v, us: w, vs: d },
    down: { u: u + d + w, v: v + d, us: w, vs: -d }
  }
}

function faceRects(c: GeoCube): Partial<Record<Face, Rect>> {
  if (Array.isArray(c.uv)) return boxRects(c.uv, c.size)
  const out: Partial<Record<Face, Rect>> = {}
  for (const [f, fu] of Object.entries(c.uv ?? {}) as [Face, { uv: [number, number]; uv_size: [number, number] }][]) {
    if (!fu?.uv || !fu.uv_size) continue
    // Blockbench stores up/down faces flipped
    out[f] = f === 'up' || f === 'down' ? { u: fu.uv[0] + fu.uv_size[0], v: fu.uv[1] + fu.uv_size[1], us: -fu.uv_size[0], vs: -fu.uv_size[1] } : { u: fu.uv[0], v: fu.uv[1], us: fu.uv_size[0], vs: fu.uv_size[1] }
  }
  return out
}

const rad = THREE.MathUtils.degToRad
/** Geo rotation → render-space Euler (GeckoLib negates x and y, applies Z·Y·X). */
const euler = (r?: V3) => new THREE.Euler(rad(-(r?.[0] ?? 0)), rad(-(r?.[1] ?? 0)), rad(r?.[2] ?? 0), 'ZYX')
const toRender = (p?: V3): THREE.Vector3 => new THREE.Vector3(-(p?.[0] ?? 0), p?.[1] ?? 0, p?.[2] ?? 0)

function cubeMesh(c: GeoCube, tw: number, th: number, mat: THREE.Material): THREE.Object3D {
  const inf = c.inflate ?? 0
  // render space: x mirrored, so the box spans -(origin.x + size.x) … -origin.x
  const a: V3 = [-(c.origin[0] + c.size[0]) - inf, c.origin[1] - inf, c.origin[2] - inf]
  const b: V3 = [-c.origin[0] + inf, c.origin[1] + c.size[1] + inf, c.origin[2] + c.size[2] + inf]
  const rects = faceRects(c)
  const pos: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  for (const f of Object.keys(CORNERS) as Face[]) {
    const r = rects[f]
    if (!r || (r.us === 0 && r.vs === 0)) continue
    let [tl, tr, br, bl] = CORNERS[f](a, b)
    if (c.mirror) [tl, tr, br, bl] = [tr, tl, bl, br]
    const base = pos.length / 3
    for (const p of [tl, tr, br, bl]) pos.push(p[0], p[1], p[2])
    const u1 = r.u / tw
    const u2 = (r.u + r.us) / tw
    const v1 = 1 - r.v / th
    const v2 = 1 - (r.v + r.vs) / th
    uvs.push(u1, v1, u2, v1, u2, v2, u1, v2)
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  geo.computeVertexNormals()
  const mesh = new THREE.Mesh(geo, mat)
  if (!c.rotation) return mesh
  const pivot = new THREE.Group()
  const pv = toRender(c.pivot)
  pivot.position.copy(pv)
  pivot.rotation.copy(euler(c.rotation))
  mesh.position.copy(pv).multiplyScalar(-1)
  pivot.add(mesh)
  return pivot
}

/** Builds the bone tree; cubes are added only for bones inside `visible` subtrees. */
function buildGeo(bones: GeoBone[], tw: number, th: number, mat: THREE.Material, visible: Set<string>, scaleOf: (name: string) => V3 | null): THREE.Group {
  const root = new THREE.Group()
  const groups = new Map<string, THREE.Group>()
  const shown = (b: GeoBone): boolean => {
    for (let cur: GeoBone | undefined = b, i = 0; cur && i < 64; i++) {
      if (visible.has(cur.name)) return true
      cur = bones.find((x) => x.name === cur!.parent)
    }
    return false
  }
  for (const b of bones) {
    const g = new THREE.Group()
    g.userData.pivot = toRender(b.pivot)
    groups.set(b.name, g)
  }
  for (const b of bones) {
    const g = groups.get(b.name)!
    const parent = b.parent ? groups.get(b.parent) : undefined
    const ppv: THREE.Vector3 = parent ? parent.userData.pivot : new THREE.Vector3()
    g.position.copy(g.userData.pivot as THREE.Vector3).sub(ppv)
    g.rotation.copy(euler(b.rotation))
    const s = scaleOf(b.name)
    if (s) g.scale.set(s[0], s[1], s[2])
    ;(parent ?? root).add(g)
    if (!shown(b)) continue
    for (const c of b.cubes ?? []) {
      const m = cubeMesh(c, tw, th, mat)
      // cube coordinates are absolute: move them into the bone's local frame
      const holder = new THREE.Group()
      holder.position.copy(g.userData.pivot as THREE.Vector3).multiplyScalar(-1)
      holder.add(m)
      g.add(holder)
    }
  }
  return root
}

/** Mannequin in the standard 64×64 skin layout; slim = Alex (3-pixel arms). */
function mannequin(slim: boolean): GeoBone[] {
  const aw = slim ? 3 : 4
  // base layer + the outer layer (hat, jacket, sleeves, trousers) slightly inflated, as in game
  const part = (origin: V3, size: V3, uv: [number, number], outer: [number, number], inflate: number): GeoCube[] => [
    { origin, size, uv },
    { origin, size, uv: outer, inflate }
  ]
  return [
    { name: 'head', pivot: [0, 24, 0], cubes: part([-4, 24, -4], [8, 8, 8], [0, 0], [32, 0], 0.5) },
    { name: 'body', pivot: [0, 24, 0], cubes: part([-4, 12, -2], [8, 12, 4], [16, 16], [16, 32], 0.25) },
    { name: 'rightArm', pivot: [-5, 22, 0], cubes: part([-4 - aw, 12, -2], [aw, 12, 4], [40, 16], [40, 32], 0.25) },
    { name: 'leftArm', pivot: [5, 22, 0], cubes: part([4, 12, -2], [aw, 12, 4], [32, 48], [48, 48], 0.25) },
    { name: 'rightLeg', pivot: [-1.9, 12, 0], cubes: part([-4, 0, -2], [4, 12, 4], [0, 16], [0, 32], 0.25) },
    { name: 'leftLeg', pivot: [1.9, 12, 0], cubes: part([0, 0, -2], [4, 12, 4], [16, 48], [0, 48], 0.25) }
  ]
}

/** A plain mannequin skin (not Mojang's), drawn in the standard skin layout. */
function defaultSkin(slim: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const box = (u: number, v: number, w: number, h: number, d: number, side: string, front: string, top: string, bottom: string, back = side) => {
    g.fillStyle = top
    g.fillRect(u + d, v, w, d)
    g.fillStyle = bottom
    g.fillRect(u + d + w, v, w, d)
    g.fillStyle = side
    g.fillRect(u, v + d, d, h)
    g.fillRect(u + d + w, v + d, d, h)
    g.fillStyle = front
    g.fillRect(u + d, v + d, w, h)
    g.fillStyle = back
    g.fillRect(u + d + w + d, v + d, w, h)
  }
  const skin = '#c99b7a'
  const hair = '#4a3223'
  const shirt = '#2aa7a7'
  const pants = '#3b4aa0'
  box(0, 0, 8, 8, 8, skin, skin, hair, skin, hair)
  // hair fringe + eyes on the face
  g.fillStyle = hair
  g.fillRect(8, 8, 8, 2)
  g.fillRect(0, 8, 8, 3)
  g.fillRect(16, 8, 8, 3)
  g.fillStyle = '#ffffff'
  g.fillRect(9, 12, 2, 1)
  g.fillRect(13, 12, 2, 1)
  g.fillStyle = '#3b5bdb'
  g.fillRect(10, 12, 1, 1)
  g.fillRect(13, 12, 1, 1)
  g.fillStyle = '#8a5a44'
  g.fillRect(11, 14, 2, 1)
  box(16, 16, 8, 12, 4, shirt, shirt, shirt, pants)
  const aw = slim ? 3 : 4
  box(40, 16, aw, 12, 4, shirt, shirt, shirt, skin)
  box(32, 48, aw, 12, 4, shirt, shirt, shirt, skin)
  // sleeves end at the elbow: hands are skin
  for (const [u, v] of [
    [40, 16],
    [32, 48]
  ]) {
    g.fillStyle = skin
    g.fillRect(u, v + 4 + 6, aw * 2 + 8, 6)
  }
  box(0, 16, 4, 12, 4, pants, pants, pants, '#555')
  box(16, 48, 4, 12, 4, pants, pants, pants, '#555')
  for (const [u, v] of [
    [0, 16],
    [16, 48]
  ]) {
    g.fillStyle = '#6b6b6b'
    g.fillRect(u, v + 4 + 9, 16, 3)
  }
  return c
}

const pixelTexture = (t: THREE.Texture) => {
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

/**
 * Textures stacked vertically, first frame each, same width: the sheet the generator writes.
 * The texture is created only once the sheet is drawn (a WebGL texture cannot change size later).
 */
function sheetTexture(textures: string[]): Promise<THREE.Texture> {
  const canvas = document.createElement('canvas')
  return Promise.all(
    textures.map(
      (t) =>
        new Promise<HTMLImageElement | null>((ok) => {
          const img = new Image()
          img.crossOrigin = 'anonymous'
          img.onload = () => ok(img)
          img.onerror = () => ok(null)
          img.src = assetUrl(t)
        })
    )
  ).then((imgs) => {
    const w = Math.max(16, ...imgs.map((i) => i?.naturalWidth ?? 16))
    canvas.width = w
    canvas.height = w * imgs.length
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    imgs.forEach((img, i) => img && g.drawImage(img, 0, 0, img.naturalWidth, img.naturalWidth, 0, i * w, w, w))
    return new THREE.CanvasTexture(canvas)
  })
}

export interface ArmorPreviewProps {
  geoAsset: string | null
  texture: string | null
  /** Java block/item model: its textures (merged into one sheet like the generator does) */
  javaTextures?: string[] | null
  slot: ArmorSlot
  fit: ArmorFit | null
  slim: boolean
  /** project texture chosen as skin */
  skin: string | null
  /** the game's own Steve/Alex skin (from the downloaded Minecraft files), if any */
  gameSkin: string | null
}

export default function ArmorPreview({ geoAsset, texture, javaTextures, slot, fit, slim, skin, gameSkin }: ArmorPreviewProps) {
  const host = useRef<HTMLDivElement>(null)
  const ctx = useRef<{ scene: THREE.Scene; render: () => void } | null>(null)
  const [geo, setGeo] = useState<GeoFile | null>(null)

  // renderer, camera and controls live as long as the panel
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
    controls.update()
    const render = () => renderer.render(scene, camera)
    controls.addEventListener('change', render)
    ctx.current = { scene, render }
    const ro = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight)
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight)
      camera.updateProjectionMatrix()
      render()
    })
    ro.observe(el)
    render()
    return () => {
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      ctx.current = null
    }
  }, [])

  useEffect(() => {
    let live = true
    setGeo(null)
    if (geoAsset)
      void api
        .readModel(geoAsset)
        .then((g) => {
          if (!live) return
          const raw = g as GeoFile & JavaModel
          setGeo(javaTextures ? javaModelToGeo(raw, textureKeys(raw), javaTextures.length) : raw)
        })
        .catch(() => undefined)
    return () => {
      live = false
    }
  }, [geoAsset, javaTextures?.length])

  // mannequin
  useEffect(() => {
    const c = ctx.current
    if (!c) return
    // plain mannequin first; a project skin or the game's Steve/Alex replaces it once loaded
    let skinTex: THREE.Texture = pixelTexture(new THREE.CanvasTexture(defaultSkin(slim)))
    const mat = new THREE.MeshLambertMaterial({ map: skinTex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    const url = skin ? assetUrl(skin) : gameSkin
    let live = true
    if (url)
      new THREE.TextureLoader().load(
        url,
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
  }, [slim, skin, gameSkin])

  // armor piece
  useEffect(() => {
    const c = ctx.current
    if (!c || !geo || !geoBones(geo).length) return
    const prepared = prepareArmorGeo(geo, slot, fit)
    const desc = prepared['minecraft:geometry'][0].description
    const tw = Number(desc.texture_width ?? 64)
    const th = Number(desc.texture_height ?? 64)
    const sheet = !!javaTextures && javaTextures.length > 1
    const tex = sheet
      ? null
      : texture
      ? new THREE.TextureLoader().load(assetUrl(texture), (t) => {
          // animated textures (frames stacked vertically): show the first frame
          const img = t.image as { width: number; height: number }
          const frame = (th / tw) * img.width
          if (img.height > frame) {
            t.repeat.set(1, frame / img.height)
            t.offset.set(0, 1 - frame / img.height)
          }
          c.render()
        })
      : null
    if (tex) pixelTexture(tex)
    const mat = new THREE.MeshLambertMaterial({ map: tex, color: tex || sheet ? 0xffffff : 0x9aa4b2, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })
    let sheetTex: THREE.Texture | null = null
    let live = true
    if (sheet)
      void sheetTexture(javaTextures!).then((t) => {
        if (!live) return t.dispose()
        sheetTex = pixelTexture(t)
        mat.map = sheetTex
        mat.needsUpdate = true
        c.render()
      })
    const scale = fit?.scale ?? null
    const armor = buildGeo(geoBones(prepared), tw, th, mat, new Set(SLOT_BONES[slot]), (n) =>
      n.startsWith(FIT_PREFIX) ? scale : null
    )
    c.scene.add(armor)
    c.render()
    return () => {
      c.scene.remove(armor)
      armor.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      live = false
      mat.dispose()
      tex?.dispose()
      sheetTex?.dispose()
      c.render()
    }
  }, [geo, texture, javaTextures?.join('|'), slot, JSON.stringify(fit)])

  return <div ref={host} className="preview3d armor-preview" />
}
