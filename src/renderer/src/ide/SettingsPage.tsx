import { useTranslation } from 'react-i18next'
import { CONTROL_PRESETS } from '@core/modelControls'
import { api } from '../api'
import { useStore } from '../store'
import { JsonView } from './JsonView'

/**
 * The model editor's mouse / key layout as code, in an editor tab (like VS Code's keybindings.json).
 * Typing valid JSON applies it at once; the presets fill it in.
 */
export function ControlsJsonPage() {
  const { t } = useTranslation()
  const c = useStore((s) => s.settings!.modelControls)
  return (
    <div className="controls-json">
      <div className="cj-bar">
        <span className="faint">{t('controls.jsonHint')}</span>
        <div className="grow" />
        {(['blockbench', 'maya', 'blender'] as const).map((p) => (
          <button
            key={p}
            className={`btn small${c.preset === p ? ' primary' : ''}`}
            onClick={async () => useStore.getState().setSettings(await api.setSettings({ modelControls: CONTROL_PRESETS[p] }))}
          >
            {p[0].toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>
      <JsonView
        value={c}
        onChange={async (v) => {
          try {
            useStore.getState().setSettings(await api.setSettings({ modelControls: v as typeof c }))
            return null
          } catch (e) {
            return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          }
        }}
      />
    </div>
  )
}
