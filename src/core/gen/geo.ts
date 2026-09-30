import type { ArmorSlot } from '../ir'

/**
 * GeckoLib (Bedrock) geometry helpers shared by the generator and the 3D preview:
 * .bbmodel → .geo.json conversion, attaching any model to the armor bones of a slot, and baking the
 * per-piece fit (position / rotation / size) into the model.
 *
 * Geo space is Blockbench's Bedrock export space: the model faces −z (north), its right side is −x,
 * 1 unit = 1 pixel, feet at y = 0. GeckoLib mirrors x when it builds the model.
 */

export type V3 = [number, number, number]
export interface GeoFaceUv {
  uv: [number, number]
  uv_size: [number, number]
}
export interface GeoCube {
  origin: V3
  size: V3
  pivot?: V3
  rotation?: V3
  inflate?: number
  mirror?: boolean
  uv?: [number, number] | Partial<Record<'north' | 'south' | 'east' | 'west' | 'up' | 'down', GeoFaceUv>>
}
export interface GeoBone {
  name: string
  parent?: string
  pivot?: V3
  rotation?: V3
  mirror?: boolean
  cubes?: GeoCube[]
}
export interface GeoFile {
  format_version: string
  'minecraft:geometry': { description: Record<string, unknown> & { texture_width?: number; texture_height?: number }; bones?: GeoBone[] }[]
}

