import { inflateSync } from 'node:zlib'
import { encodePng } from './png'

/**
 * Inventory icons for block-like models: resolves a Minecraft JSON model (parents, texture variables,
 * elements) and draws it the way the inventory does (30° / 225° isometric view with side shading).
 * Pure software rendering, so it runs in the main process without a GPU.
 */

export interface Img {
  w: number
  h: number
  /** RGBA, row-major */
  px: Uint8Array
}

/** Decodes 8-bit (and palette 1/2/4-bit) non-interlaced PNGs — every texture Minecraft ships. */
export function decodePng(buf: Buffer): Img | null {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let type = 0
  let interlace = 0
  let palette: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o)
    const kind = buf.toString('latin1', o + 4, o + 8)
    const data = buf.subarray(o + 8, o + 8 + len)
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      depth = data[8]
      type = data[9]
      interlace = data[12]
    } else if (kind === 'PLTE') palette = data
    else if (kind === 'tRNS') trns = data
    else if (kind === 'IDAT') idat.push(data)
    else if (kind === 'IEND') break
    o += 12 + len
  }
  if (!w || !h || w > 4096 || h > 4096 || interlace) return null
  const channels = type === 6 ? 4 : type === 2 ? 3 : type === 4 ? 2 : 1
  if (depth !== 8 && !(type === 3 && depth < 8) && !(type === 0 && depth < 8)) return null
  const bpp = Math.max(1, (channels * depth) >> 3)
  const stride = Math.ceil((w * channels * depth) / 8)
  let raw: Buffer
  try {
    raw = inflateSync(Buffer.concat(idat))
  } catch {
    return null
  }
  if (raw.length < (stride + 1) * h) return null
  const cur = Buffer.alloc(stride)
  const prev = Buffer.alloc(stride)
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
    for (let x = 0; x < w; x++) {
      const d = (y * w + x) * 4
      if (depth < 8) {
        const bit = x * depth
        const idx = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1)
        if (type === 3) {
          px[d] = palette?.[idx * 3] ?? 0
          px[d + 1] = palette?.[idx * 3 + 1] ?? 0
          px[d + 2] = palette?.[idx * 3 + 2] ?? 0
          px[d + 3] = trns && idx < trns.length ? trns[idx] : 255
        } else {
          const g = Math.round((idx * 255) / ((1 << depth) - 1))
          px[d] = px[d + 1] = px[d + 2] = g
          px[d + 3] = 255
        }
        continue
      }
      const s = x * channels
      if (type === 6) {
        px[d] = cur[s]
        px[d + 1] = cur[s + 1]
        px[d + 2] = cur[s + 2]
        px[d + 3] = cur[s + 3]
      } else if (type === 2) {
        px[d] = cur[s]
        px[d + 1] = cur[s + 1]
        px[d + 2] = cur[s + 2]
        px[d + 3] = 255
      } else if (type === 3) {
        const idx = cur[s]
        px[d] = palette?.[idx * 3] ?? 0
        px[d + 1] = palette?.[idx * 3 + 1] ?? 0
        px[d + 2] = palette?.[idx * 3 + 2] ?? 0
        px[d + 3] = trns && idx < trns.length ? trns[idx] : 255
      } else if (type === 4) {
        px[d] = px[d + 1] = px[d + 2] = cur[s]
        px[d + 3] = cur[s + 1]
      } else {
        px[d] = px[d + 1] = px[d + 2] = cur[s]
        px[d + 3] = 255
      }
    }
    prev.set(cur)
  }
  return { w, h, px }
}

type Dir = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'
type V3 = [number, number, number]

export interface ModelFace {
  uv?: number[]
  texture?: string
  rotation?: number
  tintindex?: number
}
export interface ModelElement {
  from: V3
  to: V3
  rotation?: { origin: V3; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean }
  faces?: Partial<Record<Dir, ModelFace>>
}
export interface JsonModel {
  parent?: string
  textures?: Record<string, string>
  elements?: ModelElement[]
  display?: Record<string, { rotation?: V3; translation?: V3; scale?: V3 }>
}

/** Model fully resolved through its parents; `kind` says how the inventory draws it. */
export interface ResolvedModel {
  kind: 'flat' | 'elements' | 'builtin'
  textures: Record<string, string>
  elements: ModelElement[]
  gui: { rotation: V3; translation: V3; scale: V3 }
}

const DEFAULT_GUI = { rotation: [30, 225, 0] as V3, translation: [0, 0, 0] as V3, scale: [0.625, 0.625, 0.625] as V3 }

