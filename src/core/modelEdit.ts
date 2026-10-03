import { CORNERS, DEFAULT_UV, type Face, type V3 } from './gen/faces'
import type { JavaModel } from './gen/model'

/**
 * Model editor data: a Java block / item model (the format the generators use), edited cube by cube.
 * A face without "uv" uses Minecraft's automatic UV (from the cube's size and position).
 */

export type EditElement = NonNullable<JavaModel['elements']>[number]
export type EditFace = EditElement['faces'][string]

export const FACES: Face[] = ['north', 'south', 'east', 'west', 'up', 'down']
/** Java models only allow these rotation angles, around one axis. */
export const ANGLES = [-45, -22.5, 0, 22.5, 45]
/** Java models must stay inside −16…32 on every axis. */
export const MIN = -16
export const MAX = 32

const r = (n: number, step = 0.25) => Math.round(n / step) * step
const clampC = (n: number) => Math.min(MAX, Math.max(MIN, n))

/** A new cube in the middle of the block, every face using texture slot 0 with automatic UV. */
export function newCube(name: string, slot = '0'): EditElement {
  return {
    name,
    from: [4, 0, 4],
    to: [12, 8, 12],
    faces: Object.fromEntries(FACES.map((f) => [f, { texture: `#${slot}` }]))
  }
}

/** An empty model with one cube and texture slot 0. */
export function newModel(texture: string | null): JavaModel & { elements: EditElement[] } {
  return {
    textures: texture ? { '0': texture, particle: texture } : { '0': 'missing' },
    elements: [newCube('cube')]
  }
}

/** Keeps from ≤ to, inside the allowed range, on a 0.25 px grid. */
export function normalize(el: EditElement): EditElement {
  const from = el.from.map((v, i) => clampC(r(Math.min(v, el.to[i]))))
  const to = el.to.map((v, i) => clampC(r(Math.max(v, el.from[i]))))
  const out: EditElement = { ...el, from, to }
  if (el.rotation) {
    const angle = ANGLES.reduce((best, a) => (Math.abs(a - el.rotation!.angle) < Math.abs(best - el.rotation!.angle) ? a : best), 0)
    if (angle === 0) delete out.rotation
    else out.rotation = { ...el.rotation, angle, origin: el.rotation.origin.map((v) => clampC(r(v))) }
  }
  return out
}

/** Moves a cube by (dx, dy, dz) pixels. */
export function moveBy(el: EditElement, d: number[]): EditElement {
  const from = el.from.map((v, i) => v + d[i])
  const to = el.to.map((v, i) => v + d[i])
  const rotation = el.rotation ? { ...el.rotation, origin: el.rotation.origin.map((v, i) => v + d[i]) } : undefined
  return normalize({ ...el, from, to, ...(rotation ? { rotation } : {}) })
}

/** The UV a face uses: its own, or Minecraft's automatic one. [u1, v1, u2, v2] in 0–16. */
export function faceUv(el: EditElement, face: Face): number[] {
  return el.faces[face]?.uv ?? DEFAULT_UV[face](el.from, el.to)
}

/**
 * The 4 corners (top-left, top-right, bottom-right, bottom-left as seen from outside) and the UV of each
 * corner (0–1, v down) after the face's rotation, for drawing and for painting on the 3D view.
 */
export function faceQuad(el: EditElement, face: Face): { corners: V3[]; uv: [number, number][] } {
  const corners = CORNERS[face](el.from as V3, el.to as V3)
  const [u1, v1, u2, v2] = faceUv(el, face)
  let uv: [number, number][] = [
    [u1 / 16, v1 / 16],
    [u2 / 16, v1 / 16],
    [u2 / 16, v2 / 16],
    [u1 / 16, v2 / 16]
  ]
  // Minecraft rotates the texture clockwise on the face: each step moves the UV one corner further
  const steps = ((((el.faces[face]?.rotation ?? 0) / 90) % 4) + 4) % 4
  for (let i = 0; i < steps; i++) uv = [uv[3], uv[0], uv[1], uv[2]]
  return { corners, uv }
}

/** Texture pixel under a UV point (0–1, v down) of a texture of size w × h. */
export function uvToPixel(u: number, v: number, w: number, h: number): [number, number] {
  return [Math.min(w - 1, Math.max(0, Math.floor(u * w))), Math.min(h - 1, Math.max(0, Math.floor(v * h)))]
}

/** Flood fill of the area with the same colour as (x, y) (4-neighbours). Works on RGBA bytes. */
export function floodFill(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, rgba: number[]): void {
  const at = (px: number, py: number) => (py * w + px) * 4
  const i0 = at(x, y)
  const target = [data[i0], data[i0 + 1], data[i0 + 2], data[i0 + 3]]
  if (target.every((v, i) => v === rgba[i])) return
  const same = (i: number) => data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3]
  const stack: [number, number][] = [[x, y]]
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    const i = at(px, py)
    if (!same(i)) continue
    data.set(rgba, i)
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1])
  }
}

/** Cleans a model for saving: normalized cubes, no empty faces, the slot list. */
export function toSaved(model: JavaModel & { elements: EditElement[] }): JavaModel {
  return {
    ...model,
    elements: model.elements.map((e) => {
      const n = normalize(e)
      return { ...n, faces: Object.fromEntries(Object.entries(n.faces).filter(([, f]) => !!f)) }
    })
  }
}

/**
 * "Box UV": lays each cube's faces out as an unfolded box (top / bottom over east / north / west / south),
 * cubes side by side in rows on the 16×16 UV space, scaled down when they do not fit. Only faces using
 * texture `ref` (e.g. "#0") of the cubes in `indices` change.
 */
export function boxUnwrap(elements: EditElement[], indices: number[], ref: string): EditElement[] {
  const nets = indices.map((i) => {
    const e = elements[i]
    const [w, h, d] = [0, 1, 2].map((a) => Math.abs(e.to[a] - e.from[a]))
    return { i, w, h, d, nw: 2 * (w + d), nh: d + h }
  })
  // shelf packing at full size, then one scale for everything
  let x = 0
  let y = 0
  let row = 0
  let width = 0
  const place: { i: number; x: number; y: number }[] = []
  for (const n of nets) {
    if (x > 0 && x + n.nw > 16) {
      x = 0
      y += row
      row = 0
    }
    place.push({ i: n.i, x, y })
    x += n.nw
    width = Math.max(width, x)
    row = Math.max(row, n.nh)
  }
  const height = y + row
  const s = Math.min(1, 16 / Math.max(width, height, 1e-6))
  const q = (v: number) => Math.round(v * s * 4) / 4
  const out = elements.slice()
  for (const p of place) {
    const n = nets.find((m) => m.i === p.i)!
    const { w, h, d } = n
    const at: Record<Face, number[]> = {
      up: [p.x + d, p.y, p.x + d + w, p.y + d],
      down: [p.x + d + w, p.y, p.x + d + 2 * w, p.y + d],
      east: [p.x, p.y + d, p.x + d, p.y + d + h],
      north: [p.x + d, p.y + d, p.x + d + w, p.y + d + h],
      west: [p.x + d + w, p.y + d, p.x + 2 * d + w, p.y + d + h],
      south: [p.x + 2 * d + w, p.y + d, p.x + 2 * d + 2 * w, p.y + d + h]
    }
    const e = out[p.i]
    const faces = { ...e.faces }
    for (const f of FACES) {
      const face = faces[f]
      if (!face || face.texture !== ref) continue
      faces[f] = { ...face, uv: at[f].map(q), rotation: undefined }
      delete faces[f].rotation
    }
    out[p.i] = { ...e, faces }
  }
  return out
}