/** Per-piece fit, in geo space: move (pixels), turn (degrees) and size (×). */
export interface ArmorFit {
  offset: V3
  rotation: V3
  scale: V3
}
export const NO_FIT: ArmorFit = { offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
export const isNoFit = (f: ArmorFit | null | undefined): boolean =>
  !f || (f.offset.every((v) => v === 0) && f.rotation.every((v) => v === 0) && f.scale.every((v) => v === 1))

/** Bones GeckoLib shows for each armor slot. */
export const SLOT_BONES: Record<ArmorSlot, string[]> = {
  helmet: ['armorHead'],
  chestplate: ['armorBody', 'armorRightArm', 'armorLeftArm'],
  leggings: ['armorRightLeg', 'armorLeftLeg'],
  boots: ['armorRightBoot', 'armorLeftBoot']
}

/** Where each armor bone sits on the player (pivot) and the body part it covers (Steve proportions). */
export const PLAYER_PARTS: Record<string, { pivot: V3; from: V3; to: V3 }> = {
  armorHead: { pivot: [0, 24, 0], from: [-4, 24, -4], to: [4, 32, 4] },
  armorBody: { pivot: [0, 24, 0], from: [-4, 12, -2], to: [4, 24, 2] },
  armorRightArm: { pivot: [-5, 22, 0], from: [-8, 12, -2], to: [-4, 24, 2] },
  armorLeftArm: { pivot: [5, 22, 0], from: [4, 12, -2], to: [8, 24, 2] },
  armorRightLeg: { pivot: [-1.9, 12, 0], from: [-4, 0, -2], to: [0, 12, 2] },
  armorLeftLeg: { pivot: [1.9, 12, 0], from: [0, 0, -2], to: [4, 12, 2] },
  armorRightBoot: { pivot: [-1.9, 12, 0], from: [-4, 0, -2], to: [0, 4, 2] },
  armorLeftBoot: { pivot: [1.9, 12, 0], from: [0, 0, -2], to: [4, 4, 2] }
}
const ARMOR_BONES = Object.keys(PLAYER_PARTS)

export const FIT_PREFIX = 'nkw_fit_'
/** Name of the looping GeckoLib animation that carries the fit scale. */
export const FIT_ANIMATION = 'animation.nkw.fit'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

// ───────────── .bbmodel → .geo.json ─────────────

interface BBElement {
  name?: string
  uuid: string
  type?: string
  from: V3
  to: V3
  origin?: V3
  rotation?: V3
  inflate?: number
  box_uv?: boolean
  uv_offset?: [number, number]
  mirror_uv?: boolean
  faces?: Record<string, { uv?: number[]; texture?: number | null }>
  visibility?: boolean
}
interface BBGroup {
  name: string
  uuid?: string
  origin?: V3
  rotation?: V3
  children?: (string | BBGroup)[]
  visibility?: boolean
}
interface BBModel {
  meta?: { model_format?: string; box_uv?: boolean }
  resolution?: { width: number; height: number }
  elements?: BBElement[]
  outliner?: (string | BBGroup)[]
  textures?: { name?: string; source?: string }[]
}

/** True for Blockbench projects meant for entities/armor (bones), false for Java block/item models. */
export function isEntityBBModel(text: string): boolean {
  try {
    const bb = JSON.parse(text) as BBModel
    const f = bb.meta?.model_format ?? ''
    return f !== 'java_block' && f !== 'free' ? true : JSON.stringify(bb.outliner ?? []).includes('"armor')
  } catch {
    return false
  }
}

const FACES = ['north', 'south', 'east', 'west', 'up', 'down'] as const

/**
 * Converts a Blockbench project the way Blockbench's Bedrock/GeckoLib export does: x is mirrored,
 * x/y rotations are negated, box UV stays box UV, and per-face up/down UVs are stored flipped.
 * Java block projects (0–16 block space) are centred on x/z first.
 */
export function bbmodelToGeo(text: string, identifier = 'geometry.nkw'): { geo: GeoFile; textures: { name: string; base64: string | null }[] } {
  const bb = JSON.parse(text) as BBModel
  const javaBlock = bb.meta?.model_format === 'java_block'
  const shift: V3 = javaBlock ? [-8, 0, -8] : [0, 0, 0]
  const tw = bb.resolution?.width ?? 16
  const th = bb.resolution?.height ?? 16
  const elements = new Map((bb.elements ?? []).map((e) => [e.uuid, e]))
  const bones: GeoBone[] = []
  const used = new Set<string>()
  const names = new Set<string>()
  const uniqueName = (n: string) => {
    let name = (n || 'bone').replace(/[^A-Za-z0-9_.-]/g, '_')
    for (let i = 2; names.has(name); i++) name = `${n}_${i}`
    names.add(name)
    return name
  }
  const neg = (v: number) => (v === 0 ? 0 : -v)
  const pos = (v: V3 | undefined): V3 => {
    const p = add(v ?? [0, 0, 0], shift)
    return [neg(p[0]), p[1], p[2]]
  }
  const rot = (r: V3 | undefined): V3 | undefined => (r && r.some((x) => x !== 0) ? [neg(r[0]), neg(r[1]), r[2]] : undefined)
  const cube = (e: BBElement): GeoCube | null => {
    if (e.type && e.type !== 'cube') return null
    const from = add(e.from, shift)
    const to = add(e.to, shift)
    const size: V3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const c: GeoCube = { origin: [-(from[0] + size[0]), from[1], from[2]], size }
    const r = rot(e.rotation)
    if (r) {
      c.rotation = r
      c.pivot = pos(e.origin)
    }
    if (e.inflate) c.inflate = e.inflate
    const box = e.box_uv ?? bb.meta?.box_uv ?? false
    if (box) {
      c.uv = [e.uv_offset?.[0] ?? 0, e.uv_offset?.[1] ?? 0]
      if (e.mirror_uv) c.mirror = true
    } else {
      const uv: Partial<Record<(typeof FACES)[number], GeoFaceUv>> = {}
      for (const f of FACES) {
        const face = e.faces?.[f]
        if (!face?.uv || face.texture === null || face.texture === undefined) continue
        const [u1, v1, u2, v2] = face.uv
        uv[f] = f === 'up' || f === 'down' ? { uv: [u2, v2], uv_size: [u1 - u2, v1 - v2] } : { uv: [u1, v1], uv_size: [u2 - u1, v2 - v1] }
      }
      c.uv = uv
    }
    return c
  }
  const walk = (g: BBGroup, parent?: string) => {
    const bone: GeoBone = { name: uniqueName(g.name), pivot: pos(g.origin) }
    if (parent) bone.parent = parent
    const r = rot(g.rotation)
    if (r) bone.rotation = r
    const cubes: GeoCube[] = []
    bones.push(bone)
    for (const ch of g.children ?? []) {
      if (typeof ch === 'string') {
        const e = elements.get(ch)
        const c = e && cube(e)
        if (c) cubes.push(c)
        used.add(ch)
      } else walk(ch, bone.name)
    }
    if (cubes.length) bone.cubes = cubes
  }
  const loose: GeoCube[] = []
  for (const node of bb.outliner ?? []) {
    if (typeof node === 'string') {
      const e = elements.get(node)
      const c = e && cube(e)
      if (c) loose.push(c)
      used.add(node)
    } else walk(node)
  }
  // elements not listed in the outliner (older files) go to a root bone
  for (const e of bb.elements ?? []) if (!used.has(e.uuid)) (cube(e) && loose.push(cube(e)!))
  if (loose.length) bones.unshift({ name: uniqueName('root'), pivot: [0, 0, 0], cubes: loose })

  const textures = (bb.textures ?? []).map((t, i) => {
    const m = /^data:image\/png;base64,(.+)$/.exec(t.source ?? '')
    return { name: t.name || `texture_${i}`, base64: m ? m[1] : null }
  })
  const geo: GeoFile = {
    format_version: '1.12.0',
    'minecraft:geometry': [{ description: { identifier, texture_width: tw, texture_height: th, visible_bounds_width: 3, visible_bounds_height: 3.5, visible_bounds_offset: [0, 1.25, 0] }, bones }]
  }
  return { geo, textures }
}

// ───────────── Java block/item model (.json) → .geo.json ─────────────

interface JavaModelLike {
  textures?: Record<string, string>
  elements?: {
    from: number[]
    to: number[]
    rotation?: { angle: number; axis: 'x' | 'y' | 'z'; origin: number[] }
    faces?: Record<string, { uv?: number[]; texture?: string }>
  }[]
}

const JAVA_DEFAULT_UV: Record<string, (a: number[], b: number[]) => number[]> = {
  north: (a, b) => [16 - b[0], 16 - b[1], 16 - a[0], 16 - a[1]],
  south: (a, b) => [a[0], 16 - b[1], b[0], 16 - a[1]],
  west: (a, b) => [a[2], 16 - b[1], b[2], 16 - a[1]],
  east: (a, b) => [16 - b[2], 16 - b[1], 16 - a[2], 16 - a[1]],
  up: (a, b) => [a[0], a[2], b[0], b[2]],
  down: (a, b) => [a[0], 16 - b[2], b[0], 16 - a[2]]
}

/**
 * Converts a Java block/item model (e.g. a Blockbench "Java Block/Item" export) for use as armor.
 * GeckoLib armor takes one texture, so the model's textures (in `textureKeys` order) are expected
 * stacked vertically in one sheet, 16×16 UV units each: texture i covers v = 16i … 16i+16.
 */
export function javaModelToGeo(model: JavaModelLike, textureKeys: string[], textureCount: number, identifier = 'geometry.nkw'): GeoFile {
  const count = Math.max(1, textureCount)
  const index = (ref: string | undefined): number => {
    const i = textureKeys.indexOf((ref ?? '').replace(/^#/, ''))
    return Math.min(count - 1, Math.max(0, i))
  }
  const elements: BBElement[] = (model.elements ?? []).map((e, n) => {
    const r = e.rotation
    const faces: BBElement['faces'] = {}
    for (const [f, face] of Object.entries(e.faces ?? {})) {
      if (!JAVA_DEFAULT_UV[f]) continue
      const uv = face.uv ?? JAVA_DEFAULT_UV[f](e.from, e.to)
      const dv = 16 * index(face.texture)
      faces[f] = { uv: [uv[0], uv[1] + dv, uv[2], uv[3] + dv], texture: 0 }
    }
    return {
      uuid: `e${n}`,
      from: e.from as V3,
      to: e.to as V3,
      origin: (r?.origin ?? [8, 8, 8]) as V3,
      rotation: r ? ([r.axis === 'x' ? r.angle : 0, r.axis === 'y' ? r.angle : 0, r.axis === 'z' ? r.angle : 0] as V3) : undefined,
      box_uv: false,
      faces
    }
  })
  const bb: BBModel = {
    meta: { model_format: 'java_block', box_uv: false },
    resolution: { width: 16, height: 16 * count },
    elements,
    outliner: [{ name: 'model', origin: [8, 0, 8], children: elements.map((e) => e.uuid) }]
  }
  return bbmodelToGeo(JSON.stringify(bb), identifier).geo
}

// ───────────── armor fitting ─────────────

export function geoBones(geo: GeoFile): GeoBone[] {
  return geo['minecraft:geometry']?.[0]?.bones ?? []
}

/** Every bone below `root` (itself included). */
function subtree(bones: GeoBone[], root: string): GeoBone[] {
  const out = bones.filter((b) => b.name === root)
  for (let i = 0; i < out.length; i++) for (const b of bones) if (b.parent === out[i].name && !out.includes(b)) out.push(b)
  return out
}

function bounds(cubes: GeoCube[]): { min: V3; max: V3 } | null {
  if (!cubes.length) return null
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  for (const c of cubes)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], c.origin[k])
      max[k] = Math.max(max[k], c.origin[k] + c.size[k])
    }
  return { min, max }
}

