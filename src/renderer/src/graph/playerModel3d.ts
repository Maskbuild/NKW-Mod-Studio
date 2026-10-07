import * as THREE from 'three'
import { CORNERS, faceRects, type Face, type GeoBone, type GeoCube, type V3 } from '@core/gen/geo'

/**
 * A 3D player mannequin and the pieces to build bone trees like GeckoLib does (geo space mirrored on x, bone
 * rotations applied Z·Y·X with x/y negated). Shared by the armor preview and the skin wardrobe.
 */

const rad = THREE.MathUtils.degToRad
/** Geo rotation → render-space Euler (GeckoLib negates x and y, applies Z·Y·X). */
const euler = (r?: V3) => new THREE.Euler(rad(-(r?.[0] ?? 0)), rad(-(r?.[1] ?? 0)), rad(r?.[2] ?? 0), 'ZYX')
const toRender = (p?: V3): THREE.Vector3 => new THREE.Vector3(-(p?.[0] ?? 0), p?.[1] ?? 0, p?.[2] ?? 0)

export function cubeMesh(c: GeoCube, tw: number, th: number, mat: THREE.Material): THREE.Object3D {
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
export function buildGeo(
  bones: GeoBone[],
  tw: number,
  th: number,
  mat: THREE.Material,
  visible: Set<string>,
  scaleOf: (name: string) => V3 | null
): THREE.Group {
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
export function mannequin(slim: boolean): GeoBone[] {
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
export function defaultSkin(slim: boolean): HTMLCanvasElement {
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

export const pixelTexture = (t: THREE.Texture) => {
  t.magFilter = THREE.NearestFilter
  t.minFilter = THREE.NearestFilter
  t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}
