import { describe, expect, it } from 'vitest'
import {
  TIMER_PRESETS,
  TimerDocSchema,
  docAssets,
  docOfNode,
  fmtSeconds,
  legacyToDoc,
  normalizeDoc,
  resolveLayout,
  type DrawCmd,
  type LayoutInput
} from '../src/core/timerUi'

const input = (p: Partial<LayoutInput> = {}): LayoutInput => ({
  screen: { w: 427, h: 240 },
  mode: 'harvest',
  progress: 0.5,
  ticksLeft: 20,
  time: 0,
  lang: 'en',
  ...p
})

/** The fixed look the game drew before documents: a port of the old Java drawing (bar, text, ring). */
function oldLook(d: Record<string, unknown>, inp: LayoutInput): DrawCmd[] {
  const out: DrawCmd[] = []
  const hex = (v: unknown, def: string) => parseInt((typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def).slice(1), 16)
  const color = hex(d.color, '#4ade80')
  const back = hex(d.back, '#000000')
  const backAlpha = Math.round(((d.backOpacity === undefined ? 50 : (d.backOpacity as number)) * 255) / 100)
  const argb = (rgb: number, a = 255) => ((a << 24) | rgb) >>> 0
  const style = d.style === 'text' || d.style === 'ring' ? d.style : 'bar'
  const place = d.place === 'hotbar' || d.place === 'top' ? d.place : 'crosshair'
  const offset = (d.offset as number) ?? 0
  const time = d.time !== false
  const w = inp.screen.w
  const h = inp.screen.h
  const cx = Math.floor(w / 2)
  const cy = Math.floor(h / 2)
  const left = ((inp.ticksLeft / 2 + 0.5) | 0) / 10
  const secs = left.toFixed(1)
  const progress = inp.progress
  if (style === 'ring') {
    const radius = (d.radius as number) ?? 9
    const thickness = (d.thickness as number) ?? 3
    const inner = Math.max(0, radius - thickness)
    for (let dy = -radius; dy < radius; dy++) {
      let runStart = -radius
      let runColor = 0
      for (let dx = -radius; dx <= radius; dx++) {
        let c = 0
        if (dx < radius) {
          const px = dx + 0.5
          const py = dy + 0.5
          const dist = Math.sqrt(px * px + py * py)
          if (dist <= radius && dist >= inner) {
            let angle = Math.atan2(px, -py)
            if (angle < 0) angle += Math.PI * 2
            c = angle / (Math.PI * 2) <= progress ? argb(color) : argb(back, backAlpha)
          }
        }
        if (c !== runColor || dx === radius) {
          if (runColor >>> 24 !== 0) out.push({ k: 'rect', x1: cx + runStart, y1: cy + dy, x2: cx + dx, y2: cy + dy + 1, argb: runColor })
          runStart = dx
          runColor = c
        }
      }
    }
    if (time) out.push({ k: 'text', el: 1, text: `${secs} s`, x: cx, y: cy + radius + 3, align: 1, argb: 0xffffffff, shadow: true, scale: 1 })
    return out
  }
  const barH = (d.height as number) ?? 4
  const height = style === 'bar' ? barH + 2 : 9
  let y = place === 'crosshair' ? cy + 10 : place === 'hotbar' ? h - 50 - height : 10
  y += offset
  if (style === 'text') {
    const filled = Math.floor(10 * progress)
    const bar = '■'.repeat(filled) + '□'.repeat(10 - filled)
    const word = inp.mode === 'harvest' ? 'Harvesting' : 'Breaking'
    out.push({
      k: 'text',
      el: inp.mode === 'harvest' ? 0 : 1,
      text: `${word} ${bar}${time ? ` ${secs} s` : ''}`,
      x: cx,
      y,
      align: 1,
      argb: argb(color),
      shadow: true,
      scale: 1
    })
    return out
  }
  const width = (d.width as number) ?? 60
  const x = cx - Math.floor(width / 2)
  if (backAlpha !== 0) out.push({ k: 'rect', x1: x - 1, y1: y, x2: x + width + 1, y2: y + barH + 2, argb: argb(back, backAlpha) })
  const fx = x + Math.round(width * progress)
  if (fx > x) out.push({ k: 'rect', x1: x, y1: y + 1, x2: fx, y2: y + 1 + barH, argb: argb(color) })
  if (time)
    out.push({ k: 'text', el: 1, text: `${secs} s`, x: x + width + 4, y: y + Math.floor(barH / 2) - 3, align: 0, argb: 0xffffffff, shadow: true, scale: 1 })
  return out
}

const strip = (cmds: DrawCmd[]) => cmds.map((c) => (c.k === 'text' ? { ...c, el: 0 } : c))