/**
 * Makes sure the model has the armor bones of `slot`. A model without any armor bones (e.g. a hat
 * made in Blockbench as a plain model) is placed on that body part: centred on it horizontally and
 * resting on top of the head for helmets, on the feet for boots, covering the part otherwise.
 * Leggings/boots/chestplate arms get a copy per side.
 */
export function attachToSlot(input: GeoFile, slot: ArmorSlot): GeoFile {
  const geo = clone(input)
  const g = geo['minecraft:geometry'][0]
  const bones = g.bones ?? []
  if (bones.some((b) => ARMOR_BONES.includes(b.name))) return geo
  const all = bones.flatMap((b) => b.cubes ?? [])
  const bb = bounds(all)
  if (!bb) return geo
  const targets = slot === 'chestplate' ? ['armorBody'] : SLOT_BONES[slot]
  const out: GeoBone[] = []
  for (const target of targets) {
    const part = PLAYER_PARTS[target]
    const cx = (part.from[0] + part.to[0]) / 2
    const cz = (part.from[2] + part.to[2]) / 2
    // helmets sit on top of the head, boots on the ground, everything else is centred on the part
    const dy = slot === 'helmet' ? part.to[1] - bb.min[1] : slot === 'boots' ? -bb.min[1] : (part.from[1] + part.to[1]) / 2 - (bb.min[1] + bb.max[1]) / 2
    const delta: V3 = [cx - (bb.min[0] + bb.max[0]) / 2, dy, cz - (bb.min[2] + bb.max[2]) / 2]
    const suffix = targets.length > 1 ? `_${target}` : ''
    out.push({ name: target, pivot: part.pivot })
    for (const b of bones) {
      const nb = clone(b)
      nb.name = b.name + suffix
      nb.parent = b.parent ? b.parent + suffix : target
      if (nb.pivot) nb.pivot = add(nb.pivot, delta)
      for (const c of nb.cubes ?? []) {
        c.origin = add(c.origin, delta)
        if (c.pivot) c.pivot = add(c.pivot, delta)
      }
      out.push(nb)
    }
  }
  g.bones = out
  return geo
}

