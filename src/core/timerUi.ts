import { z } from 'zod'

/**
 * The timer window (picking crops by hand, breaking blocks): a small document of elements (rectangles, bars,
 * rings, text, images) with fills, borders and animations. `resolveLayout` turns a document into plain drawing
 * commands. The editor's preview and the game (a Java port of this function, checked against it by the tests)
 * both draw those commands, so what is seen in the editor is what the game shows.
 *
 * All sizes are in GUI pixels (the game's scaled screen). Colours are #rrggbb, opacities whole percents.
 */

export const TIMER_VERSION = 2

export const ANCHORS = ['topLeft', 'top', 'topRight', 'left', 'center', 'right', 'bottomLeft', 'bottom', 'bottomRight'] as const
export type Anchor = (typeof ANCHORS)[number]
const A9: Record<Anchor, [number, number]> = {
  topLeft: [0, 0],
  top: [0.5, 0],
  topRight: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottomLeft: [0, 1],
  bottom: [0.5, 1],
  bottomRight: [1, 1]
}

/** Where on the screen the window's box sits. */
export const PLACES = ['crosshair', 'hotbar', 'top', 'center', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const
export type Place = (typeof PLACES)[number]

const HEX = /^#[0-9a-fA-F]{6}$/
const hex = z.string().regex(HEX)
const pct = z.number().int().min(0).max(100)
const px = (lo: number, hi: number) => z.number().min(lo).max(hi)

const FillSchema = z.strictObject({
  kind: z.enum(['solid', 'linear']),
  color: hex,
  /** second colour of a linear gradient */
  to: hex.optional(),
  /** gradient direction: down the element (true) or across it */
  vertical: z.boolean().optional(),
  alpha: pct.default(100),
  /** opacity at the other end of a gradient */
  alphaTo: pct.optional()
})
export type Fill = z.infer<typeof FillSchema>

const BorderSchema = z.strictObject({ width: z.number().int().min(1).max(8), color: hex, alpha: pct.default(100) })

const EASE = ['linear', 'in', 'out', 'inOut'] as const
const AnimSchema = z.strictObject({
  prop: z.enum(['opacity', 'x', 'y', 'scale', 'color']),
  /** time: runs from when the window appears; progress: follows the progress; low: runs while the last 3 seconds count down */
  trigger: z.enum(['time', 'progress', 'low']),
  /** numbers: opacity in percent, x / y in pixels, scale as a factor; colours for "color" */
  from: z.union([z.number(), hex]),
  to: z.union([z.number(), hex]),
  /** length of one run in ticks (20 = one second) */
  ticks: z.number().int().min(1).max(2400).default(20),
  delay: z.number().int().min(0).max(2400).default(0),
  ease: z.enum(EASE).default('linear'),
  loop: z.enum(['once', 'repeat', 'pingpong']).default('once')
})
export type Anim = z.infer<typeof AnimSchema>

const BaseShape = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,24}$/),
  anchor: z.enum(ANCHORS).default('topLeft'),
  x: px(-1000, 1000).default(0),
  y: px(-1000, 1000).default(0),
  w: px(0, 1000).default(0),
  h: px(0, 1000).default(0),
  opacity: pct.default(100),
  /** when the element is drawn */
  show: z.enum(['always', 'harvest', 'mining', 'low']).default('always'),
  anims: z.array(AnimSchema).max(8).default([])
}

const ElementSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...BaseShape, type: z.literal('rect'), fill: FillSchema, border: BorderSchema.optional() }),
  z.strictObject({
    ...BaseShape,
    type: z.literal('bar'),
    fill: FillSchema,
    /** drawn behind the bar, `pad` pixels bigger on every side */
    back: FillSchema.nullable().default(null),
    pad: z.number().int().min(0).max(8).default(0),
    border: BorderSchema.optional(),
    dir: z.enum(['ltr', 'rtl', 'ttb', 'btt']).default('ltr')
  }),
  z.strictObject({
    ...BaseShape,
    type: z.literal('ring'),
    fill: FillSchema,
    back: FillSchema.nullable().default(null),
    radius: z.number().int().min(3).max(60),
    /** thickness >= radius makes a filled disc */
    thickness: z.number().int().min(1).max(60),
    /** where it starts, in degrees clockwise from the top */
    start: z.number().min(0).max(360).default(0),
    cw: z.boolean().default(true)
  }),
  z.strictObject({
    ...BaseShape,
    type: z.literal('text'),
    /** {seconds} time left, {percent} 0–100, {bar} ten squares */
    text: z.string().max(120),
    textTh: z.string().max(120).optional(),
    color: hex,
    shadow: z.boolean().default(true),
    scale: px(0.5, 4).default(1),
    align: z.enum(['left', 'center', 'right']).default('left')
  }),
  z.strictObject({
    ...BaseShape,
    type: z.literal('image'),
    /** a PNG of the project (textures/…) */
    asset: z.string().max(200),
    /** the PNG's own size in pixels (the editor fills it in) */
    texW: z.number().int().min(1).max(4096).default(16),
    texH: z.number().int().min(1).max(4096).default(16),
    tint: hex.nullable().default(null)
  })
])
export type TimerElement = z.infer<typeof ElementSchema>

export const TimerDocSchema = z.strictObject({
  v: z.literal(TIMER_VERSION),
  place: z.strictObject({ at: z.enum(PLACES), x: px(-2000, 2000).default(0), y: px(-2000, 2000).default(0) }),
  /** the window's box; elements are placed inside it */
  size: z.strictObject({ w: px(1, 1000), h: px(1, 1000) }),
  elements: z.array(ElementSchema).min(1).max(48)
})
export type TimerDoc = z.infer<typeof TimerDocSchema>

// ───────── the old timer node (before documents) → a document ─────────

const hexOr = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d)
const num = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d))

/**
 * What a "Timer window" node looked like before documents (style / colours / place …) as a document, drawing the
 * same pixels the old fixed look drew.
 */
export function legacyToDoc(d: Record<string, unknown>): TimerDoc {
  const style = d.style === 'text' || d.style === 'ring' ? d.style : 'bar'
  const color = hexOr(d.color, '#4ade80')
  const back = hexOr(d.back, '#000000')
  const backAlpha = num(d.backOpacity, 50, 0, 100)
  const place = d.place === 'hotbar' || d.place === 'top' ? d.place : 'crosshair'
  const offset = num(d.offset, 0, -200, 200)
  const time = d.time !== false
  const solid = (c: string, alpha = 100): Fill => ({ kind: 'solid', color: c, alpha })
  if (style === 'ring') {
    const radius = num(d.radius, 9, 3, 40)
    const thickness = num(d.thickness, 3, 1, 40)
    return {
      v: 2,
      place: { at: 'center', x: 0, y: 0 },
      size: { w: radius * 2, h: radius * 2 },
      elements: [
        {
          type: 'ring',
          id: 'ring',
          anchor: 'topLeft',
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          opacity: 100,
          show: 'always',
          anims: [],
          fill: solid(color),
          back: backAlpha ? solid(back, backAlpha) : null,
          radius,
          thickness,
          start: 0,
          cw: true
        },
        ...(time
          ? [
              {
                type: 'text' as const,
                id: 'time',
                anchor: 'top' as const,
                x: 0,
                y: radius * 2 + 3,
                w: 0,
                h: 0,
                opacity: 100,
                show: 'always' as const,
                anims: [],
                text: '{seconds} s',
                textTh: '{seconds} วิ',
                color: '#ffffff',
                shadow: true,
                scale: 1,
                align: 'center' as const
              }
            ]
          : [])
      ]
    }
  }
  if (style === 'text') {
    const at: Place = place
    const line = (mode: 'harvest' | 'mining'): TimerElement => ({
      type: 'text',
      id: mode,
      anchor: 'top',
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      opacity: 100,
      show: mode,
      anims: [],
      text: `${mode === 'harvest' ? 'Harvesting' : 'Breaking'} {bar}${time ? ' {seconds} s' : ''}`,
      textTh: `${mode === 'harvest' ? 'กำลังเก็บ' : 'กำลังทุบ'} {bar}${time ? ' {seconds} วิ' : ''}`,
      color,
      shadow: true,
      scale: 1,
      align: 'center'
    })
    return { v: 2, place: { at, x: 0, y: offset }, size: { w: 60, h: 9 }, elements: [line('harvest'), line('mining')] }
  }
  const width = num(d.width, 60, 10, 300)
  const height = num(d.height, 4, 1, 20)
  return {
    v: 2,
    place: { at: place, x: 0, y: offset },
    size: { w: width + 2, h: height + 2 },
    elements: [
      {
        type: 'bar',
        id: 'bar',
        anchor: 'topLeft',
        x: 1,
        y: 1,
        w: width,
        h: height,
        opacity: 100,
        show: 'always',
        anims: [],
        fill: solid(color),
        back: backAlpha ? solid(back, backAlpha) : null,
        pad: 1,
        dir: 'ltr'
      },
      ...(time
        ? [
            {
              type: 'text' as const,
              id: 'time',
              anchor: 'topLeft' as const,
              x: width + 5,
              y: Math.floor(height / 2) - 3,
              w: 0,
              h: 0,
              opacity: 100,
              show: 'always' as const,
              anims: [],
              text: '{seconds} s',
              textTh: '{seconds} วิ',
              color: '#ffffff',
              shadow: true,
              scale: 1,
              align: 'left' as const
            }
          ]
        : [])
    ]
  }
}