describe('legacy timer settings become a document that draws the same pixels', () => {
  const cases: Record<string, unknown>[] = [
    {},
    { style: 'bar', place: 'hotbar', offset: -12, width: 80, height: 6, color: '#ff8800', back: '#112233', backOpacity: 30 },
    { style: 'bar', place: 'top', width: 33, height: 3, time: false },
    { style: 'bar', backOpacity: 0 },
    { style: 'ring', radius: 12, thickness: 4 },
    { style: 'ring', radius: 7, thickness: 7, color: '#00ffaa', backOpacity: 80, time: false },
    { style: 'text', place: 'crosshair', offset: 5 },
    { style: 'text', place: 'hotbar', time: false, color: '#fefefe' }
  ]
  for (const [i, d] of cases.entries())
    for (const p of [0, 0.37, 0.5, 1])
      for (const screen of [
        { w: 427, h: 240 },
        { w: 640, h: 361 }
      ])
        it(`case ${i} at ${p * 100}% on ${screen.w}x${screen.h}`, () => {
          const inp = input({ progress: p, ticksLeft: Math.round(100 * (1 - p)), screen })
          expect(strip(resolveLayout(legacyToDoc(d), inp))).toEqual(strip(oldLook(d, inp)))
        })

  it('text style switches wording between harvesting and breaking', () => {
    const doc = legacyToDoc({ style: 'text' })
    const t = (mode: 'harvest' | 'mining') => (resolveLayout(doc, input({ mode })).find((c) => c.k === 'text') as { text: string }).text
    expect(t('harvest')).toContain('Harvesting')
    expect(t('mining')).toContain('Breaking')
  })
})

describe('documents', () => {
  it('every preset is a valid document with a sensible drawing', () => {
    for (const pr of TIMER_PRESETS) {
      const doc = pr.doc()
      expect(TimerDocSchema.safeParse(doc).success, pr.id).toBe(true)
      expect(resolveLayout(doc, input()).length, pr.id).toBeGreaterThan(0)
    }
  })

  it('rejects broken documents and falls back to the default look', () => {
    expect(normalizeDoc({ v: 2 }).problems.length).toBeGreaterThan(0)
    expect(normalizeDoc({ ...legacyToDoc({}), elements: [] }).problems.length).toBeGreaterThan(0)
    const { doc } = normalizeDoc('nope')
    expect(doc.elements.length).toBeGreaterThan(0)
    expect(TimerDocSchema.safeParse({ ...legacyToDoc({}), extra: 1 }).success).toBe(false)
  })

  it('a node uses its own document, or the old settings when it has none', () => {
    expect(docOfNode({ style: 'ring' }).doc.elements[0].type).toBe('ring')
    const own = TIMER_PRESETS[3].doc()
    expect(docOfNode({ style: 'ring', doc: own }).doc).toEqual(own)
    expect(docOfNode({ doc: { v: 1 } }).problems.length).toBeGreaterThan(0)
  })

  it('lists the images a document uses', () => {
    const doc = legacyToDoc({})
    doc.elements.push({
      type: 'image',
      id: 'i',
      anchor: 'topLeft',
      x: 0,
      y: 0,
      w: 8,
      h: 8,
      opacity: 100,
      show: 'always',
      anims: [],
      asset: 'textures/icon.png',
      tint: null
    })
    expect(docAssets(doc)).toEqual(['textures/icon.png'])
  })
})