/**
 * Bakes the fit into the model: each armor bone of the slot gets a child "nkw_fit_<bone>" bone holding
 * everything that was under it. The fit bone pivots on the centre of that geometry, carries the
 * rotation, and all its geometry is moved by the offset. Scale is applied by GeckoLib at run time
 * through the fit animation (see fitAnimation), so the texture mapping is never touched.
 */
export function applyFit(input: GeoFile, slot: ArmorSlot, fit: ArmorFit): GeoFile {
  const geo = clone(input)
  const g = geo['minecraft:geometry'][0]
  let bones = g.bones ?? []
  for (const name of SLOT_BONES[slot]) {
    const bone = bones.find((b) => b.name === name)
    if (!bone) continue
    const tree = subtree(bones, name)
    const bb = bounds(tree.flatMap((b) => b.cubes ?? []))
    if (!bb) continue
    const center: V3 = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2]
    const fitName = FIT_PREFIX + name
    const fitBone: GeoBone = { name: fitName, parent: name, pivot: add(center, fit.offset) }
    if (fit.rotation.some((v) => v !== 0)) fitBone.rotation = [...fit.rotation]
    fitBone.cubes = bone.cubes
    delete bone.cubes
    for (const b of tree) {
      if (b === bone) continue
      if (b.parent === name) b.parent = fitName
      if (b.pivot) b.pivot = add(b.pivot, fit.offset)
    }
    for (const b of [fitBone, ...tree.filter((t) => t !== bone)])
      for (const c of b.cubes ?? []) {
        c.origin = add(c.origin, fit.offset)
        if (c.pivot) c.pivot = add(c.pivot, fit.offset)
      }
    const at = bones.indexOf(bone)
    bones = [...bones.slice(0, at + 1), fitBone, ...bones.slice(at + 1)]
  }
  g.bones = bones
  return geo
}

