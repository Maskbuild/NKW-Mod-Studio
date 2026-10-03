import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

/** Size of the pretend game screen, in GUI pixels (like 854×480 at GUI scale 2). */
const W = 427
const H = 240
/** Seconds one pretend harvest takes. */
const LOOP = 2

const num = (d: Record<string, unknown>, k: string, def: number) => (typeof d[k] === 'number' ? (d[k] as number) : def)
const str = (d: Record<string, unknown>, k: string, def: string) => (typeof d[k] === 'string' ? (d[k] as string) : def)
const rgba = (hex: string, alpha: number) => {
  const v = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0
  return `rgba(${v >> 16}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`
}

/**
 * The harvest timer as it looks in game (Harvest UI node), drawn on a pretend screen with the same
 * positions and sizes as NkwHarvestHud; the timer runs in a loop.
 */
export function HarvestUiPreview({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLCanvasElement>(null)
  const dataRef = useRef(data)
  dataRef.current = data

  useEffect(() => {
    const canvas = ref.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g) return
    let frame = 0
    const start = performance.now()
    const draw = (now: number) => {
      const d = dataRef.current
      const progress = (((now - start) / 1000) % (LOOP + 0.6)) / LOOP
      const p = Math.min(1, progress)
      const left = Math.max(0, LOOP * (1 - p)).toFixed(1)
      const style = str(d, 'style', 'bar')
      const color = rgba(str(d, 'color', '#4ade80'), 1)
      const back = rgba(str(d, 'back', '#000000'), num(d, 'backOpacity', 50) / 100)
      const time = d.time !== false
      g.setTransform(2, 0, 0, 2, 0, 0)
      // the pretend game: sky, ground, crosshair, hotbar
      const sky = g.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#7fb2ff')
      sky.addColorStop(0.55, '#a9c9ff')
      sky.addColorStop(0.56, '#5d8c3a')
      sky.addColorStop(1, '#3f6526')
      g.fillStyle = sky
      g.fillRect(0, 0, W, H)
      const cx = Math.floor(W / 2)
      const cy = Math.floor(H / 2)
      g.fillStyle = 'rgba(255,255,255,0.9)'
      g.fillRect(cx - 4, cy, 9, 1)
      g.fillRect(cx, cy - 4, 1, 9)
      g.fillStyle = 'rgba(0,0,0,0.45)'
      g.fillRect(cx - 91, H - 22, 182, 22)
      g.strokeStyle = 'rgba(200,200,200,0.7)'
      for (let i = 0; i < 9; i++) g.strokeRect(cx - 90 + i * 20 + 0.5, H - 21 + 0.5, 19, 19)
      g.fillStyle = '#e23b3b'
      for (let i = 0; i < 10; i++) g.fillRect(cx - 91 + i * 8, H - 38, 7, 6)
      g.fillStyle = '#b5713b'
      for (let i = 0; i < 10; i++) g.fillRect(cx + 10 + i * 8, H - 38, 7, 6)
      g.fillStyle = '#7ad83a'
      g.fillRect(cx - 91, H - 28, 182, 3)

      g.font = '8px "Segoe UI", sans-serif'
      g.textBaseline = 'top'
      const text = (s: string, x: number, y: number, c: string, center = false) => {
        const w = g.measureText(s).width
        const tx = center ? x - w / 2 : x
        g.fillStyle = 'rgba(0,0,0,0.55)'
        g.fillText(s, tx + 1, y + 1)
        g.fillStyle = c
        g.fillText(s, tx, y)
      }
      const seconds = t('harvestUi.seconds', { s: left })
      if (style === 'ring') {
        const radius = num(d, 'radius', 9)
        const inner = Math.max(0, radius - num(d, 'thickness', 3))
        for (let dy = -radius; dy < radius; dy++)
          for (let dx = -radius; dx < radius; dx++) {
            const px = dx + 0.5
            const py = dy + 0.5
            const dist = Math.hypot(px, py)
            if (dist > radius || dist < inner) continue
            let a = Math.atan2(px, -py)
            if (a < 0) a += Math.PI * 2
            g.fillStyle = a / (Math.PI * 2) <= p ? color : back
            g.fillRect(cx + dx, cy + dy, 1, 1)
          }
        if (time) text(seconds, cx, cy + radius + 3, '#fff', true)
      } else {
        const place = str(d, 'place', 'crosshair')
        const width = num(d, 'width', 60)
        const height = style === 'bar' ? num(d, 'height', 4) + 2 : 9
        let y = place === 'hotbar' ? H - 50 - height : place === 'top' ? 10 : cy + 10
        y += num(d, 'offset', 0)
        if (style === 'text') {
          const filled = Math.floor(10 * p)
          const bar = '■'.repeat(filled) + '□'.repeat(10 - filled)
          text(time ? t('harvestUi.text', { bar, s: left }) : t('harvestUi.textNoTime', { bar }), cx, y, color, true)
        } else {
          const x = cx - Math.floor(width / 2)
          g.fillStyle = back
          g.fillRect(x - 1, y, width + 2, height)
          g.fillStyle = color
          g.fillRect(x, y + 1, Math.round(width * p), height - 2)
          if (time) text(seconds, x + width + 4, y + Math.floor((height - 2) / 2) - 3, '#fff')
        }
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [t])

  return (
    <div className="harvest-preview">
      <canvas ref={ref} width={W * 2} height={H * 2} />
      <div className="faint">{t('harvestUi.hint')}</div>
    </div>
  )
}