describe('layout features', () => {
  const doc = (elements: unknown[], place: unknown = { at: 'center', x: 0, y: 0 }, size: unknown = { w: 100, h: 20 }) =>
    TimerDocSchema.parse({ v: 2, place, size, elements })
  const bar = { type: 'bar', id: 'b', w: 100, h: 10, fill: { kind: 'solid', color: '#ff0000', alpha: 100 } }
  const rects = (cmds: DrawCmd[]) => cmds.filter((c): c is Extract<DrawCmd, { k: 'rect' }> => c.k === 'rect')

  it('fills a bar in every direction', () => {
    const w = (dir: string) => rects(resolveLayout(doc([{ ...bar, dir }]), input({ progress: 0.25 })))[0]
    expect(w('ltr')).toMatchObject({ x1: 163, x2: 188 })
    expect(w('rtl')).toMatchObject({ x1: 238, x2: 263 })
    const v = rects(resolveLayout(doc([{ ...bar, w: 10, h: 100, dir: 'btt' }], { at: 'center', x: 0, y: 0 }, { w: 100, h: 100 }), input({ progress: 0.5 })))[0]
    expect(v.y2 - v.y1).toBe(50)
    expect(v.y2).toBe(170)
  })

  it('draws a gradient as stripes of mixing colours', () => {
    const cmds = rects(resolveLayout(doc([{ ...bar, w: 8, fill: { kind: 'linear', color: '#000000', to: '#ffffff', alpha: 100 } }]), input({ progress: 1 })))
    expect(cmds.length).toBe(8)
    expect(cmds[0].argb).toBeLessThan(cmds[7].argb)
    expect(cmds.map((c) => c.x2 - c.x1)).toEqual(Array(8).fill(1))
  })

  it('anchors elements to the corners and middle of the box', () => {
    const e = (anchor: string) => ({ type: 'rect', id: 'r', anchor, w: 10, h: 10, fill: { kind: 'solid', color: '#ffffff', alpha: 100 } })
    const at = (anchor: string) => rects(resolveLayout(doc([e(anchor)], { at: 'topLeft', x: 0, y: 0 }), input()))[0]
    expect(at('topLeft')).toMatchObject({ x1: 6, y1: 6 })
    expect(at('bottomRight')).toMatchObject({ x2: 106, y2: 26 })
    expect(at('center')).toMatchObject({ x1: 6 + 45, y1: 6 + 5 })
  })

  it('animates: opacity over time, a looping pulse, progress-driven colour, low-time only', () => {
    const rect = (anims: unknown[]) => ({ type: 'rect', id: 'r', w: 10, h: 10, fill: { kind: 'solid', color: '#ff0000', alpha: 100 }, anims })
    const alpha = (e: unknown, inp: Partial<LayoutInput>) => (rects(resolveLayout(doc([e]), input(inp)))[0]?.argb ?? 0) >>> 24
    const fade = rect([{ prop: 'opacity', trigger: 'time', from: 0, to: 100, ticks: 10 }])
    expect(alpha(fade, { time: 5 })).toBe(Math.round(255 * 0.5))
    expect(alpha(fade, { time: 50 })).toBe(255)
    expect(rects(resolveLayout(doc([fade]), input({ time: 0 }))).length).toBe(0)
    const pulse = rect([{ prop: 'opacity', trigger: 'time', from: 100, to: 0, ticks: 10, loop: 'pingpong' }])
    expect(alpha(pulse, { time: 5 })).toBe(Math.round(255 * 0.5))
    expect(alpha(pulse, { time: 10 })).toBe(0)
    expect(alpha(pulse, { time: 15 })).toBe(Math.round(255 * 0.5))
    const color = rect([{ prop: 'color', trigger: 'progress', from: '#ff0000', to: '#0000ff', ticks: 1 }])
    expect((rects(resolveLayout(doc([color]), input({ progress: 1 })))[0].argb & 0xffffff) >>> 0).toBe(0x0000ff)
    const low = rect([{ prop: 'x', trigger: 'low', from: 0, to: 20, ticks: 60 }])
    const x1 = (inp: Partial<LayoutInput>) => rects(resolveLayout(doc([low]), input(inp)))[0].x1
    expect(x1({ ticksLeft: 200 })).toBe(x1({ ticksLeft: 60 }))
    expect(x1({ ticksLeft: 0 }) - x1({ ticksLeft: 60 })).toBe(20)
  })

  it('scales an element around its middle', () => {
    const e = {
      type: 'rect',
      id: 'r',
      w: 10,
      h: 10,
      fill: { kind: 'solid', color: '#ffffff', alpha: 100 },
      anims: [{ prop: 'scale', trigger: 'progress', from: 1, to: 2, ticks: 1 }]
    }
    const r = rects(resolveLayout(doc([e]), input({ progress: 1 })))[0]
    expect([r.x2 - r.x1, r.y2 - r.y1]).toEqual([20, 20])
    const plain = rects(resolveLayout(doc([{ ...e, anims: [] }]), input()))[0]
    expect(r.x1).toBe(plain.x1 - 5)
  })

  it('shows elements only in their mode', () => {
    const e = (show: string) => ({ type: 'rect', id: show, w: 4, h: 4, show, fill: { kind: 'solid', color: '#ffffff', alpha: 100 } })
    const n = (mode: 'harvest' | 'mining', ticksLeft: number) =>
      rects(resolveLayout(doc([e('harvest'), e('mining'), e('low'), e('always')]), input({ mode, ticksLeft }))).length
    expect(n('harvest', 100)).toBe(2)
    expect(n('mining', 100)).toBe(2)
    expect(n('mining', 30)).toBe(3)
  })

  it('writes text with the time, percent and bar, in the chosen language', () => {
    const t = { type: 'text', id: 't', text: 'Left {seconds} s, {percent}% {bar}', textTh: 'เหลือ {seconds} วิ', color: '#ffffff' }
    const get = (lang: 'en' | 'th') =>
      (resolveLayout(doc([t]), input({ lang, progress: 0.34, ticksLeft: 7 })).find((c) => c.k === 'text') as { text: string }).text
    expect(get('en')).toBe('Left 0.4 s, 34% ■■■□□□□□□□')
    expect(get('th')).toBe('เหลือ 0.4 วิ')
  })

  it('rounds the seconds half up like the game does', () => {
    expect([0, 1, 7, 20, 25, 99].map(fmtSeconds)).toEqual(['0.0', '0.1', '0.4', '1.0', '1.3', '5.0'])
  })
})