// ───────── presets ─────────

const S = (color: string, alpha = 100): Fill => ({ kind: 'solid', color, alpha })
const G = (color: string, to: string, vertical = false): Fill => ({ kind: 'linear', color, to, vertical, alpha: 100 })
const base = { anchor: 'topLeft' as Anchor, x: 0, y: 0, w: 0, h: 0, opacity: 100, show: 'always' as const, anims: [] as Anim[] }

export const TIMER_PRESETS: { id: string; name: { en: string; th: string }; doc: () => TimerDoc }[] = [
  { id: 'bar', name: { en: 'Bar', th: 'หลอด' }, doc: () => legacyToDoc({ style: 'bar' }) },
  { id: 'text', name: { en: 'Text', th: 'ข้อความ' }, doc: () => legacyToDoc({ style: 'text' }) },
  { id: 'ring', name: { en: 'Circle', th: 'วงกลม' }, doc: () => legacyToDoc({ style: 'ring' }) },
  {
    id: 'glow',
    name: { en: 'Glowing bar', th: 'หลอดเรืองแสง' },
    doc: () => ({
      v: 2,
      place: { at: 'crosshair', x: 0, y: 4 },
      size: { w: 84, h: 10 },
      elements: [
        {
          ...base,
          type: 'bar',
          id: 'bar',
          x: 2,
          y: 2,
          w: 80,
          h: 6,
          fill: G('#22d3ee', '#a3e635'),
          back: S('#0f172a', 70),
          pad: 2,
          dir: 'ltr',
          border: { width: 1, color: '#e0f2fe', alpha: 60 },
          anims: [{ prop: 'opacity', trigger: 'low', from: 100, to: 55, ticks: 8, delay: 0, ease: 'inOut', loop: 'pingpong' }]
        },
        { ...base, type: 'text', id: 'pct', anchor: 'top', y: 12, text: '{percent}%', color: '#e0f2fe', shadow: true, scale: 1, align: 'center' }
      ]
    })
  },
  {
    id: 'pill',
    name: { en: 'Pill with time', th: 'แคปซูลพร้อมเวลา' },
    doc: () => ({
      v: 2,
      place: { at: 'hotbar', x: 0, y: -6 },
      size: { w: 110, h: 14 },
      elements: [
        { ...base, type: 'rect', id: 'card', w: 110, h: 14, fill: G('#1e293b', '#0f172a', true), border: { width: 1, color: '#475569', alpha: 100 } },
        { ...base, type: 'bar', id: 'bar', x: 4, y: 4, w: 72, h: 6, fill: G('#f59e0b', '#fde047'), back: S('#000000', 60), pad: 1, dir: 'ltr' },
        {
          ...base,
          type: 'text',
          id: 'time',
          anchor: 'right',
          x: -4,
          y: -4,
          text: '{seconds} s',
          textTh: '{seconds} วิ',
          color: '#fef3c7',
          shadow: true,
          scale: 1,
          align: 'right'
        }
      ]
    })
  },
  {
    id: 'pulse-ring',
    name: { en: 'Pulsing circle', th: 'วงกลมเต้น' },
    doc: () => ({
      v: 2,
      place: { at: 'center', x: 0, y: 0 },
      size: { w: 28, h: 28 },
      elements: [
        {
          ...base,
          type: 'ring',
          id: 'ring',
          x: 0,
          y: 0,
          fill: S('#fb7185'),
          back: S('#000000', 45),
          radius: 14,
          thickness: 4,
          start: 0,
          cw: true,
          anims: [{ prop: 'scale', trigger: 'time', from: 1, to: 1.12, ticks: 12, delay: 0, ease: 'inOut', loop: 'pingpong' }]
        },
        { ...base, type: 'text', id: 'pct', anchor: 'center', text: '{percent}', color: '#ffffff', shadow: true, scale: 1, align: 'center' }
      ]
    })
  }
]

