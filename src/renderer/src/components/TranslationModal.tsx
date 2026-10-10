import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IPlus, ITrash, IX } from './Icons'

export interface TranslationModalProps {
  primaryName: string
  translations: Record<string, string>
  onSave: (translations: Record<string, string>) => void
  onClose: () => void
}

const COMMON_LANGS: { code: string; label: string }[] = [
  { code: 'th_th', label: 'Thai (ภาษาไทย)' },
  { code: 'zh_cn', label: 'Simplified Chinese (简体中文)' },
  { code: 'ja_jp', label: 'Japanese (日本語)' },
  { code: 'ko_kr', label: 'Korean (한국어)' },
  { code: 'ru_ru', label: 'Russian (Русский)' },
  { code: 'de_de', label: 'German (Deutsch)' },
  { code: 'fr_fr', label: 'French (Français)' },
  { code: 'es_es', label: 'Spanish (Español)' },
  { code: 'pt_br', label: 'Portuguese (Português)' },
  { code: 'it_it', label: 'Italian (Italiano)' }
]

export function TranslationModal({
  primaryName,
  translations,
  onSave,
  onClose
}: TranslationModalProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<Record<string, string>>({ ...translations })
  const [newCode, setNewCode] = useState('')

  const handleUpdate = (code: string, value: string) => {
    setEntries((prev) => ({ ...prev, [code]: value }))
  }

  const handleRemove = (code: string) => {
    setEntries((prev) => {
      const next = { ...prev }
      delete next[code]
      return next
    })
  }

  const handleAdd = (code: string) => {
    const trimmed = code.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    if (!trimmed || entries[trimmed] !== undefined) return
    setEntries((prev) => ({ ...prev, [trimmed]: '' }))
    setNewCode('')
  }

  const handleSaveAndClose = () => {
    onSave(entries)
    onClose()
  }

  const unusedCommon = COMMON_LANGS.filter((l) => entries[l.code] === undefined)

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && handleSaveAndClose()}>
      <div className="dialog translation-modal" role="dialog" aria-modal style={{ width: 520 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t('l10n.title', 'Translations (Minecraft Lang)')}</h3>
          <button className="btn ghost icon" onClick={handleSaveAndClose}>
            <IX size={16} />
          </button>
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label>{t('l10n.enName', 'Default Name (EN)')}</label>
          <input className="input" value={primaryName} disabled style={{ opacity: 0.8 }} />
        </div>

        <div className="translation-list" style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflowY: 'auto' }}>
          {Object.entries(entries).length === 0 ? (
            <div className="muted" style={{ padding: '12px 0', textAlign: 'center' }}>
              {t('l10n.noTranslations', 'No translations added yet. Select a language below.')}
            </div>
          ) : (
            Object.entries(entries).map(([code, val]) => {
              const info = COMMON_LANGS.find((l) => l.code === code)
              return (
                <div key={code} className="translation-row" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div style={{ width: 140, flexShrink: 0 }}>
                    <span className="badge mono" style={{ fontSize: 12 }}>{code}</span>
                    {info && <div className="faint ellipsis" style={{ fontSize: 11 }} title={info.label}>{info.label.split(' ')[0]}</div>}
                  </div>
                  <input
                    className="input grow"
                    placeholder={`Name in ${code}`}
                    value={val}
                    onChange={(e) => handleUpdate(code, e.target.value)}
                  />
                  <button className="btn ghost icon danger" title={t('common.remove', 'Remove')} onClick={() => handleRemove(code)}>
                    <ITrash size={14} />
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="translation-add-bar" style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          {unusedCommon.length > 0 && (
            <select
              className="input grow"
              value=""
              onChange={(e) => e.target.value && handleAdd(e.target.value)}
            >
              <option value="">{t('l10n.addPreset', '+ Add common language...')}</option>
              {unusedCommon.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code})
                </option>
              ))}
            </select>
          )}

          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <input
              className="input mono"
              style={{ width: 90 }}
              placeholder="code_xx"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd(newCode)}
            />
            <button className="btn" disabled={!newCode} onClick={() => handleAdd(newCode)}>
              <IPlus size={14} /> {t('common.add', 'Add')}
            </button>
          </div>
        </div>

        <div className="actions" style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn primary" onClick={handleSaveAndClose}>
            {t('common.done', 'Done')}
          </button>
        </div>
      </div>
    </div>
  )
}