/** Animation GeckoLib loops for a piece: the chosen one, or the fit-only one when only the size changed. */
export function geoLoopName(animation: { name: string } | null, fit: ArmorFit | null | undefined): string | null {
  if (animation) return animation.name
  return fit && fit.scale.some((v) => v !== 1) ? FIT_ANIMATION : null
}

/** Reads a fit stored in node data, clamped to sane ranges. */
export function parseFit(raw: unknown): ArmorFit | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const v3 = (v: unknown, def: number, lo: number, hi: number): V3 => {
    const a = Array.isArray(v) ? v : []
    return [0, 1, 2].map((i) => {
      const n = Number(a[i])
      return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def
    }) as V3
  }
  const fit: ArmorFit = { offset: v3(r.offset, 0, -32, 32), rotation: v3(r.rotation, 0, -180, 180), scale: v3(r.scale, 1, 0.1, 4) }
  return isNoFit(fit) ? null : fit
}

/** The model as it will be in game for one armor piece. */
export function prepareArmorGeo(geo: GeoFile, slot: ArmorSlot, fit: ArmorFit | null | undefined): GeoFile {
  const attached = attachToSlot(geo, slot)
  return isNoFit(fit) ? attached : applyFit(attached, slot, fit!)
}

interface AnimFile {
  format_version?: string
  animations?: Record<string, { loop?: boolean | string; animation_length?: number; bones?: Record<string, Record<string, unknown>> }>
  [k: string]: unknown
}

/**
 * Adds a constant scale on the fit bones to the looping animation (or makes a fit-only animation
 * when the piece has none). Returns the animation file and the name to loop.
 */
export function fitAnimation(anim: AnimFile | null, loopName: string | null, slot: ArmorSlot, fit: ArmorFit): { file: AnimFile; name: string } {
  const file: AnimFile = anim ? clone(anim) : { format_version: '1.8.0', animations: {}, geckolib_format_version: 2 }
  file.animations ??= {}
  const name = loopName ?? FIT_ANIMATION
  const a = (file.animations[name] ??= { loop: true, animation_length: 1, bones: {} })
  a.bones ??= {}
  if (!a.animation_length) a.animation_length = 1
  const s = fit.scale
  // a constant value (no keyframes): accepted by every GeckoLib version
  for (const bone of SLOT_BONES[slot]) a.bones[FIT_PREFIX + bone] = { scale: [...s] }
  return { file, name }
}