// ───────── validation ─────────

export const defaultTimerDoc = (): TimerDoc => legacyToDoc({})

/** A stored document checked and cleaned; a broken one gives the default look and the reasons. */
export function normalizeDoc(raw: unknown): { doc: TimerDoc; problems: string[] } {
  const r = TimerDocSchema.safeParse(raw)
  if (r.success) return { doc: r.data, problems: [] }
  return { doc: defaultTimerDoc(), problems: r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'timer'}: ${i.message}`) }
}

/** The document of a "Timer window" node's data: its own document, or one made from the old settings. */
export function docOfNode(data: Record<string, unknown>): { doc: TimerDoc; problems: string[] } {
  if (data.doc === undefined || data.doc === null) return { doc: legacyToDoc(data), problems: [] }
  return normalizeDoc(data.doc)
}

/** Project assets (images) a document uses. */
export const docAssets = (doc: TimerDoc): string[] => [...new Set(doc.elements.flatMap((e) => (e.type === 'image' && e.asset ? [e.asset] : [])))]

// ───────── layout ─────────

export interface LayoutInput {
  /** the game's scaled screen */
  screen: { w: number; h: number }
  /** harvesting a crop, or mining a block */
  mode: 'harvest' | 'mining'
  /** 0–1 */
  progress: number
  ticksLeft: number
  /** ticks since the window appeared (animations) */
  time: number
  lang: 'en' | 'th'
}

export type DrawCmd =
  | { k: 'rect'; x1: number; y1: number; x2: number; y2: number; argb: number }
  /** align: 0 left, 1 centre, 2 right of x */
  | { k: 'text'; el: number; text: string; x: number; y: number; align: 0 | 1 | 2; argb: number; shadow: boolean; scale: number }
  | { k: 'image'; el: number; asset: string; x: number; y: number; w: number; h: number; argb: number }

/** The last seconds count as "low" (for `low` animations and elements). */
export const LOW_TICKS = 60

const ease = (name: string, t: number): number => {
  switch (name) {
    case 'in':
      return t * t
    case 'out':
      return 1 - (1 - t) * (1 - t)
    case 'inOut':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
    default:
      return t
  }
}

const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const mixRgb = (a: string, b: string, t: number): [number, number, number] => {
  const x = rgb(a)
  const y = rgb(b)
  return [Math.round(x[0] + (y[0] - x[0]) * t), Math.round(x[1] + (y[1] - x[1]) * t), Math.round(x[2] + (y[2] - x[2]) * t)]
}
/** 0xAARRGGBB as an unsigned number */
const argb = (c: [number, number, number], alpha255: number) => ((alpha255 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]) >>> 0
const a255 = (alphaPct: number, opacityPct: number) => Math.round(Math.round((alphaPct * 255) / 100) * (opacityPct / 100))

/** Seconds left with one decimal, rounding half up on the decimal digit (the game writes it the same way). */
export function fmtSeconds(ticksLeft: number): string {
  const tenths = Math.max(0, Math.floor(ticksLeft / 2 + 0.5))
  return `${Math.floor(tenths / 10)}.${tenths % 10}`
}

const tokens = (text: string, inp: LayoutInput): string => {
  const filled = Math.floor(10 * inp.progress)
  return text
    .replace(/\{bar\}/g, '■'.repeat(filled) + '□'.repeat(10 - filled))
    .replace(/\{seconds\}/g, fmtSeconds(inp.ticksLeft))
    .replace(/\{percent\}/g, String(Math.floor(inp.progress * 100)))
}

interface Anims {
  opacity: number | null
  dx: number
  dy: number
  scale: number
  color: string | null
}

function animate(anims: Anim[], inp: LayoutInput): Anims {
  const out: Anims = { opacity: null, dx: 0, dy: 0, scale: 1, color: null }
  for (const a of anims) {
    let u: number
    if (a.trigger === 'progress') u = inp.progress
    else {
      let t = inp.time
      if (a.trigger === 'low') {
        if (inp.ticksLeft > LOW_TICKS) continue
        t = LOW_TICKS - inp.ticksLeft
      }
      const r = Math.max(0, t - a.delay) / a.ticks
      if (a.loop === 'repeat') u = r - Math.floor(r)
      else if (a.loop === 'pingpong') {
        const m = r - 2 * Math.floor(r / 2)
        u = m <= 1 ? m : 2 - m
      } else u = Math.min(1, r)
    }
    u = ease(a.ease, Math.min(1, Math.max(0, u)))
    if (a.prop === 'color') {
      if (typeof a.from === 'string' && typeof a.to === 'string') {
        const c = mixRgb(a.from, a.to, u)
        out.color = `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
      }
      continue
    }
    if (typeof a.from !== 'number' || typeof a.to !== 'number') continue
    const v = a.from + (a.to - a.from) * u
    if (a.prop === 'opacity') out.opacity = Math.min(100, Math.max(0, v))
    else if (a.prop === 'x') out.dx = v
    else if (a.prop === 'y') out.dy = v
    else out.scale = v
  }
  return out
}

