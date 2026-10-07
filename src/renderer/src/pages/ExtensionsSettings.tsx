import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, type ExtInspected, type ExtList, type ExtRecord } from '../api'
import { refreshExtensions } from '../ext/extensions'
import { useStore } from '../store'

type Lang = 'en' | 'th'
const mb = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1000))} KB` : `${(n / 1e6).toFixed(1)} MB`)

/** The card shown before an extension is installed: what it is, where it comes from, what it adds. */
function Review({ info, onInstall, onCancel, busy }: { info: ExtInspected; onInstall: () => void; onCancel: () => void; busy: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Lang
  const p = info.preview
  const blocked = info.errors.length > 0 || info.missing.length > 0
  return (
    <div className="ext-card review">
      <div className="row" style={{ gap: 8 }}>
        <b>{p.name[lang] || p.name.en}</b>
        <span className="badge">{p.version}</span>
        {info.installed && <span className="badge">{t('ext.installedVersion', { v: info.installed.version })}</span>}
      </div>
      <div className="muted">{p.description[lang] || p.description.en}</div>
      <div className="faint mono ellipsis" title={info.source}>
        {info.source}
      </div>
      <div className="faint">
        {t('ext.facts', { nodes: p.nodes, files: p.files, size: mb(p.size) })}
        {info.sha !== 'local' && ` · ${t(`ext.via.${info.via}`, { label: info.label })} · ${info.sha.slice(0, 7)}`}
      </div>
      {info.via === 'default-branch' && <div className="warn-text">{t('ext.noRelease')}</div>}
      {info.via === 'local' && <div className="warn-text">{t('ext.local')}</div>}
      {p.targets.mc || p.targets.loaders ? (
        <div className="faint">
          {t('ext.targets')}: {[p.targets.mc, p.targets.loaders?.join(', ')].filter(Boolean).join(' · ')}
        </div>
      ) : null}
      {info.missing.length > 0 && <div className="err-text">{t('ext.needs', { list: info.missing.join(', ') })}</div>}
      {info.errors.map((e) => (
        <div key={e} className="err-text">
          {e}
        </div>
      ))}
      <div className="faint">{t('ext.safety')}</div>
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onCancel} disabled={busy}>
          {t('ext.cancel')}
        </button>
        <button className="btn primary" onClick={onInstall} disabled={busy || blocked}>
          {info.installed ? t('ext.update') : t('ext.install')}
        </button>
      </div>
    </div>
  )
}

/** Extensions: what is installed, install from a GitHub address, the official ones, updates. */
export function ExtensionsSettings() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language as Lang
  const toast = useStore.getState().toast
  const [list, setList] = useState<ExtList | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [updates, setUpdates] = useState<Record<string, string>>({})
  const [source, setSource] = useState('')
  const [review, setReview] = useState<ExtInspected | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const l = await api.extList()
    setList(l)
    // names come from the manifests the main process loaded
    const bundle = await api.extBundle()
    const n: Record<string, string> = {}
    for (const b of bundle) {
      try {
        const m = JSON.parse(b.files['nkw-extension.json']) as { name: { en: string; th: string } }
        n[b.id] = m.name[lang] || m.name.en
      } catch {
        n[b.id] = b.id
      }
    }
    setNames(n)
  }, [lang])
  useEffect(() => {
    void load()
    void api.extCheckUpdates().then((u) => setUpdates(Object.fromEntries(u.map((x) => [x.id, `${x.label} (${x.latest})`]))))
  }, [load])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
    } finally {
      setBusy(false)
    }
  }
  const inspect = (src: string) =>
    run(async () => {
      setReview(await api.extInspect(src))
    })
  const done = async () => {
    await refreshExtensions()
    await load()
  }

  if (!list) return <span className="muted">…</span>
  const installedIds = new Set(list.installed.map((r) => r.id))
  const official = list.official.filter((o) => !installedIds.has(o.id))
  const label = (r: ExtRecord) => names[r.id] ?? r.id

  return (
    <div className="ext-panel">
      <h4>{t('ext.installed')}</h4>
      {list.installed.length === 0 && <div className="empty">{t('ext.none')}</div>}
      {list.installed.map((r) => (
        <div key={r.id} className="ext-card">
          <div className="row" style={{ gap: 8 }}>
            <b className="grow">{label(r)}</b>
            <span className="badge">{r.version}</span>
            <button
              className={`switch${r.enabled ? ' on' : ''}`}
              role="switch"
              aria-checked={r.enabled}
              aria-label={t('ext.enabled')}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.extSetEnabled(r.id, !r.enabled)
                  await done()
                })
              }
            />
          </div>
          <div className="faint mono ellipsis" title={r.source}>
            {r.source}
          </div>
          {list.problems
            .filter((p) => p.id === r.id)
            .map((p) => (
              <div key={p.id} className="err-text">
                {p.errors.join('; ')}
              </div>
            ))}
          <div className="row" style={{ gap: 8 }}>
            {updates[r.id] && (
              <button className="btn small primary" disabled={busy} onClick={() => inspect(r.source)}>
                {t('ext.updateTo', { v: updates[r.id] })}
              </button>
            )}
            {r.previous.length > 0 && (
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.extRollback(r.id)
                    await done()
                  })
                }
              >
                {t('ext.rollback', { v: r.previous[0].version })}
              </button>
            )}
            <span className="grow" />
            <button
              className="btn small danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.extRemove(r.id)
                  await done()
                })
              }
            >
              {t('ext.remove')}
            </button>
          </div>
        </div>
      ))}

      {official.length > 0 && (
        <>
          <h4>{t('ext.official')}</h4>
          {official.map((o) => (
            <div key={o.id} className="ext-card">
              <div className="row" style={{ gap: 8 }}>
                <b className="grow">{t(`ext.officialNames.${o.id}`, { defaultValue: o.id })}</b>
                <button className="btn small primary" disabled={busy} onClick={() => inspect(o.source)}>
                  {t('ext.install')}
                </button>
              </div>
              <div className="faint mono ellipsis" title={o.source}>
                {o.source}
              </div>
            </div>
          ))}
        </>
      )}

      <h4>{t('ext.fromGit')}</h4>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="grow"
          value={source}
          placeholder="https://github.com/owner/repo"
          spellCheck={false}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && source.trim() && inspect(source.trim())}
        />
        <button className="btn" disabled={busy || !source.trim()} onClick={() => inspect(source.trim())}>
          {t('ext.look')}
        </button>
      </div>
      <div className="faint">{t('ext.gitHint')}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          className="btn small"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api.extInspectFolder()
              if (r) setReview(r)
            })
          }
        >
          {t('ext.fromFolder')}
        </button>
      </div>

      {review && (
        <Review
          info={review}
          busy={busy}
          onCancel={() => setReview(null)}
          onInstall={() =>
            run(async () => {
              await api.extInstall(review.token)
              setReview(null)
              setSource('')
              await done()
              toast(t('ext.installedOk', { name: review.preview.name[lang] || review.preview.name.en }))
            })
          }
        />
      )}
    </div>
  )
}