export function resolveModel(ref: string, load: (ref: string) => JsonModel | null): ResolvedModel | null {
  const textures: Record<string, string> = {}
  let elements: ModelElement[] | null = null
  let gui: ResolvedModel['gui'] | null = null
  let kind: ResolvedModel['kind'] | null = null
  let cur: string | undefined = ref
  for (let depth = 0; cur && depth < 16; depth++) {
    const bare = cur.replace(/^minecraft:/, '')
    if (bare === 'builtin/generated' || bare === 'item/generated' || bare === 'item/handheld' || bare === 'item/handheld_rod') {
      kind ??= 'flat'
      break
    }
    if (bare === 'builtin/entity') {
      kind ??= 'builtin'
      break
    }
    const m = load(cur)
    if (!m) return null
    for (const [k, v] of Object.entries(m.textures ?? {})) if (!(k in textures)) textures[k] = v
    if (!elements && m.elements?.length) elements = m.elements
    const g = m.display?.gui
    if (!gui && g) gui = { rotation: g.rotation ?? [0, 0, 0], translation: g.translation ?? [0, 0, 0], scale: g.scale ?? [1, 1, 1] }
    cur = m.parent
  }
  if (elements && kind !== 'flat') kind = 'elements'
  if (!kind) return null
  return { kind, textures, elements: elements ?? [], gui: gui ?? DEFAULT_GUI }
}

/** Follows #variables to a texture reference like "minecraft:block/stone". */
export function textureRef(textures: Record<string, string>, v: string | undefined): string | null {
  for (let i = 0; v && i < 16; i++) {
    if (!v.startsWith('#')) return v
    v = textures[v.slice(1)]
  }
  return null
}

// Corners of each face as seen from outside: top-left, top-right, bottom-right, bottom-left.
const CORNERS: Record<Dir, (a: V3, b: V3) => V3[]> = {
  north: (a, b) => [[b[0], b[1], a[2]], [a[0], b[1], a[2]], [a[0], a[1], a[2]], [b[0], a[1], a[2]]],
  south: (a, b) => [[a[0], b[1], b[2]], [b[0], b[1], b[2]], [b[0], a[1], b[2]], [a[0], a[1], b[2]]],
  west: (a, b) => [[a[0], b[1], a[2]], [a[0], b[1], b[2]], [a[0], a[1], b[2]], [a[0], a[1], a[2]]],
  east: (a, b) => [[b[0], b[1], b[2]], [b[0], b[1], a[2]], [b[0], a[1], a[2]], [b[0], a[1], b[2]]],
  up: (a, b) => [[a[0], b[1], a[2]], [b[0], b[1], a[2]], [b[0], b[1], b[2]], [a[0], b[1], b[2]]],
  down: (a, b) => [[a[0], a[1], b[2]], [b[0], a[1], b[2]], [b[0], a[1], a[2]], [a[0], a[1], a[2]]]
}
const DEFAULT_UV: Record<Dir, (a: V3, b: V3) => number[]> = {
  north: (a, b) => [16 - b[0], 16 - b[1], 16 - a[0], 16 - a[1]],
  south: (a, b) => [a[0], 16 - b[1], b[0], 16 - a[1]],
  west: (a, b) => [a[2], 16 - b[1], b[2], 16 - a[1]],
  east: (a, b) => [16 - b[2], 16 - b[1], 16 - a[2], 16 - a[1]],
  up: (a, b) => [a[0], a[2], b[0], b[2]],
  down: (a, b) => [a[0], 16 - b[2], b[0], 16 - a[2]]
}
/** Minecraft's fixed per-direction block shading. */
const SHADE: Record<Dir, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, east: 0.6, west: 0.6 }

const rad = (d: number) => (d * Math.PI) / 180
function rotAxis(p: V3, axis: 'x' | 'y' | 'z', deg: number, o: V3): V3 {
  const c = Math.cos(rad(deg))
  const s = Math.sin(rad(deg))
  const x = p[0] - o[0]
  const y = p[1] - o[1]
  const z = p[2] - o[2]
  if (axis === 'x') return [x + o[0], y * c - z * s + o[1], y * s + z * c + o[2]]
  if (axis === 'y') return [x * c + z * s + o[0], y + o[1], -x * s + z * c + o[2]]
  return [x * c - y * s + o[0], x * s + y * c + o[1], z + o[2]]
}

/**
 * Draws the model into a size×size RGBA icon. `texture(ref)` returns decoded textures; `tint(i)`
 * gives the colour multiplier for tinted faces (grass, leaves…).
 */
