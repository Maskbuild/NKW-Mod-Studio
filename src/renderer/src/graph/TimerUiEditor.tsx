import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ANCHORS, PLACES, TIMER_PRESETS, TimerDocSchema, docOfNode, resolveLayout, type Anim, type Fill, type TimerDoc, type TimerElement } from '@core/timerUi'
import { L } from '../i18n'
import { assetUrl } from '../api'
import { useStore, type FlowNode } from '../store'

type Lang = 'en' | 'th'
const T = (en: string, th: string, lang: string) => (lang === 'th' ? th : en)

// ───────── preview: the editor's pretend game screen, drawn from the same commands the game draws ─────────

const SW = 427
const SH = 240
const images = new Map<string, HTMLImageElement>()
function image(asset: string): HTMLImageElement {
  let img = images.get(asset)
  if (!img) {
    img = new Image()
    img.src = assetUrl(asset)
    images.set(asset, img)
  }
  return img
}
const cssColor = (argb: number) => `rgba(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255},${(((argb >>> 24) & 255) / 255).toFixed(3)})`

export interface PreviewControls {
  progress: number | 'loop'
  mode: 'harvest' | 'mining'
  lang: Lang
  low: boolean
}

/** The screen with the timer window. `controls.progress = 'loop'` plays the timer again and again. */
export function TimerCanvas({ doc, controls, scale = 2 }: { doc: TimerDoc; controls: PreviewControls; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef({ doc, controls })
  state.current = { doc, controls }
  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    let frame = 0
    const start = performance.now()
    const LOOP = 4000
    const draw = (now: number) => {
      const { doc, controls } = state.current
      const elapsed = now - start
      const cycle = (elapsed % (LOOP + 700)) / LOOP
      const progress = controls.progress === 'loop' ? Math.min(1, cycle) : controls.progress
      const ticksLeft = controls.low ? Math.min(40, (1 - progress) * 80) : (1 - progress) * 80
      const time = (controls.progress === 'loop' ? Math.max(0, elapsed % (LOOP + 700)) : elapsed) / 50
      g.setTransform(scale, 0, 0, scale, 0, 0)
      g.imageSmoothingEnabled = false
      const sky = g.createLinearGradient(0, 0, 0, SH)
      sky.addColorStop(0, '#7fb2ff')
      sky.addColorStop(0.55, '#a9c9ff')
      sky.addColorStop(0.56, '#5d8c3a')
      sky.addColorStop(1, '#3f6526')
      g.fillStyle = sky
      g.fillRect(0, 0, SW, SH)
      const cx = Math.floor(SW / 2)
      const cy = Math.floor(SH / 2)
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.fillRect(cx - 4, cy, 9, 1)
      g.fillRect(cx, cy - 4, 1, 9)
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(cx - 91, SH - 22, 182, 22)
      g.strokeStyle = 'rgba(200,200,200,0.7)'
      for (let i = 0; i < 9; i++) g.strokeRect(cx - 90 + i * 20 + 0.5, SH - 21 + 0.5, 19, 19)
      g.fillStyle = '#e23b3b'
      for (let i = 0; i < 10; i++) g.fillRect(cx - 91 + i * 8, SH - 38, 7, 6)
      g.fillStyle = '#b5713b'
      for (let i = 0; i < 10; i++) g.fillRect(cx + 10 + i * 8, SH - 38, 7, 6)
      g.fillStyle = '#7ad83a'
      g.fillRect(cx - 91, SH - 28, 182, 3)
      g.textBaseline = 'top'
      for (const c of resolveLayout(doc, { screen: { w: SW, h: SH }, mode: controls.mode, progress, ticksLeft, time, lang: controls.lang })) {
        if (c.k === 'rect') {
          g.fillStyle = cssColor(c.argb)
          g.fillRect(c.x1, c.y1, c.x2 - c.x1, c.y2 - c.y1)
        } else if (c.k === 'text') {
          g.font = `${8 * c.scale}px "Segoe UI", sans-serif`
          const w = g.measureText(c.text).width
          const x = c.align === 1 ? c.x - Math.floor(w / 2) : c.align === 2 ? c.x - w : c.x
          if (c.shadow) {
            g.fillStyle = 'rgba(0,0,0,0.55)'
            g.fillText(c.text, x + 1, c.y + 1)
          }
          g.fillStyle = cssColor(c.argb)
          g.fillText(c.text, x, c.y)
        } else {
          const img = image(c.asset)
          g.globalAlpha = ((c.argb >>> 24) & 255) / 255
          if (img.complete && img.naturalWidth) g.drawImage(img, c.x, c.y, c.w, c.h)
          else {
            g.fillStyle = 'rgba(255,0,255,0.35)'
            g.fillRect(c.x, c.y, c.w, c.h)
          }
          g.globalAlpha = 1
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [scale])
  return <canvas ref={ref} width={SW * scale} height={SH * scale} style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 6 }} />
}

/** The preview shown above a Timer window node's settings. */
export function TimerPreview({ data }: { data: Record<string, unknown> }) {
  const { i18n } = useTranslation()
  const { doc } = useMemo(() => docOfNode(data), [data])
  return (
    <div className="harvest-preview">
      <TimerCanvas doc={doc} controls={{ progress: 'loop', mode: 'harvest', lang: i18n.language as Lang, low: false }} />
    </div>
  )
}

// ───────── small inputs ─────────

function Num({
  value,
  onChange,
  min,
  max,
  step = 1,
  width = 64
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  width?: number
}) {
  const [text, setText] = useState<string | null>(null)
  const commit = (s: string) => {
    let v = Number(s)
    if (!Number.isFinite(v)) return setText(null)
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    onChange(v)
    setText(null)
  }
  return (
    <input
      className="input mono"
      style={{ width }}
      inputMode="decimal"
      step={step}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="timer-row">
      <span className="timer-label">{label}</span>
      <div className="timer-ctl">{children}</div>
    </div>
  )
}

function Sel<V extends string>({ value, options, onChange }: { value: V; options: readonly (readonly [V, string])[]; onChange: (v: V) => void }) {
  return (
    <select className="input" value={value} onChange={(e) => onChange(e.target.value as V)}>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

const Color = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <input type="color" className="input" style={{ padding: 2, width: 44, height: 28 }} value={value} onChange={(e) => onChange(e.target.value)} />
)

function FillEditor({ fill, onChange, lang, withGradient = true }: { fill: Fill; onChange: (f: Fill) => void; lang: string; withGradient?: boolean }) {
  const set = (patch: Partial<Fill>) => onChange({ ...fill, ...patch })
  return (
    <>
      {withGradient && (
        <Row label={T('Fill', 'สี', lang)}>
          <Sel
            value={fill.kind}
            options={[
              ['solid', T('One colour', 'สีเดียว', lang)],
              ['linear', T('Gradient', 'ไล่สี', lang)]
            ]}
            onChange={(kind) => set({ kind, to: kind === 'linear' ? (fill.to ?? '#ffffff') : fill.to })}
          />
        </Row>
      )}
      <Row label={T('Colour', 'สี', lang)}>
        <Color value={fill.color} onChange={(color) => set({ color })} />
        {fill.kind === 'linear' && <Color value={fill.to ?? '#ffffff'} onChange={(to) => set({ to })} />}
        {fill.kind === 'linear' && (
          <label className="check">
            <input type="checkbox" checked={!!fill.vertical} onChange={(e) => set({ vertical: e.target.checked })} /> {T('Top to bottom', 'บนลงล่าง', lang)}
          </label>
        )}
      </Row>
      <Row label={T('Opacity %', 'ความทึบ %', lang)}>
        <Num value={fill.alpha} min={0} max={100} onChange={(alpha) => set({ alpha: Math.round(alpha) })} />
        {fill.kind === 'linear' && <Num value={fill.alphaTo ?? fill.alpha} min={0} max={100} onChange={(alphaTo) => set({ alphaTo: Math.round(alphaTo) })} />}
      </Row>
    </>
  )
}

const ANCHOR_LABEL: Record<(typeof ANCHORS)[number], [string, string]> = {
  topLeft: ['Top left', 'ซ้ายบน'],
  top: ['Top', 'บน'],
  topRight: ['Top right', 'ขวาบน'],
  left: ['Left', 'ซ้าย'],
  center: ['Middle', 'กลาง'],
  right: ['Right', 'ขวา'],
  bottomLeft: ['Bottom left', 'ซ้ายล่าง'],
  bottom: ['Bottom', 'ล่าง'],
  bottomRight: ['Bottom right', 'ขวาล่าง']
}
const PLACE_LABEL: Record<(typeof PLACES)[number], [string, string]> = {
  crosshair: ['Under the crosshair', 'ใต้เครื่องหมายเล็ง'],
  hotbar: ['Above the hotbar', 'เหนือแถบไอเทม'],
  top: ['Top of the screen', 'บนสุดของจอ'],
  center: ['Centre of the screen', 'กลางจอ'],
  topLeft: ['Top left corner', 'มุมซ้ายบน'],
  topRight: ['Top right corner', 'มุมขวาบน'],
  bottomLeft: ['Bottom left corner', 'มุมซ้ายล่าง'],
  bottomRight: ['Bottom right corner', 'มุมขวาล่าง']
}
const TYPE_LABEL: Record<TimerElement['type'], [string, string]> = {
  rect: ['Rectangle', 'สี่เหลี่ยม'],
  bar: ['Bar', 'หลอด'],
  ring: ['Circle', 'วงกลม'],
  text: ['Text', 'ข้อความ'],
  image: ['Image', 'รูปภาพ']
}

function AnimEditor({ anim, onChange, onRemove, lang }: { anim: Anim; onChange: (a: Anim) => void; onRemove: () => void; lang: string }) {
  const isColor = anim.prop === 'color'
  const set = (patch: Partial<Anim>) => onChange({ ...anim, ...patch } as Anim)
  return (
    <div className="timer-anim">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Sel
          value={anim.prop}
          options={[
            ['opacity', T('Opacity', 'ความทึบ', lang)],
            ['x', T('Move across', 'เลื่อนซ้าย-ขวา', lang)],
            ['y', T('Move down', 'เลื่อนขึ้น-ลง', lang)],
            ['scale', T('Size', 'ขนาด', lang)],
            ['color', T('Colour', 'สี', lang)]
          ]}
          onChange={(prop) =>
            set(
              prop === 'color'
                ? { prop, from: '#ffffff', to: '#ff0000' }
                : prop === 'opacity'
                  ? { prop, from: 100, to: 40 }
                  : prop === 'scale'
                    ? { prop, from: 1, to: 1.2 }
                    : { prop, from: 0, to: 4 }
            )
          }
        />
        <Sel
          value={anim.trigger}
          options={[
            ['time', T('Over time', 'ตามเวลา', lang)],
            ['progress', T('With progress', 'ตามความคืบหน้า', lang)],
            ['low', T('Last 3 seconds', '3 วินาทีสุดท้าย', lang)]
          ]}
          onChange={(trigger) => set({ trigger })}
        />
        <button className="btn small danger" onClick={onRemove}>
          ✕
        </button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        {isColor ? (
          <>
            <Color value={String(anim.from)} onChange={(from) => set({ from })} />
            <span>→</span>
            <Color value={String(anim.to)} onChange={(to) => set({ to })} />
          </>
        ) : (
          <>
            <Num value={Number(anim.from)} step={anim.prop === 'scale' ? 0.1 : 1} onChange={(from) => set({ from })} />
            <span>→</span>
            <Num value={Number(anim.to)} step={anim.prop === 'scale' ? 0.1 : 1} onChange={(to) => set({ to })} />
          </>
        )}
        {anim.trigger !== 'progress' && (
          <>
            <Num value={anim.ticks} min={1} max={2400} width={56} onChange={(ticks) => set({ ticks: Math.round(ticks) })} />
            <span className="faint">{T('ticks', 'tick', lang)}</span>
            <Sel
              value={anim.loop}
              options={[
                ['once', T('Once', 'ครั้งเดียว', lang)],
                ['repeat', T('Repeat', 'วนซ้ำ', lang)],
                ['pingpong', T('Back and forth', 'ไป-กลับ', lang)]
              ]}
              onChange={(loop) => set({ loop })}
            />
          </>
        )}
        <Sel
          value={anim.ease}
          options={[
            ['linear', T('Even', 'สม่ำเสมอ', lang)],
            ['in', T('Slow start', 'ช้าก่อน', lang)],
            ['out', T('Slow end', 'ช้าตอนท้าย', lang)],
            ['inOut', T('Smooth', 'นุ่มนวล', lang)]
          ]}
          onChange={(ease) => set({ ease })}
        />
      </div>
    </div>
  )
}

function newElement(type: TimerElement['type'], n: number): TimerElement {
  const base = { id: `${type}${n}`, anchor: 'topLeft' as const, x: 0, y: 0, w: 40, h: 6, opacity: 100, show: 'always' as const, anims: [] as Anim[] }
  const solid = (color: string, alpha = 100): Fill => ({ kind: 'solid', color, alpha })
  switch (type) {
    case 'rect':
      return { ...base, type, fill: solid('#1e293b', 80) }
    case 'bar':
      return { ...base, type, fill: solid('#4ade80'), back: solid('#000000', 50), pad: 1, dir: 'ltr' }
    case 'ring':
      return { ...base, type, w: 0, h: 0, fill: solid('#4ade80'), back: solid('#000000', 50), radius: 10, thickness: 4, start: 0, cw: true }
    case 'text':
      return { ...base, type, w: 0, h: 0, text: '{seconds} s', textTh: '{seconds} วิ', color: '#ffffff', shadow: true, scale: 1, align: 'left' }
    default:
      return { ...base, type: 'image', w: 16, h: 16, asset: '', texW: 16, texH: 16, tint: null }
  }
}

function ElementForm({ el, onChange, lang }: { el: TimerElement; onChange: (e: TimerElement) => void; lang: string }) {
  const textures = useStore((s) => s.assets).filter((a) => a.kind === 'texture')
  const set = (patch: Record<string, unknown>) => onChange({ ...el, ...patch } as TimerElement)
  const setAnim = (i: number, a: Anim) => set({ anims: el.anims.map((x, j) => (j === i ? a : x)) })
  return (
    <div className="timer-form">
      <Row label={T('Name', 'ชื่อ', lang)}>
        <input
          className="input mono"
          style={{ width: 120 }}
          value={el.id}
          maxLength={24}
          onChange={(e) => set({ id: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') || 'el' })}
        />
      </Row>
      <Row label={T('Anchor', 'จุดยึด', lang)}>
        <Sel
          value={el.anchor}
          options={ANCHORS.map((a) => [a, T(ANCHOR_LABEL[a][0], ANCHOR_LABEL[a][1], lang)] as const)}
          onChange={(anchor) => set({ anchor })}
        />
      </Row>
      <Row label={T('Position', 'ตำแหน่ง', lang)}>
        <Num value={el.x} min={-1000} max={1000} onChange={(x) => set({ x })} />
        <Num value={el.y} min={-1000} max={1000} onChange={(y) => set({ y })} />
      </Row>
      {el.type !== 'ring' && el.type !== 'text' && (
        <Row label={T('Size', 'ขนาด', lang)}>
          <Num value={el.w} min={0} max={1000} onChange={(w) => set({ w })} />
          <Num value={el.h} min={0} max={1000} onChange={(h) => set({ h })} />
        </Row>
      )}
      <Row label={T('Opacity %', 'ความทึบ %', lang)}>
        <Num value={el.opacity} min={0} max={100} onChange={(opacity) => set({ opacity: Math.round(opacity) })} />
      </Row>
      <Row label={T('Shown', 'แสดงเมื่อ', lang)}>
        <Sel
          value={el.show}
          options={[
            ['always', T('Always', 'เสมอ', lang)],
            ['harvest', T('Picking a crop', 'เก็บพืช', lang)],
            ['mining', T('Breaking a block', 'ทุบบล็อก', lang)],
            ['low', T('Last 3 seconds', '3 วินาทีสุดท้าย', lang)]
          ]}
          onChange={(show) => set({ show })}
        />
      </Row>

      {(el.type === 'rect' || el.type === 'bar' || el.type === 'ring') && (
        <>
          <div className="timer-sub">{el.type === 'bar' ? T('Bar colour', 'สีหลอด', lang) : T('Colour', 'สี', lang)}</div>
          <FillEditor fill={el.fill} lang={lang} withGradient={el.type !== 'ring'} onChange={(fill) => set({ fill })} />
        </>
      )}
      {(el.type === 'bar' || el.type === 'ring') && (
        <>
          <div className="timer-sub">{T('Background', 'พื้นหลัง', lang)}</div>
          <Row label={T('Has background', 'มีพื้นหลัง', lang)}>
            <input
              type="checkbox"
              checked={!!el.back}
              onChange={(e) => set({ back: e.target.checked ? { kind: 'solid', color: '#000000', alpha: 50 } : null })}
            />
          </Row>
          {el.back && <FillEditor fill={el.back} lang={lang} withGradient={el.type !== 'ring'} onChange={(back) => set({ back })} />}
        </>
      )}
      {el.type === 'bar' && (
        <>
          <Row label={T('Fills', 'เติมจาก', lang)}>
            <Sel
              value={el.dir}
              options={[
                ['ltr', T('Left to right', 'ซ้ายไปขวา', lang)],
                ['rtl', T('Right to left', 'ขวาไปซ้าย', lang)],
                ['ttb', T('Top to bottom', 'บนลงล่าง', lang)],
                ['btt', T('Bottom to top', 'ล่างขึ้นบน', lang)]
              ]}
              onChange={(dir) => set({ dir })}
            />
          </Row>
          <Row label={T('Background margin', 'ขอบพื้นหลัง', lang)}>
            <Num value={el.pad} min={0} max={8} onChange={(pad) => set({ pad: Math.round(pad) })} />
          </Row>
        </>
      )}
      {(el.type === 'rect' || el.type === 'bar') && (
        <>
          <Row label={T('Outline', 'ขอบเส้น', lang)}>
            <input
              type="checkbox"
              checked={!!el.border}
              onChange={(e) => set({ border: e.target.checked ? { width: 1, color: '#ffffff', alpha: 100 } : undefined })}
            />
            {el.border && (
              <>
                <Num value={el.border.width} min={1} max={8} onChange={(width) => set({ border: { ...el.border!, width: Math.round(width) } })} />
                <Color value={el.border.color} onChange={(color) => set({ border: { ...el.border!, color } })} />
                <Num value={el.border.alpha} min={0} max={100} onChange={(alpha) => set({ border: { ...el.border!, alpha: Math.round(alpha) } })} />
              </>
            )}
          </Row>
        </>
      )}
      {el.type === 'ring' && (
        <>
          <Row label={T('Radius / thickness', 'รัศมี / ความหนา', lang)}>
            <Num value={el.radius} min={3} max={60} onChange={(radius) => set({ radius: Math.round(radius) })} />
            <Num value={el.thickness} min={1} max={60} onChange={(thickness) => set({ thickness: Math.round(thickness) })} />
          </Row>
          <Row label={T('Starts at (degrees)', 'เริ่มที่ (องศา)', lang)}>
            <Num value={el.start} min={0} max={360} onChange={(start) => set({ start })} />
            <label className="check">
              <input type="checkbox" checked={el.cw} onChange={(e) => set({ cw: e.target.checked })} /> {T('Clockwise', 'ตามเข็ม', lang)}
            </label>
          </Row>
        </>
      )}
      {el.type === 'text' && (
        <>
          <Row label="English">
            <input className="input grow" value={el.text} maxLength={120} onChange={(e) => set({ text: e.target.value })} />
          </Row>
          <Row label="ไทย">
            <input className="input grow" value={el.textTh ?? ''} maxLength={120} onChange={(e) => set({ textTh: e.target.value || undefined })} />
          </Row>
          <div className="faint" style={{ marginBottom: 6 }}>
            {'{seconds}'} · {'{percent}'} · {'{bar}'}
          </div>
          <Row label={T('Colour', 'สี', lang)}>
            <Color value={el.color} onChange={(color) => set({ color })} />
            <label className="check">
              <input type="checkbox" checked={el.shadow} onChange={(e) => set({ shadow: e.target.checked })} /> {T('Shadow', 'เงา', lang)}
            </label>
          </Row>
          <Row label={T('Size / align', 'ขนาด / การจัด', lang)}>
            <Num value={el.scale} min={0.5} max={4} step={0.5} onChange={(scale) => set({ scale })} />
            <Sel
              value={el.align}
              options={[
                ['left', T('Left', 'ซ้าย', lang)],
                ['center', T('Centre', 'กลาง', lang)],
                ['right', T('Right', 'ขวา', lang)]
              ]}
              onChange={(align) => set({ align })}
            />
          </Row>
        </>
      )}
      {el.type === 'image' && (
        <>
          <Row label={T('Picture', 'รูป', lang)}>
            <select
              className="input"
              value={el.asset}
              onChange={(e) => {
                const asset = e.target.value
                const img = new Image()
                img.onload = () =>
                  set({
                    asset,
                    texW: Math.min(4096, img.naturalWidth),
                    texH: Math.min(4096, img.naturalHeight),
                    w: el.w || img.naturalWidth,
                    h: el.h || img.naturalHeight
                  })
                img.onerror = () => set({ asset })
                img.src = assetUrl(asset)
                set({ asset })
              }}
            >
              <option value="">{T('— choose a texture —', '— เลือกเท็กซ์เจอร์ —', lang)}</option>
              {textures.map((a) => (
                <option key={a.asset} value={a.asset}>
                  {a.asset}
                </option>
              ))}
            </select>
          </Row>
          <div className="faint">{T('Pictures show in Minecraft 1.20.1 – 1.21.1.', 'รูปแสดงใน Minecraft 1.20.1 – 1.21.1', lang)}</div>
          <Row label={T('Tint', 'ย้อมสี', lang)}>
            <input type="checkbox" checked={!!el.tint} onChange={(e) => set({ tint: e.target.checked ? '#ffffff' : null })} />
            {el.tint && <Color value={el.tint} onChange={(tint) => set({ tint })} />}
          </Row>
        </>
      )}

      <div className="timer-sub">{T('Animations', 'แอนิเมชัน', lang)}</div>
      {el.anims.map((a, i) => (
        <AnimEditor key={i} anim={a} lang={lang} onChange={(n) => setAnim(i, n)} onRemove={() => set({ anims: el.anims.filter((_, j) => j !== i) })} />
      ))}
      {el.anims.length < 8 && (
        <button
          className="btn small"
          onClick={() =>
            set({ anims: [...el.anims, { prop: 'opacity', trigger: 'time', from: 100, to: 40, ticks: 20, delay: 0, ease: 'inOut', loop: 'pingpong' }] })
          }
        >
          + {T('Add animation', 'เพิ่มแอนิเมชัน', lang)}
        </button>
      )}
    </div>
  )
}

/** The Timer window editor: presets, the window's place, its elements and animations, and a live preview. */
export function TimerUiEditor({ node }: { node: FlowNode }) {
  const { i18n } = useTranslation()
  const lang = i18n.language as Lang
  const { doc, problems } = useMemo(() => docOfNode(node.data), [node.data])
  const [selected, setSelected] = useState(0)
  const [progress, setProgress] = useState<number | 'loop'>('loop')
  const [mode, setMode] = useState<'harvest' | 'mining'>('harvest')
  const [low, setLow] = useState(false)
  const [error, setError] = useState('')
  const sel = Math.min(selected, doc.elements.length - 1)

  const save = (next: TimerDoc) => {
    const r = TimerDocSchema.safeParse(next)
    if (!r.success) {
      setError(r.error.issues[0].message)
      return
    }
    setError('')
    useStore.getState().updateData(node.id, { doc: r.data })
  }
  const setEl = (i: number, el: TimerElement) => save({ ...doc, elements: doc.elements.map((x, j) => (j === i ? el : x)) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= doc.elements.length) return
    const els = [...doc.elements]
    ;[els[i], els[j]] = [els[j], els[i]]
    save({ ...doc, elements: els })
    setSelected(j)
  }

  return (
    <div className="timer-editor">
      <div className="harvest-preview">
        <TimerCanvas doc={doc} controls={{ progress, mode, lang, low }} />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          <input
            type="range"
            min={0}
            max={100}
            value={progress === 'loop' ? 0 : Math.round(progress * 100)}
            onChange={(e) => setProgress(Number(e.target.value) / 100)}
            style={{ flex: 1 }}
            aria-label={T('Progress', 'ความคืบหน้า', lang)}
          />
          <button className={`btn small${progress === 'loop' ? ' primary' : ''}`} onClick={() => setProgress(progress === 'loop' ? 0.5 : 'loop')}>
            ▶ {T('Play', 'เล่น', lang)}
          </button>
          <Sel
            value={mode}
            options={[
              ['harvest', T('Picking a crop', 'เก็บพืช', lang)],
              ['mining', T('Breaking a block', 'ทุบบล็อก', lang)]
            ]}
            onChange={setMode}
          />
          <label className="check">
            <input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> {T('Last seconds', 'วินาทีสุดท้าย', lang)}
          </label>
        </div>
      </div>
      {problems.map((p) => (
        <div key={p} className="err-text">
          {p}
        </div>
      ))}
      {error && <div className="err-text">{error}</div>}

      <div className="timer-sub">{T('Ready-made looks', 'แบบสำเร็จรูป', lang)}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {TIMER_PRESETS.map((p) => (
          <button
            key={p.id}
            className="btn small"
            onClick={() => {
              save(p.doc())
              setSelected(0)
            }}
          >
            {L(p.name)}
          </button>
        ))}
      </div>

      <div className="timer-sub">{T('Window', 'หน้าต่าง', lang)}</div>
      <Row label={T('Place', 'ตำแหน่งบนจอ', lang)}>
        <Sel
          value={doc.place.at}
          options={PLACES.map((p) => [p, T(PLACE_LABEL[p][0], PLACE_LABEL[p][1], lang)] as const)}
          onChange={(at) => save({ ...doc, place: { ...doc.place, at } })}
        />
      </Row>
      <Row label={T('Move', 'เลื่อน', lang)}>
        <Num value={doc.place.x} min={-2000} max={2000} onChange={(x) => save({ ...doc, place: { ...doc.place, x } })} />
        <Num value={doc.place.y} min={-2000} max={2000} onChange={(y) => save({ ...doc, place: { ...doc.place, y } })} />
      </Row>
      <Row label={T('Box size', 'ขนาดกรอบ', lang)}>
        <Num value={doc.size.w} min={1} max={1000} onChange={(w) => save({ ...doc, size: { ...doc.size, w: Math.round(w) } })} />
        <Num value={doc.size.h} min={1} max={1000} onChange={(h) => save({ ...doc, size: { ...doc.size, h: Math.round(h) } })} />
      </Row>

      <div className="timer-sub">{T('Elements (bottom first)', 'ชิ้นส่วน (ล่างสุดก่อน)', lang)}</div>
      <div className="timer-list">
        {doc.elements.map((e, i) => (
          <div
            key={i}
            className={`timer-item${i === sel ? ' on' : ''}`}
            onClick={() => setSelected(i)}
            role="button"
            tabIndex={0}
            onKeyDown={(k) => k.key === 'Enter' && setSelected(i)}
          >
            <span className="grow ellipsis">
              {T(TYPE_LABEL[e.type][0], TYPE_LABEL[e.type][1], lang)} · <span className="mono">{e.id}</span>
            </span>
            <button className="btn small ghost" title="↑" onClick={(ev) => (ev.stopPropagation(), move(i, -1))}>
              ↑
            </button>
            <button className="btn small ghost" title="↓" onClick={(ev) => (ev.stopPropagation(), move(i, 1))}>
              ↓
            </button>
            <button
              className="btn small ghost"
              title={T('Duplicate', 'ทำซ้ำ', lang)}
              onClick={(ev) => {
                ev.stopPropagation()
                if (doc.elements.length < 48)
                  save({
                    ...doc,
                    elements: [...doc.elements.slice(0, i + 1), { ...e, id: `${e.id.slice(0, 20)}_${doc.elements.length}` }, ...doc.elements.slice(i + 1)]
                  })
              }}
            >
              ⧉
            </button>
            <button
              className="btn small ghost danger"
              title={T('Delete', 'ลบ', lang)}
              disabled={doc.elements.length <= 1}
              onClick={(ev) => {
                ev.stopPropagation()
                save({ ...doc, elements: doc.elements.filter((_, j) => j !== i) })
                setSelected(0)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
        {(['rect', 'bar', 'ring', 'text', 'image'] as const).map((t) => (
          <button
            key={t}
            className="btn small"
            disabled={doc.elements.length >= 48}
            onClick={() => {
              save({ ...doc, elements: [...doc.elements, newElement(t, doc.elements.length + 1)] })
              setSelected(doc.elements.length)
            }}
          >
            + {T(TYPE_LABEL[t][0], TYPE_LABEL[t][1], lang)}
          </button>
        ))}
      </div>

      <ElementForm key={sel} el={doc.elements[sel]} lang={lang} onChange={(e) => setEl(sel, e)} />
    </div>
  )
}