const visible = (show: string, inp: LayoutInput) =>
  show === 'always' ||
  (show === 'harvest' && inp.mode === 'harvest') ||
  (show === 'mining' && inp.mode === 'mining') ||
  (show === 'low' && inp.ticksLeft <= LOW_TICKS)

/** Boxes of pixels for a fill over a rectangle, optionally cut to the first `limit` pixels along `dir`. */
function fillRects(
  out: DrawCmd[],
  x: number,
  y: number,
  w: number,
  h: number,
  f: Fill,
  opacity: number,
  colorOverride: string | null,
  clip: { dir: 'ltr' | 'rtl' | 'ttb' | 'btt'; len: number } | null
) {
  if (w <= 0 || h <= 0) return
  const cut = (x1: number, y1: number, x2: number, y2: number): [number, number, number, number] => {
    if (!clip) return [x1, y1, x2, y2]
    if (clip.dir === 'ltr') return [x1, y1, Math.min(x2, x + clip.len), y2]
    if (clip.dir === 'rtl') return [Math.max(x1, x + w - clip.len), y1, x2, y2]
    if (clip.dir === 'ttb') return [x1, y1, x2, Math.min(y2, y + clip.len)]
    return [x1, Math.max(y1, y + h - clip.len), x2, y2]
  }
  const color = colorOverride ?? f.color
  const push = (x1: number, y1: number, x2: number, y2: number, c: [number, number, number], alphaPct: number) => {
    const [cx1, cy1, cx2, cy2] = cut(x1, y1, x2, y2)
    const a = a255(alphaPct, opacity)
    if (cx2 > cx1 && cy2 > cy1 && a > 0) out.push({ k: 'rect', x1: cx1, y1: cy1, x2: cx2, y2: cy2, argb: argb(c, a) })
  }
  if (f.kind === 'solid' || !f.to) return push(x, y, x + w, y + h, rgb(color), f.alpha)
  const len = f.vertical ? h : w
  const n = Math.floor(Math.max(1, Math.min(64, len)))
  const alphaTo = f.alphaTo ?? f.alpha
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const a0 = Math.round((i * len) / n)
    const a1 = Math.round(((i + 1) * len) / n)
    const c = mixRgb(color, f.to, t)
    const alpha = Math.round(f.alpha + (alphaTo - f.alpha) * t)
    if (f.vertical) push(x, y + a0, x + w, y + a1, c, alpha)
    else push(x + a0, y, x + a1, y + h, c, alpha)
  }
}

