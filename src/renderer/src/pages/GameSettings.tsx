import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KEY_ACTIONS, keyLabel, mcKeyFromCode, mcKeyFromMouse, type GameOptions } from '@core/gameOptions'
import { api } from '../api'
import { L } from '../i18n'
import { useStore } from '../store'

const SIZES: [number, number][] = [
  [1280, 720],
  [1600, 900],
  [1920, 1080],
  [854, 480]
]

/** Minecraft settings used by "Test in game" (written to the test run's options.txt). */
export function GameSettings() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)!
  const g = settings.game
  const set = async (patch: Partial<GameOptions>) => useStore.getState().setSettings(await api.setSettings({ game: { ...g, ...patch } }))
  const [listening, setListening] = useState<string | null>(null)

  // waiting for a key: the next key press or mouse click becomes the binding (Escape cancels)
  useEffect(() => {
    if (!listening) return
    const done = (key: string | null) => {
      setListening(null)
      if (!key) return
      const def = KEY_ACTIONS.find((a) => a.id === listening)!.def
      const keys = { ...g.keys }
      if (key === def) delete keys[listening]
      else keys[listening] = key
      void set({ keys })
    }
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      done(e.code === 'Escape' ? null : mcKeyFromCode(e.code))
    }
    const onMouse = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.key-btn.listening') && e.button === 0) return
      e.preventDefault()
      done(mcKeyFromMouse(e.button))
    }
    const block = (e: Event) => e.preventDefault()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onMouse, true)
    window.addEventListener('contextmenu', block, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onMouse, true)
      window.removeEventListener('contextmenu', block, true)
    }
  }, [listening])

  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <div className="game-settings">
      <p className="hint">{t('game.hint')}</p>
      <div className="set-row">
        <span>{t('game.fullscreen')}</span>
        <button
          className={`switch${g.fullscreen ? ' on' : ''}`}
          role="switch"
          aria-checked={g.fullscreen}
          onClick={() => void set({ fullscreen: !g.fullscreen })}
        />
      </div>
      <div className="set-row">
        <span>{t('game.window')}</span>
        <div className="row">
          <input
            className="input num"
            type="number"
            min={320}
            max={7680}
            value={g.width}
            disabled={g.fullscreen}
            onChange={(e) => void set({ width: Math.min(7680, Math.max(320, Number(e.target.value) || 1280)) })}
          />
          ×
          <input
            className="input num"
            type="number"
            min={240}
            max={4320}
            value={g.height}
            disabled={g.fullscreen}
            onChange={(e) => void set({ height: Math.min(4320, Math.max(240, Number(e.target.value) || 720)) })}
          />
          <select
            className="input"
            value=""
            disabled={g.fullscreen}
            onChange={(e) => {
              const [w, h] = e.target.value.split('x').map(Number)
              if (w) void set({ width: w, height: h })
            }}
          >
            <option value="">{t('game.preset')}</option>
            {SIZES.map(([w, h]) => (
              <option key={w} value={`${w}x${h}`}>
                {w} × {h}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="set-row">
        <span>
          {t('game.maxFps')} <b className="mono">{g.maxFps >= 260 ? t('game.unlimited') : g.maxFps}</b>
        </span>
        <input type="range" min={10} max={260} step={10} value={g.maxFps} onChange={(e) => void set({ maxFps: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>{t('game.vsync')}</span>
        <button className={`switch${g.vsync ? ' on' : ''}`} role="switch" aria-checked={g.vsync} onClick={() => void set({ vsync: !g.vsync })} />
      </div>
      <div className="set-row">
        <span>{t('game.guiScale')}</span>
        <div className="seg">
          {[0, 1, 2, 3, 4].map((s) => (
            <button key={s} className={g.guiScale === s ? 'on' : ''} onClick={() => void set({ guiScale: s })}>
              {s === 0 ? t('game.auto') : s}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span>
          {t('game.renderDistance')} <b className="mono">{g.renderDistance}</b>
        </span>
        <input type="range" min={2} max={32} value={g.renderDistance} onChange={(e) => void set({ renderDistance: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>
          {t('game.volume')} <b className="mono">{pct(g.volume)}</b>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={g.volume} onChange={(e) => void set({ volume: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>
          {t('game.brightness')} <b className="mono">{pct(g.brightness)}</b>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={g.brightness} onChange={(e) => void set({ brightness: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>
          {t('game.sensitivity')} <b className="mono">{pct(g.sensitivity * 2)}</b>
        </span>
        <input type="range" min={0} max={1} step={0.05} value={g.sensitivity} onChange={(e) => void set({ sensitivity: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>{t('game.language')}</span>
        <div className="seg">
          {(['app', 'en_us', 'th_th'] as const).map((l) => (
            <button key={l} className={g.language === l ? 'on' : ''} onClick={() => void set({ language: l })}>
              {l === 'app' ? t('game.sameAsApp') : l === 'th_th' ? 'ไทย' : 'English'}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span>{t('game.pause')}</span>
        <button
          className={`switch${g.pauseOnLostFocus ? ' on' : ''}`}
          role="switch"
          aria-checked={g.pauseOnLostFocus}
          onClick={() => void set({ pauseOnLostFocus: !g.pauseOnLostFocus })}
        />
      </div>
      <div className="row key-head">
        <b className="grow">{t('game.keys')}</b>
        <button className="btn ghost small" disabled={!Object.keys(g.keys).length} onClick={() => void set({ keys: {} })}>
          {t('game.resetKeys')}
        </button>
      </div>
      <span className="hint">{t('game.keysHint')}</span>
      <div className="key-list">
        {KEY_ACTIONS.map((a) => {
          const key = g.keys[a.id] ?? a.def
          const changed = !!g.keys[a.id]
          return (
            <div key={a.id} className="key-row">
              <span className="grow">{L(a.label)}</span>
              <button
                className={`key-btn${listening === a.id ? ' listening' : ''}${changed ? ' changed' : ''}`}
                onClick={() => setListening(listening === a.id ? null : a.id)}
              >
                {listening === a.id ? t('game.pressKey') : keyLabel(key)}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