export function renderModel(model: ResolvedModel, texture: (ref: string) => Img | null, tint: (index: number) => V3, size = 64): Buffer | null {
  const px = new Uint8Array(size * size * 4)
  const zb = new Float32Array(size * size).fill(-Infinity)
  const [rx, ry, rz] = model.gui.rotation
  const sc = model.gui.scale
  const tr = model.gui.translation
  const C: V3 = [8, 8, 8]
  // inventory view: model rotation, then scale; +z points at the viewer, +y up
  const view = (p: V3): V3 => {
    let q = rotAxis(p, 'y', -ry, C)
    q = rotAxis(q, 'x', rx, C)
    q = rotAxis(q, 'z', rz, C)
    const k = size / 16
    return [size / 2 + ((q[0] - 8) * sc[0] + tr[0]) * k, size / 2 - ((q[1] - 8) * sc[1] + tr[1]) * k, (q[2] - 8) * sc[2]]
  }
  let drawn = 0
  for (const el of model.elements) {
    const a = el.from
    const b = el.to
    for (const dir of Object.keys(el.faces ?? {}) as Dir[]) {
      const face = el.faces![dir]!
      const ref = textureRef(model.textures, face.texture)
      const img = ref ? texture(ref) : null
      if (!img || !CORNERS[dir]) continue
      let corners = CORNERS[dir](a, b)
      if (el.rotation) corners = corners.map((p) => rotAxis(p, el.rotation!.axis, el.rotation!.angle, el.rotation!.origin))
      const P = corners.map(view)
      // back faces (pointing away from the viewer) are skipped
      const cross = (P[1][0] - P[0][0]) * (P[3][1] - P[0][1]) - (P[1][1] - P[0][1]) * (P[3][0] - P[0][0])
      if (cross <= 0) continue
      const uv = face.uv ?? DEFAULT_UV[dir](a, b)
      let UV: [number, number][] = [
        [uv[0], uv[1]],
        [uv[2], uv[1]],
        [uv[2], uv[3]],
        [uv[0], uv[3]]
      ]
      const turns = (((face.rotation ?? 0) / 90) % 4 + 4) % 4
      for (let t = 0; t < turns; t++) UV = [UV[3], UV[0], UV[1], UV[2]]
      const fw = img.w
      const fh = Math.min(img.h, img.w) // animated textures: first frame
      const shade = SHADE[dir]
      const tc = face.tintindex !== undefined ? tint(face.tintindex) : ([1, 1, 1] as V3)
      for (const [i0, i1, i2] of [
        [0, 1, 2],
        [0, 2, 3]
      ]) {
        const p0 = P[i0]
        const p1 = P[i1]
        const p2 = P[i2]
        const den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1])
        if (Math.abs(den) < 1e-9) continue
        const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])))
        const maxX = Math.min(size - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])))
        const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])))
        const maxY = Math.min(size - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])))
        for (let y = minY; y <= maxY; y++)
          for (let x = minX; x <= maxX; x++) {
            const cx = x + 0.5
            const cy = y + 0.5
            const w0 = ((p1[1] - p2[1]) * (cx - p2[0]) + (p2[0] - p1[0]) * (cy - p2[1])) / den
            const w1 = ((p2[1] - p0[1]) * (cx - p2[0]) + (p0[0] - p2[0]) * (cy - p2[1])) / den
            const w2 = 1 - w0 - w1
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue
            const z = w0 * p0[2] + w1 * p1[2] + w2 * p2[2]
            const i = y * size + x
            if (z <= zb[i]) continue
            const u = w0 * UV[i0][0] + w1 * UV[i1][0] + w2 * UV[i2][0]
            const v = w0 * UV[i0][1] + w1 * UV[i1][1] + w2 * UV[i2][1]
            const tx = Math.min(fw - 1, Math.max(0, Math.floor((u / 16) * fw)))
            const ty = Math.min(fh - 1, Math.max(0, Math.floor((v / 16) * fh)))
            const s = (ty * img.w + tx) * 4
            const alpha = img.px[s + 3]
            if (alpha < 16) continue
            zb[i] = z
            const d = i * 4
            px[d] = Math.min(255, img.px[s] * shade * tc[0])
            px[d + 1] = Math.min(255, img.px[s + 1] * shade * tc[1])
            px[d + 2] = Math.min(255, img.px[s + 2] * shade * tc[2])
            px[d + 3] = Math.max(px[d + 3], alpha)
            drawn++
          }
      }
    }
  }
  if (!drawn) return null
  return encodePng(size, size, (x, y) => {
    const d = (y * size + x) * 4
    return [px[d], px[d + 1], px[d + 2], px[d + 3]]
  })
}

/** Default tints for inventory icons (grass / foliage colours used by vanilla item colours). */
export function defaultTint(id: string): V3 {
  const hex = id.includes('spruce') ? 0x619961 : id.includes('birch') ? 0x80a755 : /leaves|vine|lily_pad/.test(id) ? 0x48b518 : 0x7cbd6b
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
}
