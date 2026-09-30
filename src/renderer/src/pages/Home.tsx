import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type TemplateId } from '../api'
import { useStore } from '../store'
import { IFolder, IPlus, ISettings, IX, Logo } from '../components/Icons'
import { NewProjectDialog } from './NewProjectDialog'
import { SettingsDialog } from './SettingsDialog'

const TEMPLATES: { id: TemplateId; icon: string }[] = [
  { id: 'empty', icon: '⬚' },
  { id: 'starter', icon: '💎' },
  { id: 'armor', icon: '🛡' },
  { id: 'music', icon: '💿' },
  { id: 'farmersDelight', icon: '🍲' }
]

export function Home() {
  const { t } = useTranslation()
  const settings = useStore((s) => s.settings)!
  const [wizard, setWizard] = useState<TemplateId | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [version, setVersion] = useState('')
  useEffect(() => {
    void api.appInfo().then((i) => setVersion(i.version))
  }, [])

  const open = async (fn: () => Promise<{ dir: string; project: import('@core/project').Project } | null>) => {
    try {
      const r = await fn()
      if (r) useStore.getState().openProject(r.dir, r.project)
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
      useStore.getState().setSettings(await api.settings())
    }
  }

  return (
    <div className="home">
      <div className="titlebar">
        <div className="brand">
          <Logo />
          {t('app.name')}
        </div>
        <div className="drag" />
        <button className="btn ghost" onClick={() => setShowSettings(true)}>
          <ISettings /> {t('home.settings')}
        </button>
      </div>

      <div className="home-body">
        <section className="hero">
          <div className="hero-logo">
            <Logo size={64} />
          </div>
          <h1>{t('app.name')}</h1>
          <p className="muted">{t('app.tagline')}</p>
          <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 18 }}>
            <button className="btn primary lg" onClick={() => setWizard('starter')}>
              <IPlus /> {t('home.newProject')}
            </button>
            <button className="btn lg" onClick={() => open(api.openProject)}>
              <IFolder /> {t('home.open')}
            </button>
          </div>
        </section>

        <section>
          <h3 className="sec-title">{t('home.templates')}</h3>
          <div className="tpl-grid">
            {TEMPLATES.map((tp) => {
              const [name, desc] = t(`tpl.${tp.id}`, { returnObjects: true }) as string[]
              return (
                <button key={tp.id} className="tpl" onClick={() => setWizard(tp.id)}>
                  <span className="tpl-icon">{tp.icon}</span>
                  <b>{name}</b>
                  <span className="muted">{desc}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section>
          <h3 className="sec-title">{t('home.recent')}</h3>
          {settings.recent.length === 0 ? (
            <div className="empty">{t('home.noRecent')}</div>
          ) : (
            <div className="recent-grid">
              {settings.recent.map((r) => (
                <div key={r.dir} className="recent" role="button" tabIndex={0} onClick={() => open(() => api.openRecent(r.dir))} onKeyDown={(e) => e.key === 'Enter' && open(() => api.openRecent(r.dir))}>
                  <div className="recent-icon">{r.name.slice(0, 1).toUpperCase()}</div>
                  <div className="grow">
                    <b>{r.name}</b>
                    <div className="muted mono ellipsis">{r.modId}</div>
                    <div className="faint ellipsis" title={r.dir}>
                      {r.dir}
                    </div>
                  </div>
                  <button
                    className="btn ghost icon"
                    title={t('home.remove')}
                    onClick={async (e) => {
                      e.stopPropagation()
                      await api.forgetRecent(r.dir)
                      useStore.getState().setSettings(await api.settings())
                    }}
                  >
                    <IX size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="home-foot muted">
          {t('app.by')} · NKW Mod Studio {version}
        </footer>
      </div>

      {wizard && <NewProjectDialog template={wizard} onClose={() => setWizard(null)} onCreated={(r) => useStore.getState().openProject(r.dir, r.project)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
