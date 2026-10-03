import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useStore } from '../store'
import { Logo } from '../components/Icons'
import { GameSettings } from './GameSettings'
import { ModelControlsSettings } from './ModelControlsSettings'

export type SettingsSection = 'app' | 'game' | 'model'

/** Theme, language, memory, downloads, Java list and about. */
export function GeneralSettings() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)!
  const [jdks, setJdks] = useState<{ major: number; home: string; managed: boolean }[] | null>(null)
  useEffect(() => {
    void api.toolchain().then((r) => setJdks(r.jdks))
  }, [])
  const update = async (patch: Parameters<typeof api.setSettings>[0]) => useStore.getState().setSettings(await api.setSettings(patch))
  return (
    <>
      <div className="set-row">
        <span>{t('settings.theme')}</span>
        <div className="seg">
          {(['system', 'light', 'dark'] as const).map((th) => (
            <button key={th} className={settings.theme === th ? 'on' : ''} onClick={() => update({ theme: th })}>
              {t(`settings.${th}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="set-row">
        <span>{t('settings.language')}</span>
        <div className="seg">
          <button className={settings.language === 'th' ? 'on' : ''} onClick={() => update({ language: 'th' })}>
            ไทย
          </button>
          <button className={settings.language === 'en' ? 'on' : ''} onClick={() => update({ language: 'en' })}>
            English
          </button>
        </div>
      </div>
      <div className="set-row">
        <span>
          {t('settings.memory')} <b className="mono">{(settings.memoryMb / 1024).toFixed(1)} GB</b>
        </span>
        <input type="range" min={1024} max={16384} step={512} value={settings.memoryMb} onChange={(e) => update({ memoryMb: Number(e.target.value) })} />
      </div>
      <div className="set-row">
        <span>{t('settings.downloads')}</span>
        <button
          className={`switch${settings.allowDownloads ? ' on' : ''}`}
          role="switch"
          aria-checked={settings.allowDownloads}
          onClick={() => update({ allowDownloads: !settings.allowDownloads })}
        />
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>{t('settings.java')}</label>
        {jdks === null ? (
          <span className="muted">…</span>
        ) : jdks.length === 0 ? (
          <span className="muted">{t('settings.noJava')}</span>
        ) : (
          <div className="jdk-list">
            {jdks.map((j) => (
              <div key={j.home} className="row">
                <span className="badge">Java {j.major}</span>
                <span className="muted mono ellipsis grow" title={j.home}>
                  {j.home}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="about">
        <Logo size={28} />
        <div>
          <b>NKW Mod Studio</b>
          <div className="muted">{t('app.by')}</div>
        </div>
      </div>
    </>
  )
}

/** Settings as a dialog (classic layout); the IDE layout shows the same sections in a Settings tab. */
export function SettingsDialog({ onClose, section = 'app' }: { onClose: () => void; section?: SettingsSection }) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<SettingsSection>(section)
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal style={{ width: 600 }} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{t('settings.title')}</h2>
        <div className="seg settings-tabs">
          {(['app', 'game', 'model'] as const).map((s) => (
            <button key={s} className={tab === s ? 'on' : ''} onClick={() => setTab(s)}>
              {t(`settings.tab.${s}`)}
            </button>
          ))}
        </div>
        <div className="settings-scroll">
          {tab === 'app' && <GeneralSettings />}
          {tab === 'game' && <GameSettings />}
          {tab === 'model' && <ModelControlsSettings />}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={onClose}>
            {t('settings.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