/** The drawing commands for a document at one moment. */
export function resolveLayout(doc: TimerDoc, inp: LayoutInput): DrawCmd[] {
  const out: DrawCmd[] = []
  const sw = inp.screen.w
  const sh = inp.screen.h
  const cx = Math.floor(sw / 2)
  const cy = Math.floor(sh / 2)
  const { w: bw, h: bh } = doc.size
  let bx: number
  let by: number
  switch (doc.place.at) {
    case 'crosshair':
      bx = cx - Math.floor(bw / 2)
      by = cy + 10
      break
    case 'hotbar':
      bx = cx - Math.floor(bw / 2)
      by = sh - 50 - bh
      break
    case 'top':
      bx = cx - Math.floor(bw / 2)
      by = 10
      break
    case 'center':
      bx = cx - Math.floor(bw / 2)
      by = cy - Math.floor(bh / 2)
      break
    case 'topLeft':
      bx = 6
      by = 6
      break
    case 'topRight':
      bx = sw - 6 - bw
      by = 6
      break
    case 'bottomLeft':
      bx = 6
      by = sh - 6 - bh
      break
    default:
      bx = sw - 6 - bw
      by = sh - 6 - bh
  }
  bx += doc.place.x
  by += doc.place.y

  doc.elements.forEach((e, index) => {
    if (!visible(e.show, inp)) return
    const an = animate(e.anims, inp)
    const opacity = an.opacity ?? e.opacity
    if (opacity <= 0) return
    const [ax, ay] = A9[e.anchor]
    // size: rings and text have their own; the scale animation grows around the middle
    let w = e.type === 'ring' ? e.radius * 2 : e.w
    let h = e.type === 'ring' ? e.radius * 2 : e.h
    const grow = an.scale
    const baseX = bx + Math.floor(ax * bw) + e.x - Math.floor(ax * w) + an.dx
    const baseY = by + Math.floor(ay * bh) + e.y - Math.floor(ay * h) + an.dy
    let x = baseX
    let y = baseY
    if (grow !== 1 && e.type !== 'text') {
      const nw = Math.round(w * grow)
      const nh = Math.round(h * grow)
      x = baseX - Math.floor((nw - w) / 2)
      y = baseY - Math.floor((nh - h) / 2)
      w = nw
      h = nh
    }
    switch (e.type) {
      case 'rect': {
        if (e.border) {
          const b = e.border
          const c = rgb(b.color)
          const al = a255(b.alpha, opacity)
          if (al > 0 && w > 0 && h > 0) {
            const col = argb(c, al)
            out.push({ k: 'rect', x1: x - b.width, y1: y - b.width, x2: x + w + b.width, y2: y, argb: col })
            out.push({ k: 'rect', x1: x - b.width, y1: y + h, x2: x + w + b.width, y2: y + h + b.width, argb: col })
            out.push({ k: 'rect', x1: x - b.width, y1: y, x2: x, y2: y + h, argb: col })
            out.push({ k: 'rect', x1: x + w, y1: y, x2: x + w + b.width, y2: y + h, argb: col })
          }
        }
        fillRects(out, x, y, w, h, e.fill, opacity, an.color, null)
        break
      }
      case 'bar': {
        if (e.border) {
          const b = e.border
          const c = rgb(b.color)
          const al = a255(b.alpha, opacity)
          const p = e.pad + b.width
          if (al > 0 && w > 0 && h > 0) {
            const col = argb(c, al)
            out.push({ k: 'rect', x1: x - p, y1: y - p, x2: x + w + p, y2: y - e.pad, argb: col })
            out.push({ k: 'rect', x1: x - p, y1: y + h + e.pad, x2: x + w + p, y2: y + h + p, argb: col })
            out.push({ k: 'rect', x1: x - p, y1: y - e.pad, x2: x - e.pad, y2: y + h + e.pad, argb: col })
            out.push({ k: 'rect', x1: x + w + e.pad, y1: y - e.pad, x2: x + w + p, y2: y + h + e.pad, argb: col })
          }
        }
        if (e.back) fillRects(out, x - e.pad, y - e.pad, w + e.pad * 2, h + e.pad * 2, e.back, opacity, null, null)
        const full = e.dir === 'ltr' || e.dir === 'rtl' ? w : h
        const len = Math.round(full * inp.progress)
        fillRects(out, x, y, w, h, e.fill, opacity, an.color, { dir: e.dir, len })
        break
      }
      case 'ring': {
        const radius = Math.round(e.radius * grow)
        const inner = Math.max(0, radius - e.thickness)
        const ccx = x + radius
        const ccy = y + radius
        const startRad = (e.start * Math.PI) / 180
        const col = rgb(an.color ?? e.fill.color)
        const colA = a255(e.fill.alpha, opacity)
        const backC = e.back ? rgb(e.back.color) : [0, 0, 0]
        const backA = e.back ? a255(e.back.alpha, opacity) : 0
        for (let dy = -radius; dy < radius; dy++) {
          let runStart = -radius
          let runColor = 0
          for (let dx = -radius; dx <= radius; dx++) {
            let c = 0
            if (dx < radius) {
              const pxx = dx + 0.5
              const pyy = dy + 0.5
              const d = Math.sqrt(pxx * pxx + pyy * pyy)
              if (d <= radius && d >= inner) {
                let angle = Math.atan2(pxx, -pyy)
                if (angle < 0) angle += Math.PI * 2
                angle -= startRad
                if (angle < 0) angle += Math.PI * 2
                if (!e.cw) angle = Math.PI * 2 - angle
                c = angle / (Math.PI * 2) <= inp.progress ? argb(col as [number, number, number], colA) : argb(backC as [number, number, number], backA)
              }
            }
            if (c !== runColor || dx === radius) {
              if (runColor >>> 24 !== 0) out.push({ k: 'rect', x1: ccx + runStart, y1: ccy + dy, x2: ccx + dx, y2: ccy + dy + 1, argb: runColor })
              runStart = dx
              runColor = c
            }
          }
        }
        break
      }
      case 'text': {
        const text = tokens(inp.lang === 'th' && e.textTh ? e.textTh : e.text, inp)
        const scale = e.scale * grow
        const align = e.align === 'left' ? 0 : e.align === 'center' ? 1 : 2
        const col = rgb(an.color ?? e.color)
        const al = a255(100, opacity)
        // a text's anchor point is where it starts (top); the bottom anchors lift it by its own height
        const ty = baseY - Math.floor(ay * 8 * scale)
        if (al > 0) out.push({ k: 'text', el: index, text, x: baseX, y: ty, align, argb: argb(col, al), shadow: e.shadow, scale })
        break
      }
      case 'image': {
        const al = a255(100, opacity)
        const tint = e.tint ? rgb(e.tint) : [255, 255, 255]
        if (al > 0 && w > 0 && h > 0 && e.asset)
          out.push({ k: 'image', el: index, asset: e.asset, x, y, w, h, argb: argb(tint as [number, number, number], al) })
        break
      }
    }
  })
  return finish(out)
}

/** Whole pixels, like the game draws: coordinates are rounded half up and empty rectangles dropped. */
function finish(cmds: DrawCmd[]): DrawCmd[] {
  const out: DrawCmd[] = []
  for (const c of cmds) {
    if (c.k === 'rect') {
      const r = { ...c, x1: Math.round(c.x1), y1: Math.round(c.y1), x2: Math.round(c.x2), y2: Math.round(c.y2) }
      if (r.x2 > r.x1 && r.y2 > r.y1) out.push(r)
    } else if (c.k === 'text') out.push({ ...c, x: Math.round(c.x), y: Math.round(c.y) })
    else out.push({ ...c, x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) })
  }
  return out
}
