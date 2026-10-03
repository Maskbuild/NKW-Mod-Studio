import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CONTROL_PRESETS, keyName, type Gesture, type ModelControls, type ToolKey } from '@core/modelControls'
import { api } from '../api'
import { useStore } from '../store'
import { JsonView } from '../ide/JsonView'

const TOOLS: ToolKey[] = ['select', 'move', 'scale', 'rotate', 'paint', 'frame', 'frameAll']

/** Mouse and keys of the model editor: Blockbench / Maya / Blender presets, every binding editable. */
export function ModelControlsSettings() {
  const { t } = useTranslation()
  const c = useStore((s) => s.settings!.modelControls)
  const save = async (next: ModelControls) => useStore.getState().setSettings(await api.setSettings({ modelControls: next }))
  // any change away from a preset makes it "custom"
  const set = (patch: Partial<ModelControls>) => void save({ ...c, ...patch, preset: 'custom' })
  const [listening, setListening] = useState<ToolKey | null>(null)

  useEffect(() => {
    if (!listening) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setListening(null)
      if (e.key === 'Escape') return
      const k = keyName(e.key)
      if (/^[a-z0-9.,/;'[\]\\`-]$|^(home|end|delete|tab|space|f[1-9]|f1[0-2])$/.test(k)) set({ keys: { ...c.keys, [listening]: k } })
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [listening, c])

  const gesture = (name: 'orbit' | 'pan' | 'zoom') => {
    const g = c[name]
    const patch = (p: Partial<Gesture>) => set({ [name]: { ...g, ...p } } as Partial<ModelControls>)
    return (
      <div className="set-row" key={name}>
        <span>{t(`controls.${name}`)}</span>
        <div className="row">
          <select className="input" value={g.mod} onChange={(e) => patch({ mod: e.target.value as Gesture['mod'] })}>
            {(['none', 'alt', 'shift', 'ctrl'] as const).map((m) => (
              <option key={m} value={m}>
                {m === 'none' ? t('controls.noKey') : m[0].toUpperCase() + m.slice(1) + ' +'}
              </option>
            ))}
          </select>
          <select className="input" value={g.button} onChange={(e) => patch({ button: e.target.value as Gesture['button'] })}>
            {(['left', 'middle', 'right'] as const).map((b) => (
              <option key={b} value={b}>
                {t(`controls.button.${b}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }
  const sw = (key: 'invertX' | 'invertY' | 'invertZoom') => (
    <div className="set-row" key={key}>
      <span>{t(`controls.${key}`)}</span>
      <button
        className={`switch${c[key] ? ' on' : ''}`}
        role="switch"
        aria-checked={c[key]}
        onClick={() => set({ [key]: !c[key] } as Partial<ModelControls>)}
      />
    </div>
  )
  const speed = (key: 'orbitSpeed' | 'panSpeed' | 'zoomSpeed') => (
    <div className="set-row" key={key}>
      <span>
        {t(`controls.${key}`)} <b className="mono">{c[key].toFixed(1)}×</b>
      </span>
      <input type="range" min={0.2} max={3} step={0.1} value={c[key]} onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<ModelControls>)} />
    </div>
  )

  return (
    <div className="model-controls">
      <p className="hint">{t('controls.hint')}</p>
      <div className="set-row">
        <span>{t('controls.preset')}</span>
        <div className="seg">
          {(['blockbench', 'maya', 'blender'] as const).map((p) => (
            <button key={p} className={c.preset === p ? 'on' : ''} onClick={() => void save(CONTROL_PRESETS[p])}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
          <button className={c.preset === 'custom' ? 'on' : ''} disabled>
            {t('model.custom')}
          </button>
        </div>
      </div>
      <div className="set-sub">{t('controls.mouse')}</div>
      {gesture('orbit')}
      {gesture('pan')}
      {gesture('zoom')}
      {sw('invertX')}
      {sw('invertY')}
      {sw('invertZoom')}
      {speed('orbitSpeed')}
      {speed('panSpeed')}
      {speed('zoomSpeed')}
      <div className="set-sub">{t('controls.keys')}</div>
      <div className="key-list">
        {TOOLS.map((k) => (
          <div key={k} className="key-row">
            <span className="grow">{t(`controls.tool.${k}`)}</span>
            <button className={`key-btn${listening === k ? ' listening' : ''}`} onClick={() => setListening(listening === k ? null : k)}>
              {listening === k ? t('game.pressKey') : c.keys[k].toUpperCase()}
            </button>
          </div>
        ))}
      </div>
      <div className="set-sub">{t('controls.asCode')}</div>
      <JsonView value={{ modelControls: c }} height={220} />
    </div>
  )
}
