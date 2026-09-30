import { LOADERS, LOADER_LABEL, type Target } from '@core/project'
import { PROFILES } from '@core/gen/profiles'

/** Loader × version matrix of checkboxes (only supported combinations are clickable). */
export function TargetPicker({ value, onChange }: { value: Target[]; onChange: (t: Target[]) => void }) {
  const has = (l: string, mc: string) => value.some((t) => t.loader === l && t.mc === mc)
  const toggle = (loader: Target['loader'], mc: string) =>
    onChange(has(loader, mc) ? value.filter((t) => !(t.loader === loader && t.mc === mc)) : [...value, { loader, mc }])
  const profiles = [...PROFILES].reverse()
  return (
    <div className="tmatrix">
      <div className="tm-head" />
      {LOADERS.map((l) => (
        <div key={l} className="tm-head">
          {LOADER_LABEL[l]}
        </div>
      ))}
      {profiles.map((p) => (
        <div key={p.mc} className="tm-row" style={{ display: 'contents' }}>
          <div className="tm-ver mono">{p.mc}</div>
          {LOADERS.map((l) => {
            const ok = p.loaders.includes(l)
            const on = has(l, p.mc)
            return (
              <button
                key={l}
                type="button"
                disabled={!ok}
                className={`tm-cell${on ? ' on' : ''}`}
                onClick={() => toggle(l, p.mc)}
                aria-pressed={on}
                title={ok ? `${LOADER_LABEL[l]} ${p.mc}` : '—'}
              >
                {ok ? (on ? '✓' : '') : '·'}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
