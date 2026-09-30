import { useEffect, useState, type PointerEvent as RPointerEvent } from 'react'

export interface Layout {
  left: number
  right: number
  dock: number
}

const KEY = 'nkw.layout'
const DEFAULT: Layout = { left: 260, right: 320, dock: 210 }
const LIMITS: Record<keyof Layout, [number, number]> = { left: [200, 560], right: [260, 640], dock: [110, 600] }

const clamp = (k: keyof Layout, v: number) => Math.round(Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v)))

/** Panel sizes, remembered per viewer (falls back to defaults when storage is unavailable). */
export function useLayout(): [Layout, (k: keyof Layout, v: number) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Layout>
      return { left: clamp('left', saved.left ?? DEFAULT.left), right: clamp('right', saved.right ?? DEFAULT.right), dock: clamp('dock', saved.dock ?? DEFAULT.dock) }
    } catch {
      return DEFAULT
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      /* storage unavailable */
    }
  }, [layout])
  return [layout, (k, v) => setLayout((l) => ({ ...l, [k]: clamp(k, v) }))]
}

/**
 * Drag handle. `dir` is the axis; `sign` flips the delta (e.g. the right panel grows when dragged left).
 * Double-click resets to the default size.
 */
export function Resizer({ dir, value, sign = 1, onChange, onReset }: { dir: 'x' | 'y'; value: number; sign?: 1 | -1; onChange: (v: number) => void; onReset: () => void }) {
  const [active, setActive] = useState(false)
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = dir === 'x' ? e.clientX : e.clientY
    const startValue = value
    setActive(true)
    const move = (ev: PointerEvent) => onChange(startValue + sign * ((dir === 'x' ? ev.clientX : ev.clientY) - start))
    const up = () => {
      setActive(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return <div className={`resizer ${dir}${active ? ' active' : ''}`} onPointerDown={down} onDoubleClick={onReset} role="separator" aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'} />
}

export const DEFAULT_LAYOUT = DEFAULT
