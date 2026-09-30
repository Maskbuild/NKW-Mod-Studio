import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ID_RE, MetaSchema, toId, type Target } from '@core/project'
import { api, type Opened, type TemplateId } from '../api'
import { useStore } from '../store'
import { TargetPicker } from '../components/TargetPicker'

const TEMPLATE_IDS: TemplateId[] = ['empty', 'starter', 'armor', 'music', 'farmersDelight']

export function NewProjectDialog({ template, onClose, onCreated }: { template: TemplateId; onClose: () => void; onCreated: (r: Opened) => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState('My Mod')
  const [modId, setModId] = useState('my_mod')
  const [idTouched, setIdTouched] = useState(false)
  const [authors, setAuthors] = useState('Nam Kueap Wan (NKW)')
  const [description, setDescription] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [tpl, setTpl] = useState<TemplateId>(template)
  const [targets, setTargets] = useState<Target[]>(template === 'farmersDelight' ? [{ loader: 'neoforge', mc: '1.21.1' }] : [{ loader: 'fabric', mc: '1.21.1' }])
  const [busy, setBusy] = useState(false)

  const meta = { name: name.trim(), modId, version, authors, description }
  const valid = MetaSchema.safeParse(meta).success && targets.length > 0

  const create = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const r = await api.createProject(meta, targets, tpl)
      if (r) onCreated(r)
    } catch (e) {
      useStore.getState().toast((e as Error).message, true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>{t('wizard.title')}</h2>
        <div className="cols">
          <div>
            <div className="field">
              <label>{t('wizard.name')}</label>
              <input
                className="input"
                autoFocus
                value={name}
                maxLength={64}
                onChange={(e) => {
                  setName(e.target.value)
                  if (!idTouched) setModId(toId(e.target.value))
                }}
              />
            </div>
            <div className="field">
              <label>{t('wizard.modId')}</label>
              <input
                className={`input mono${ID_RE.test(modId) ? '' : ' invalid'}`}
                value={modId}
                maxLength={63}
                onChange={(e) => {
                  setIdTouched(true)
                  setModId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                }}
              />
              <span className="hint">{t('wizard.modIdHint')}</span>
            </div>
            <div className="row">
              <div className="field grow">
                <label>{t('wizard.authors')}</label>
                <input className="input" value={authors} maxLength={200} onChange={(e) => setAuthors(e.target.value)} />
              </div>
              <div className="field" style={{ width: 100 }}>
                <label>{t('wizard.version')}</label>
                <input className="input mono" value={version} maxLength={32} onChange={(e) => setVersion(e.target.value.replace(/[^0-9A-Za-z.+-]/g, ''))} />
              </div>
            </div>
            <div className="field">
              <label>{t('wizard.description')}</label>
              <textarea className="input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('wizard.template')}</label>
              <select className="input" value={tpl} onChange={(e) => setTpl(e.target.value as TemplateId)}>
                {TEMPLATE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {(t(`tpl.${id}`, { returnObjects: true }) as string[])[0]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <div className="field">
              <label>{t('wizard.targets')}</label>
              <TargetPicker value={targets} onChange={setTargets} />
              <span className="hint">{targets.length ? t('wizard.targetsHint') : t('targets.atLeastOne')}</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={onClose}>
            {t('wizard.cancel')}
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={create}>
            {t('wizard.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
