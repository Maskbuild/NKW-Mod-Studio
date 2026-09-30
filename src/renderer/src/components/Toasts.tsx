import { useStore } from '../store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
