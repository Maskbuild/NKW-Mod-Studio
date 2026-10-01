/**
 * Blockbench / Java block model helpers. Pure functions (no fs).
 */

export interface JavaModel {
  parent?: string
  textures?: Record<string, string>
  elements?: {
    from: number[]
    to: number[]
    rotation?: { angle: number; axis: 'x' | 'y' | 'z'; origin: number[]; rescale?: boolean }
    shade?: boolean
    faces: Record<string, { uv?: number[]; texture: string; rotation?: number; cullface?: string; tintindex?: number }>
  }[]
  display?: Record<string, unknown>
  ambientocclusion?: boolean
  render_type?: string
  [k: string]: unknown
}

export type Box = [number, number, number, number, number, number]

const FACES = ['north', 'east', 'south', 'west', 'up', 'down']
const ANGLES = [-45, -22.5, 0, 22.5, 45]
const round = (v: number) => Math.round(v * 1000) / 1000

/** Texture variable names in slot order (#0, #1, …); particle excluded. */
export function textureKeys(model: JavaModel): string[] {
  const keys = Object.keys(model.textures ?? {}).filter((k) => k !== 'particle')
  return keys.sort((a, b) => {
    const na = Number(a)
    const nb = Number(b)
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
    return a.localeCompare(b)
  })
}

export function parseJavaModel(text: string): JavaModel {
  const m = JSON.parse(text) as JavaModel
  if (typeof m !== 'object' || m === null || Array.isArray(m)) throw new Error('Model must be a JSON object')
  if (!Array.isArray(m.elements) && typeof m.parent !== 'string') throw new Error('Model has no elements')
  if (Array.isArray(m.elements) && m.elements.length > 2048) throw new Error('Model has too many elements')
  return m
}

/**
 * Rewrites the model's texture table so slot i points at `refs[i]`.
 * Unknown vars fall back to slot 0.
 */
export function remapTextures(model: JavaModel, refs: string[], renderType?: string): JavaModel {
  const keys = textureKeys(model)
  const out: JavaModel = { ...model }
  delete out.credit
  delete out.texture_size
  delete out.parent
  const textures: Record<string, string> = {}
  keys.forEach((k, i) => (textures[k] = refs[i] ?? refs[0]))
  textures.particle = refs[0]
  if (!keys.length && refs[0]) textures['0'] = refs[0]
  out.textures = textures
  if (renderType) out.render_type = renderType
  else delete out.render_type
  if (!model.elements && model.parent) out.parent = model.parent
  return out
}

/** Collision boxes (0-16 space) from the model elements, capped for performance. */
export function shapeBoxes(model: JavaModel): Box[] {
  const els = model.elements ?? []
  const clamp = (v: number) => Math.min(32, Math.max(-16, Number(v) || 0))
  const boxes: Box[] = els
    .filter((e) => Array.isArray(e.from) && Array.isArray(e.to))
    .map((e) => {
      const a = e.from.map(clamp)
      const b = e.to.map(clamp)
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])].map(
        round
      ) as Box
    })
    .filter((b) => b[3] - b[0] > 0.01 && b[4] - b[1] > 0.01 && b[5] - b[2] > 0.01)
  if (!boxes.length) return [[0, 0, 0, 16, 16, 16]]
  if (boxes.length <= 48) return boxes
  const bb: Box = [16, 16, 16, 0, 0, 0]
  for (const b of boxes) {
    for (let i = 0; i < 3; i++) bb[i] = Math.min(bb[i], b[i])
    for (let i = 3; i < 6; i++) bb[i] = Math.max(bb[i], b[i])
  }
  return [bb]
}

/** Rotates boxes around the block centre (clockwise seen from above), matching blockstate "y". */
export function rotateBoxes(boxes: Box[], deg: 0 | 90 | 180 | 270): Box[] {
  let out = boxes
  for (let r = 0; r < deg / 90; r++) out = out.map(([x1, y1, z1, x2, y2, z2]) => [round(16 - z2), y1, x1, round(16 - z1), y2, x2] as Box)
  return out
}

// ───────────── .bbmodel conversion ─────────────

interface BBTexture {
  name?: string
  source?: string
  uv_width?: number
  uv_height?: number
  width?: number
  height?: number
}
interface BBElement {
  type?: string
  from: number[]
  to: number[]
  origin?: number[]
  rotation?: number[]
  shade?: boolean
  faces?: Record<string, { uv?: number[]; texture?: number | null; rotation?: number; cullface?: string; tint?: number }>
  visibility?: boolean
}
interface BBModel {
  meta?: { model_format?: string }
  resolution?: { width: number; height: number }
  elements?: BBElement[]
  textures?: BBTexture[]
  display?: Record<string, unknown>
}

export interface ConvertedModel {
  model: JavaModel
  /** PNG bytes (base64, no data: prefix) for every texture, in slot order */
  textures: { name: string; base64: string }[]
}

export function convertBBModel(text: string): ConvertedModel {
  const bb = JSON.parse(text) as BBModel
  if (!bb || !Array.isArray(bb.elements)) throw new Error('Not a Blockbench model')
  if (bb.elements.length > 2048) throw new Error('Model has too many elements')
  const resW = bb.resolution?.width || 16
  const resH = bb.resolution?.height || 16
  const texList = bb.textures ?? []

  const elements: NonNullable<JavaModel['elements']> = []
  for (const e of bb.elements) {
    if ((e.type && e.type !== 'cube') || e.visibility === false) continue
    const faces: NonNullable<JavaModel['elements']>[number]['faces'] = {}
    for (const f of FACES) {
      const face = e.faces?.[f]
      if (!face || face.texture === null || face.texture === undefined) continue
      const tex = texList[face.texture]
      const w = tex?.uv_width || resW
      const h = tex?.uv_height || resH
      const uv = (face.uv ?? [0, 0, w, h]).map((v, i) => round((v * 16) / (i % 2 === 0 ? w : h)))
      faces[f] = { uv, texture: `#${face.texture}` }
      if (face.rotation) faces[f].rotation = face.rotation
      if (face.cullface) faces[f].cullface = face.cullface
      if (typeof face.tint === 'number' && face.tint >= 0) faces[f].tintindex = face.tint
    }
    if (!Object.keys(faces).length) continue
    const el: NonNullable<JavaModel['elements']>[number] = { from: e.from.map(round), to: e.to.map(round), faces }
    const rot = e.rotation ?? [0, 0, 0]
    const axisIdx = rot.findIndex((v) => Math.abs(v) > 0.001)
    if (axisIdx >= 0) {
      const snapped = ANGLES.reduce((best, a) => (Math.abs(a - rot[axisIdx]) < Math.abs(best - rot[axisIdx]) ? a : best), 0)
      if (snapped !== 0) el.rotation = { angle: snapped, axis: (['x', 'y', 'z'] as const)[axisIdx], origin: (e.origin ?? [8, 8, 8]).map(round) }
    }
    if (e.shade === false) el.shade = false
    elements.push(el)
  }

  const textures: Record<string, string> = {}
  const outTex: ConvertedModel['textures'] = []
  texList.forEach((t, i) => {
    textures[String(i)] = `#tex${i}`
    const src = t.source ?? ''
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(src)
    outTex.push({ name: t.name ?? `texture_${i}`, base64: m ? m[1] : '' })
  })

  return { model: { textures, elements, ...(bb.display ? { display: bb.display } : {}) }, textures: outTex }
}
